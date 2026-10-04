import { GoogleGenAI } from '@google/genai';

export async function transcribeAudioWithGroqOrGemini(
  audioBuffer: Buffer,
  mimeType = 'audio/webm',
  filename = 'recording.webm'
): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;

  // 1. Primary: Groq Whisper (model: whisper-large-v3-turbo)
  if (groqKey) {
    try {
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, filename);
      formData.append('model', 'whisper-large-v3-turbo');
      // Prompt guides whisper to correctly transcribe English, Hindi, and mixed Hinglish
      formData.append('prompt', 'Transcribe verbatim English, Hindi (हिंदी), and mixed Hinglish speech.');
      formData.append('response_format', 'json');

      const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
        },
        body: formData,
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = (data.text || '').trim();
        if (text) {
          return text;
        }
      } else {
        const errText = await resp.text();
        console.warn('[STT] Groq Whisper error status:', resp.status, errText);
      }
    } catch (groqErr) {
      console.warn('[STT] Groq Whisper network error:', groqErr);
    }
  }

  // 2. Fallback: Google Gemini audio transcription if GEMINI_API_KEY is available
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBuffer.toString('base64'),
              },
            },
            {
              text: 'Transcribe this audio recording exactly as spoken. It may contain English, Hindi, or mixed Hinglish. Output only the transcribed text with no explanations or timestamps.',
            },
          ],
        },
      });

      const text = (response.text || '').trim();
      if (text) {
        return text;
      }
    } catch (geminiErr) {
      console.warn('[STT] Gemini transcription fallback error:', geminiErr);
    }
  }

  throw new Error('Transcription service unavailable. Please check your GROQ_API_KEY or type your question.');
}
