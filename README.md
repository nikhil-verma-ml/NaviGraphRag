# NaviGraph — Voice-First Agentic RAG System

[![Frontend Status](https://img.shields.io/badge/Frontend-https%3A%2F%2Fnavigraphai.vercel.app-blue)](https://navigraphai.vercel.app/)
[![Backend Status](https://img.shields.io/badge/Backend-https%3A%2F%2Fnavigraph--api.vercel.app-emerald)](https://navigraph-api.vercel.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4.0-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Recharts](https://img.shields.io/badge/Recharts-2.x-22c55e)](https://recharts.org/)

**NaviGraph** is a high-speed, voice-first **Agentic Retrieval-Augmented Generation (RAG)** platform designed for conversational exploration of multi-page technical documents, enterprise PDFs, and live knowledge bases. It pairs a **floating Voice Mode widget with interchangeable visualizer styles** with a progressive streaming chat interface, hybrid vector/BM25 retrieval, cross-encoder reranking, robust Web Audio API autoplay resumption, and full LLM gateway telemetry.

---

## Live Deployments

| Component | Production URL | Description |
| :--- | :--- | :--- |
| **Frontend UI** | [https://navigraphai.vercel.app/](https://navigraphai.vercel.app/) | React 19 SPA with Floating Voice Orb, Multi-Style Visualizer, Document Viewer, Recharts Telemetry Dashboard |
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
│   │ 1. Continuous Chat Feed (100% visible)         │   │ 2. Floating Voice Widget       │   │
│   │ • Live progressive token markdown rendering    │   │ • fixed bottom-6 right-6 w-72 │   │
│   │ • Page-level PDF click-through & viewer modal  │   │ • Multi-Style VoiceOrb Engine │   │
│   │ • LLM telemetry footer table (TTFT, $, tok/s)  │   │   - 🟣 3D Circular Orb        │   │
│   │ • Recharts visual latency & cost dashboard     │   │   - 📊 Bar Graph Spectrum     │   │
│   │ • Visual 'Unmute/Activate Audio' button        │   │   - 🌊 Circular Ripple Waves  │   │
│   │ • Autoplay AudioContext recovery               │   │ • Real-time Web Audio Analyser│   │
│   │                                                │   │ • Settings icon & persistence │   │
│   └────────────────────────────────────────────────┘   └───────────────────────────────┘   │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Voice Mode & Orb Visualization Engine

### 1. Visualization Styles Toggle
Users can customize the live VoiceOrb animation style in real time by clicking the **Settings (`⚙️`)** icon located in the floating card header. Preferences are saved automatically to `localStorage`:

```
                       ┌──────────────────────────────────────────────┐
                       │           VOICE ORB VISUALIZATION            │
                       └──────────────────────┬───────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
         ┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
         │   1. CIRCULAR ORB   │   │  2. BAR SPECTRUM    │   │  3. RIPPLE WAVES    │
         │     ('circular')    │   │      ('bars')       │   │      ('wave')       │
         ├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
         │ • 3D radial sphere  │   │ • 9-band equalizer  │   │ • Concentric radar  │
         │ • Specular light    │   │ • Dynamic heights   │   │   acoustic rings    │
         │ • Diffuse aura glow │   │ • Frequency binning │   │ • Radial dispersion │
         │ • Scale transforms  │   │ • Pill-shaped caps  │   │ • Pulse core        │
         └─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

* **🟣 Circular 3D Orb (`circular`)**: The signature floating celestial sphere rendered with multi-layered specular highlight reflections, dynamic ambient aura, and 60FPS scale lerping responding to audio frequency energy.
* **📊 Bar Graph Spectrum (`bars`)**: A 9-band vertical equalizer spectrum whose individual bar heights jump and dance dynamically according to real-time Web Audio API frequency bins and audio level.
* **🌊 Circular Ripple Waves (`wave`)**: Concentric acoustic sound wave rings that radiate outward dynamically from an inner core based on vocal intensity and harmonic resonance.

### 2. Voice State Machine

```
      ┌─────────────────────────────────────────────────────────────────────┐
      │                                IDLE                                 │
      │                  (Resting soft pearl glow, 0.92x)                   │
      └──────────────────────────────────┬──────────────────────────────────┘
                                         │ User clicks Voice / Mic
                                         ▼
      ┌─────────────────────────────────────────────────────────────────────┐
      │                              LISTENING                              │
      │        (Electric Cyan pulse, live mic analyser volume tracking)     │
      └──────────────────────────────────┬──────────────────────────────────┘
                                         │ VAD detects silence / user speaks
                                         ▼
      ┌─────────────────────────────────────────────────────────────────────┐
      │                              THINKING                               │
      │            (Celestial Amber breathing wave, RAG Retrieval)          │
      └──────────────────────────────────┬──────────────────────────────────┘
                                         │ First token & TTS audio chunks arrive
                                         ▼
      ┌─────────────────────────────────────────────────────────────────────┐
      │                              SPEAKING                               │
      │     (Luminous Indigo expansion, 1.35x scale, real-time TTS sync)     │
      └──────────────────────────────────┬──────────────────────────────────┘
                                         │ Audio finishes / Queue empty
                                         └─────────► Auto-returns to LISTENING
                                                     (or IDLE on exit)
```

---

## Audio Autoplay Resumption & Telemetry

Modern browsers (Chrome, Edge, Safari) strictly enforce Autoplay policies that suspend an `AudioContext` until a direct user gesture occurs. NaviGraph implements an ironclad resumption strategy:

### Resumption Flow Graph

```
                                [Browser Initial Load]
                                          │
                                          ▼
                               AudioContext: 'suspended'
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   │                                             │
                   ▼                                             ▼
       [Navbar Warning Button]                       [Floating Voice Widget]
    "Unmute / Activate Audio"                     "Unmute / Activate Audio"
                   │                                             │
                   └──────────────────────┬──────────────────────┘
                                          │
                            User Click (Primary Gesture)
                                          │
                                          ▼
                         await audioContext.resume()
                         await queue.resumeAudioContext()
                                          │
                                          ▼
                               AudioContext: 'running'
                                          │
                                          ▼
                       Buttons auto-dismiss; Audio unlocked
```

### Explicit Verification Logging
* `StreamingAudioQueue.enqueueSentence` logs:
  * Raw and sanitized sentence strings.
  * AudioContext state verification (`running` vs `suspended`).
  * Outgoing `/voice/tts` request dispatch, latency in milliseconds, and HTTP status.
  * Binary audio Blob reception, byte count verification, and audio element instantiation.
* `src/App.tsx` logs:
  * AudioContext instantiation parameters (`sampleRate`, `baseLatency`, initial state).
  * Real-time `onstatechange` transitions.
  * Full trace during `handleActivateAudio` clicks before and after resumption.

---

## Agentic RAG Pipeline with Document Grounding

NaviGraph combines dense neural semantic search with exact sparse BM25 retrieval to achieve grounded answers with verifiable page-level citations:

```
[User Query] ────────────────────────────────────────────────────────┐
                                                                     ▼
                                                   ┌───────────────────────────────────┐
                                                   │   Contextual Query Rewriting      │
                                                   └─────────────────┬─────────────────┘
                                                                     │
                                      ┌──────────────────────────────┴──────────────────────────────┐
                                      ▼                                                             ▼
                       ┌───────────────────────────────┐                             ┌──────────────────────────────┐
                       │  Dense Semantic Vector Search │                             │  BM25 Sparse Lexical Search  │
                       │   (Cosine similarity scoring) │                             │   (Exact token occurrences)  │
                       └──────────────┬────────────────┘                             └──────────────┬───────────────┘
                                      │                                                             │
                                      └──────────────────────────────┬──────────────────────────────┘
                                                                     ▼
                                                   ┌───────────────────────────────────┐
                                                   │    Hybrid Candidate Aggregation   │
                                                   └─────────────────┬─────────────────┘
                                                                     ▼
                                                   ┌───────────────────────────────────┐
                                                   │   Cross-Encoder Reranker Scoring  │
                                                   └─────────────────┬─────────────────┘
                                                                     ▼
                                                   ┌───────────────────────────────────┐
                                                   │     Top-K Ranked Context Chunks   │
                                                   └─────────────────┬─────────────────┘
                                                                     ▼
                                                   ┌───────────────────────────────────┐
                                                   │    Page-Level PDF Grounding &     │
                                                   │    Source Citation Attachments    │
                                                   └───────────────────────────────────┘
```

---

## LLM Gateway Telemetry & Recharts Analytics

Every assistant response streams structured performance metrics displayed in both an inline footer table and an interactive **LLM Gateway Performance Dashboard** powered by Recharts:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        LLM GATEWAY REAL-TIME PERFORMANCE METRICS                       │
├────────────────────┬────────────────────┬────────────────────┬─────────────────────────┤
│ TTFT (First Token) │ Generation Speed   │ Prompt / Out Toks  │ Estimated Cost          │
│ 320 ms             │ 84.2 tok/s         │ 1,420 / 380 toks   │ $0.00022 USD            │
└────────────────────┴────────────────────┴────────────────────┴─────────────────────────┘
```

* **Time to First Token (TTFT)**: Visualized in latency pipeline bar charts breaking down STT, retrieval, reranking, and first token arrival.
* **Token Throughput Timeline**: Area charts showing per-second token emission velocity.
* **Context Ratio Distribution**: Donut and pie charts displaying Prompt vs. Retrieved Document Context vs. Completion tokens.

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
