import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getSessionStore } from './server/store.js';
import { getHybridRetriever } from './server/hybridRetriever.js';
import { runAgentStream } from './server/agent.js';
import { synthesizeEdgeTTS } from './server/tts.js';
import { transcribeAudioWithGroqOrGemini } from './server/stt.js';
import { parsePdfWithPages, chunkStructuredText } from './server/chunking.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json());

// Setup Multer for document uploads
const uploadDir = path.join(__dirname, 'data', 'raw');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Preserve original filename mapping for PDF view click-through
const fileStorageMap = new Map<string, string>();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const savedName = `${uniqueSuffix}-${safeName}`;
    fileStorageMap.set(file.originalname, savedName);
    fileStorageMap.set(safeName, savedName);
    cb(null, savedName);
  },
});
const upload = multer({ storage });

// ─────────────────────────────────────────────────────────────────────────────
// CHAT STREAMING (SSE Endpoint with latency logging & multi-PDF filtering)
// ─────────────────────────────────────────────────────────────────────────────
const handleChatStream = async (req: express.Request, res: express.Response) => {
  const { query, thread_id, fileFilter, sttMs } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Missing query parameter' });
    return;
  }

  if (!thread_id || typeof thread_id !== 'string') {
    res.status(400).json({ error: 'Missing thread_id parameter' });
    return;
  }

  const sessionStore = getSessionStore();
  sessionStore.createOrUpdateSession(thread_id, query);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runAgentStream(
      query,
      thread_id,
      {
        onThinking: (step) => {
          sendEvent('thinking', { text: step });
        },
        onToken: (tok) => {
          sendEvent('token', { text: tok });
        },
        onSources: (sources) => {
          sendEvent('sources', sources);
        },
        onLatency: (latency) => {
          sendEvent('latency', latency);
        },
      },
      {
        fileFilter,
        sttMs: typeof sttMs === 'number' ? sttMs : 0,
      }
    );

    res.end();
  } catch (err: any) {
    console.error('Stream error:', err);
    sendEvent('thinking', { text: `⚠️ Error during reasoning: ${err.message || 'Unknown'}` });
    sendEvent('token', { text: '\n\nAn error occurred while generating the response.' });
    sendEvent('sources', []);
    res.end();
  }
};

app.post('/chat/stream', handleChatStream);
app.post('/api/chat/stream', handleChatStream);

// List Sessions
const handleListSessions = (_req: express.Request, res: express.Response) => {
  const sessionStore = getSessionStore();
  const sessions = sessionStore.listSessions();
  res.json({ sessions });
};

app.get('/sessions', handleListSessions);
app.get('/api/sessions', handleListSessions);

// Get Messages for Thread
const handleGetMessages = (req: express.Request, res: express.Response) => {
  const { thread_id } = req.params;
  const sessionStore = getSessionStore();
  const messages = sessionStore.getFilteredMessages(thread_id);
  res.json({ messages });
};

app.get('/sessions/:thread_id/messages', handleGetMessages);
app.get('/api/sessions/:thread_id/messages', handleGetMessages);

// Delete Session
const handleDeleteSession = (req: express.Request, res: express.Response) => {
  const { thread_id } = req.params;
  const sessionStore = getSessionStore();
  sessionStore.deleteSession(thread_id);
  res.json({ status: 'deleted' });
};

app.delete('/sessions/:thread_id', handleDeleteSession);
app.delete('/api/sessions/:thread_id', handleDeleteSession);

// Multi-PDF list of indexed files with chunk counts & pages
app.get('/api/documents', (_req: express.Request, res: express.Response) => {
  const retriever = getHybridRetriever();
  const sources = retriever.getDocumentSources();
  res.json({ documents: sources });
});

// View / Preview document for source click-through
app.get('/api/documents/:filename/view', (req: express.Request, res: express.Response) => {
  const { filename } = req.params;
  const storedName = fileStorageMap.get(filename) || filename;
  const filePath = path.join(uploadDir, storedName);

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      fs.createReadStream(filePath).pipe(res);
      return;
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ filename, content, type: ext });
      return;
    }
  }

  // Check seed docs or fallback
  const retriever = getHybridRetriever();
  const matchingChunks = retriever.getAllDocs().filter((d) => d.metadata.source === filename);
  if (matchingChunks.length > 0) {
    const fullText = matchingChunks.map((c) => c.pageContent).join('\n\n---\n\n');
    res.json({ filename, content: fullText, type: 'seed' });
    return;
  }

  res.status(404).json({ error: 'Document not found' });
});

// Document Upload & Structure-Aware Ingestion
const handleUpload = async (req: express.Request, res: express.Response) => {
  const files = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files provided' });
    return;
  }

  const retriever = getHybridRetriever();
  let totalChunks = 0;

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();

    try {
      if (ext === '.pdf') {
        const fileBuffer = fs.readFileSync(file.path);
        const extractedChunks = await parsePdfWithPages(fileBuffer, file.originalname);
        const added = await retriever.addDocuments(extractedChunks);
        totalChunks += added;
      } else {
        const fileContent = fs.readFileSync(file.path, 'utf-8');
        const extractedChunks = chunkStructuredText(fileContent, file.originalname, 1);
        const added = await retriever.addDocuments(extractedChunks);
        totalChunks += added;
      }
    } catch (err: any) {
      console.warn(`[Upload] Failed to process ${file.originalname}:`, err.message || err);
    }
  }

  res.json({
    message: 'Documents ingested successfully',
    details: {
      files_processed: files.length,
      chunks_created: totalChunks,
    },
  });
};

app.post('/upload', upload.array('files') as any, handleUpload);
app.post('/api/upload', upload.array('files') as any, handleUpload);

// Ingestion status / stats
app.get('/api/stats', (_req, res) => {
  const retriever = getHybridRetriever();
  res.json({
    totalDocuments: retriever.getDocCount(),
    sources: retriever.getDocumentSources(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE INTERACTION (Groq Whisper STT & Edge-TTS with Caching)
// ─────────────────────────────────────────────────────────────────────────────
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

// STT: Transcribe Audio with Latency Tracking
const handleVoiceTranscribe = async (req: express.Request, res: express.Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No audio file provided' });
    return;
  }

  const sttStart = Date.now();
  try {
    const text = await transcribeAudioWithGroqOrGemini(
      file.buffer,
      file.mimetype || 'audio/webm',
      file.originalname || 'recording.webm'
    );
    const sttMs = Date.now() - sttStart;
    res.json({ text, sttMs });
  } catch (err: any) {
    console.warn('[handleVoiceTranscribe] Error:', err.message || err);
    res.status(500).json({ error: err.message || 'Transcription failed' });
  }
};

app.post('/voice/transcribe', audioUpload.single('file') as any, handleVoiceTranscribe);
app.post('/api/voice/transcribe', audioUpload.single('file') as any, handleVoiceTranscribe);

// TTS: Speak Answer with Edge-TTS & Memory Cache
const handleVoiceTTS = async (req: express.Request, res: express.Response) => {
  const { text, voice, maxSentences } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'Missing text parameter' });
    return;
  }

  const ttsStart = Date.now();
  try {
    const result = await synthesizeEdgeTTS(
      text,
      voice,
      maxSentences !== undefined ? Number(maxSentences) : 0
    );
    const ttsMs = Date.now() - ttsStart;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Voice-Used', result.voice);
    res.setHeader('X-TTS-Latency-Ms', ttsMs.toString());
    res.setHeader('Cache-Control', 'no-cache');
    res.send(result.buffer);
  } catch (err: any) {
    console.warn('[handleVoiceTTS] TTS generation failed:', err.message || err);
    res.status(500).json({ error: err.message || 'TTS generation failed' });
  }
};

app.post('/voice/tts', handleVoiceTTS);
app.post('/api/voice/tts', handleVoiceTTS);

// ─────────────────────────────────────────────────────────────────────────────
// FRONTEND SERVING (Vite in dev, static in prod)
// ─────────────────────────────────────────────────────────────────────────────
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`[NaviGraph] Server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failure:', err);
  process.exit(1);
});
