"""
FastAPI Routes for NaviGraph
Uses absolute imports starting with 'app.' for Vercel serverless deployment.
"""

import time
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Absolute imports starting with 'app.'
from app.retriever import retriever_instance
from app.tts import synthesize_speech
from app.stt import transcribe_audio
from app.agent import stream_agent

router = APIRouter()

sessions_store: Dict[str, List[Dict[str, Any]]] = {}

class ChatStreamRequest(BaseModel):
    query: str
    thread_id: str
    fileFilter: Optional[str] = "all"
    sttMs: Optional[int] = 0

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "en-IN-NeerjaNeural"
    maxSentences: Optional[int] = 0

@router.get("/")
def read_root():
    return {
        "status": "online",
        "framework": "FastAPI",
        "service": "NaviGraph Python Backend",
        "endpoints": [
            "/chat/stream",
            "/voice/transcribe",
            "/voice/tts",
            "/upload",
            "/documents",
            "/sessions",
            "/api/stats"
        ]
    }

@router.get("/api/stats")
def get_stats():
    docs = retriever_instance.list_documents()
    return {
        "totalDocuments": sum(d["chunkCount"] for d in docs),
        "sources": [d["source"] for d in docs]
    }

@router.get("/documents")
@router.get("/api/documents")
def list_documents():
    return {"documents": retriever_instance.list_documents()}

@router.post("/chat/stream")
@router.post("/api/chat/stream")
async def chat_stream(req: ChatStreamRequest):
    """
    FastAPI SSE Streaming endpoint:
    Streams thinking events, tokens, sources, and full latency breakdowns.
    """
    past_messages = sessions_store.get(req.thread_id, [])
    
    if req.thread_id not in sessions_store:
        sessions_store[req.thread_id] = []
    sessions_store[req.thread_id].append({"role": "user", "content": req.query})

    async def event_generator():
        async for chunk in stream_agent(
            query=req.query,
            thread_id=req.thread_id,
            past_messages=past_messages,
            file_filter=req.fileFilter,
            stt_ms=req.sttMs or 0
        ):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/voice/transcribe")
@router.post("/api/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...)):
    """
    Audio transcription endpoint with latency reporting.
    """
    file_bytes = await file.read()
    transcribed_text, stt_ms = await transcribe_audio(file_bytes, file.filename or "recording.webm")
    return {"text": transcribed_text, "sttMs": stt_ms}

@router.post("/voice/tts")
@router.post("/api/voice/tts")
async def voice_tts(req: TTSRequest):
    """
    Text-to-Speech endpoint with in-memory caching.
    """
    audio_bytes, latency_ms, is_cached = await synthesize_speech(req.text, req.voice or "en-IN-NeerjaNeural")
    headers = {
        "X-Voice-Used": req.voice or "en-IN-NeerjaNeural",
        "X-TTS-Latency-Ms": str(latency_ms),
        "X-Cache-Hit": "true" if is_cached else "false"
    }
    return Response(content=audio_bytes, media_type="audio/mpeg", headers=headers)

@router.post("/upload")
@router.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    """
    Document upload endpoint supporting PDF, Markdown, and Text files.
    """
    filename = file.filename or "uploaded_doc.txt"
    content_bytes = await file.read()
    text = content_bytes.decode("utf-8", errors="ignore")

    lines = [p.strip() for p in text.split("\n\n") if p.strip()]
    count = 0
    for idx, para in enumerate(lines[:30]):
        retriever_instance.add_document(content=para, source=filename, page_number=(idx // 3) + 1)
        count += 1

    return {
        "success": True,
        "filename": filename,
        "chunks": count,
        "message": f"Successfully indexed {filename} ({count} chunks)"
    }

@router.get("/sessions")
@router.get("/api/sessions")
def list_sessions():
    sessions = []
    for tid, msgs in sessions_store.items():
        first_msg = msgs[0]["content"] if msgs else "Conversation"
        sessions.append({
            "thread_id": tid,
            "title": first_msg[:40],
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "last_active_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
        })
    return {"sessions": sessions}
