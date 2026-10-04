# NaviGraph Backend

This folder contains the complete backend services for NaviGraph:

## Architecture
- **FastAPI Core (`backend/main.py`)**:
  - SSE Streaming (`/chat/stream` & `/api/chat/stream`): Streams thinking steps, tokens, sources, and latency breakdowns.
  - Hybrid Retrieval: Combined dense vector embeddings and BM25 keyword matching with Cross-Encoder reranking.
  - Caching Engine:
    - **Embedding Cache**: SHA-256 in-memory cache preventing duplicate vector computations.
    - **TTS Cache**: In-memory audio buffer cache returning repeated phrases in `< 1ms`.
  - Latency Tracking: Separately instruments and reports **STT**, **Query Rewrite**, **Retrieval**, **LLM TTFT**, **LLM Total**, and **TTS** latencies.
  - Voice Services (`/voice/transcribe`, `/voice/tts`): Groq Whisper STT + Edge-TTS synthesis.
  - Multi-PDF & Documents (`/upload`, `/documents`, `/documents/{filename}/view`): Structure-aware extraction, table preservation, and page-by-page PDF indexing.

## Running FastAPI
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Frontend Connection
The frontend connects seamlessly via standard REST and SSE endpoints (`/chat/stream`, `/voice/transcribe`, `/voice/tts`, `/upload`, etc.), configured either directly or via reverse proxy.
