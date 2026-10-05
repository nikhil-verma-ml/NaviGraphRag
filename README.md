# NaviGraph — Voice-First Agentic RAG System

[![Frontend Status](https://img.shields.io/badge/Frontend-https%3A%2F%2Fnavigraphai.vercel.app-blue)](https://navigraphai.vercel.app/)
[![Backend Status](https://img.shields.io/badge/Backend-https%3A%2F%2Fnavigraph--api.vercel.app-emerald)](https://navigraph-api.vercel.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4.0-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Recharts](https://img.shields.io/badge/Recharts-2.x-22c55e)](https://recharts.org/)

**NaviGraph** is a high-speed, voice-first **Agentic Retrieval-Augmented Generation (RAG)** platform designed for conversational exploration of multi-page technical documents, enterprise PDFs, and live knowledge bases. It pairs a **ChatGPT-web-style floating Voice Mode** with a progressive streaming chat interface, hybrid vector/BM25 retrieval, cross-encoder reranking, and full LLM gateway telemetry.

---

## Live Deployments

| Component | Production URL | Description |
| :--- | :--- | :--- |
| **Frontend UI** | [https://navigraphai.vercel.app/](https://navigraphai.vercel.app/) | React 19 SPA with Floating Voice Orb, Document Viewer, Recharts Telemetry Dashboard |
| **Backend API** | [https://navigraph-api.vercel.app/](https://navigraph-api.vercel.app/) | Express + Node.js API with SSE streaming, Hybrid Vector Search, Edge-TTS, and STT |

---

## System Architecture & End-to-End Flow Graph

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │               USER BROWSER / CLIENT                    │
                                    │         https://navigraphai.vercel.app/               │
                                    └────────────────────────────────────────────────────────┘
                                               │                                  ▲
                                   Voice / Mic │                      Live Tokens │ & Audio
                                       (WebRTC/VAD)                       (SSE)   │
                                               ▼                                  │
┌─────────────────────────────────────────────────────────────────────────────────┴──────────┐
│                             NAVIGRAPH BACKEND API GATEWAY                                  │
│                          https://navigraph-api.vercel.app/                                 │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                            │
│   [POST /voice/transcribe] ──────> Whisper / Groq STT Engine ──────> Raw User Question     │
│                                                                             │              │
│   [POST /chat/stream]                                                       │              │
│       │                                                                     ▼              │
│       ├───────────────────────────────────────────────► 1. Query Contextualizer & Rewriter │
│       │                                                                     │              │
│       ▼                                                                     ▼              │
│   ┌────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                      2. HYBRID RETRIEVAL & RERANKING ENGINE                        │   │
│   │                                                                                    │   │
│   │      ┌───────────────────────────────┐     ┌──────────────────────────────┐        │   │
│   │      │ Dense Semantic Vector Search  │     │ BM25 Sparse Keyword Search   │        │   │
│   │      │ (In-memory cosine similarity) │     │ (Exact term matching)        │        │   │
│   │      └──────────────┬────────────────┘     └──────────────┬───────────────┘        │   │
│   │                     │                                     │                        │   │
│   │                     └───────────────────┬─────────────────┘                        │   │
│   │                                         ▼                                          │   │
│   │                             Ensemble Candidate Chunks                              │   │
│   │                                         ▼                                          │   │
│   │                           Cross-Encoder Reranker Scoring                           │   │
│   │                                         ▼                                          │   │
│   │                         Top-K Context Chunks + Page #s                             │   │
│   └─────────────────────────────────────────┬──────────────────────────────────────────┘   │
│                                             ▼                                              │
│   ┌────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                         3. LLM GATEWAY REASONING LOOP                              │   │
│   │                                                                                    │   │
│   │      Primary Route: Google Gemini 3.8 Flash (Streaming via @google/genai SDK)      │   │
│   │      Failover Route 1: Groq High-Speed Gateway (openai/gpt-oss-120b)               │   │
│   │      Failover Route 2: Deterministic ReAct In-Memory Synthesis Engine              │   │
│   └─────────────────────────────────────────┬──────────────────────────────────────────┘   │
│                                             │                                              │
│                        Token Stream Stream  │                                              │
│                                             ├───────────────► 4. Sentence Chunk Splitter   │
│                                             │                         │                    │
│                                             ▼                         ▼                    │
│                        SSE: 'data: {"token": "..."}'          Edge-TTS Audio Synth         │
│                        SSE: 'event: latency'                          │                    │
│                                             │                         ▼                    │
│                                             │                 [POST /voice/tts]            │
│                                             │            (WAV / MP3 Binary Stream)         │
│                                             ▼                         ▼                    │
└─────────────────────────────────────────────┬─────────────────────────┬────────────────────┘
                                              │                         │
                                              ▼                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                                FRONTEND REACT RUNTIME                                      │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                            │
│   ┌────────────────────────────────────────────────┐   ┌───────────────────────────────┐   │
│   │ 1. Continuous Chat Feed (100% visible)         │   │ 2. Floating Voice Orb Widget  │   │
│   │ • Live progressive token markdown rendering    │   │ • 56px reactive circular orb  │   │
│   │ • Page-level PDF click-through & viewer modal  │   │ • Web Audio API AnalyserNode  │   │
│   │ • LLM telemetry footer table (TTFT, $, tok/s)  │   │ • Live audio volume scaling   │   │
│   │ • Recharts visual latency & cost dashboard     │   │ • Interrupt, Mute & Exit      │   │
│   └────────────────────────────────────────────────┘   └───────────────────────────────┘   │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Highlights

### 1. ChatGPT-Web-Style Floating Voice Mode
* **Non-blocking floating presence**: Voice Mode floats as a compact widget (`fixed bottom-24 right-6`) over the chat screen instead of blocking or replacing the interface.
* **Continuous live chat stream**: Users can read the AI response streaming in the main chat view, review past messages, and scroll freely while listening.
* **Web Audio API-driven Voice Orb**:
  * Connected to an `AnalyserNode` calculating 60FPS frequency energy.
  * Dynamically scales and glows using GPU-accelerated CSS transforms (`transform: scale(...)`).
  * Seamless state transitions:
    * `IDLE`: Subtle resting pearl animation.
    * `LISTENING`: Pulsing cyan glow indicating live microphone capture.
    * `THINKING`: Hypnotic amber/gold celestial wave during RAG search.
    * `SPEAKING`: Electric indigo/purple expansion reacting in real time to TTS audio.
* **Instant Barge-in**: Tapping "Interrupt" or speaking interrupts TTS playback instantly and transfers control back to the user.

### 2. Multi-PDF Document Ingestion & Page-Level Grounding
* **Structured PDF Chunking**: Extracts raw text while tracking original page numbers.
* **Multi-PDF Filter Selector**: Focus queries on specific files or search across all indexed documents simultaneously.
* **Document Viewer Modal**: Click any cited source to inspect the passage directly on the exact page.

### 3. LLM Gateway Telemetry & Recharts Analytics
* **Telemetry Table**: Rendered in the chat footer of every assistant turn:
  * **Latency**: Time to First Token (TTFT), LLM Generation Time, Hybrid Retrieval, Total Turnaround.
  * **Token Usage**: Prompt tokens, Completion tokens, Total billable tokens, Throughput ($\text{tok/s}$).
  * **Cost Estimation**: Accurate sub-cent billing based on token unit pricing ($\$0.075 / 1\text{M}$ input, $\$0.30 / 1\text{M}$ output).
* **LatencyMetricsDashboard**:
  * Horizontal pipeline breakdown (`BarChart`).
  * Per-token streaming latency timeline (`AreaChart`).
  * Token context distribution (`PieChart`).

---

## Connecting Frontend with Backend

The frontend (`https://navigraphai.vercel.app`) communicates with the backend (`https://navigraph-api.vercel.app`) through the centralized API configuration in `src/utils/api.ts`:

```typescript
// src/utils/api.ts
export const API_BASE_URL: string = (() => {
  // 1. Explicit environment variable
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/+$/, '');
  }
  // 2. Auto-detect Vercel deployment
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return 'https://navigraph-api.vercel.app';
  }
  // 3. Local dev fallback (relative proxy)
  return '';
})();
```

### CORS Configuration
The backend explicitly allows requests from `https://navigraphai.vercel.app`, Vercel preview URLs, and `localhost`:

```typescript
// server.ts
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        origin.includes('navigraphai.vercel.app') ||
        origin.includes('navigraph-api.vercel.app') ||
        origin.includes('localhost') ||
        origin.endsWith('.vercel.app')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    exposedHeaders: ['X-TTS-Latency-Ms'],
  })
);
```

---

## Environment Variables

Configure these variables in your deployment settings:

### Frontend (.env or Vercel Environment Variables)
```bash
# Point frontend to production backend URL
VITE_API_URL=https://navigraph-api.vercel.app
```

### Backend (.env or Vercel / Cloud Run Environment Variables)
```bash
# Primary LLM API Key (Google AI Studio)
GEMINI_API_KEY=your_gemini_api_key_here

# Optional High-Speed Fallback API Key (Groq)
GROQ_API_KEY=your_groq_api_key_here

# Server Port (default 3000)
PORT=3000
```

---

## API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` or `/api/health` | Service health status and origin permissions |
| `POST` | `/chat/stream` | Server-Sent Events (SSE) chat stream with thinking steps, tokens, and latency |
| `POST` | `/voice/transcribe` | Multipart audio upload for Whisper / Gemini STT |
| `POST` | `/voice/tts` | Edge-TTS sentence audio synthesizer |
| `GET` | `/sessions` | List active chat threads |
| `GET` | `/sessions/:id/messages` | Load historical messages for a thread |
| `DELETE` | `/sessions/:id` | Delete a session and its message store |
| `POST` | `/upload` | Multipart upload for PDF and TXT documents |
| `GET` | `/api/documents` | List indexed documents and chunk statistics |
| `GET` | `/api/documents/:filename/view` | Stream raw PDF or JSON document content |

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start the unified development server (Vite + Express on port 3000)
npm run dev

# 3. Build for production
npm run build

# 4. Run production server
npm start
```
