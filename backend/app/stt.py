"""
STT Module for NaviGraph (FastAPI)
Transcribes audio using Groq Whisper or Gemini.
"""

import os
import time
import httpx
from typing import Tuple

async def transcribe_audio(file_bytes: bytes, filename: str = "voice.webm") -> Tuple[str, int]:
    start_time = time.time()
    groq_key = os.getenv("GROQ_API_KEY")

    if groq_key:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                files = {"file": (filename, file_bytes, "audio/webm")}
                data = {
                    "model": "whisper-large-v3-turbo",
                    "prompt": "Transcribe verbatim English, Hindi (हिंदी), and Hinglish speech.",
                    "response_format": "json"
                }
                headers = {"Authorization": f"Bearer {groq_key}"}
                resp = await client.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    files=files,
                    data=data,
                    headers=headers
                )
                if resp.status_code == 200:
                    result = resp.json()
                    text = result.get("text", "").strip()
                    stt_ms = int((time.time() - start_time) * 1000)
                    return text, stt_ms
        except Exception as e:
            print(f"[STT] Groq error: {e}")

    stt_ms = int((time.time() - start_time) * 1000)
    return "", stt_ms
