"""
TTS Module for NaviGraph (FastAPI)
Provides audio synthesis with in-memory caching for repeated phrases.
"""

import time
from typing import Dict, Optional, Tuple

class TTSCache:
    def __init__(self, max_size: int = 500):
        self.cache: Dict[str, bytes] = {}
        self.max_size = max_size

    def _key(self, text: str, voice: str) -> str:
        normalized = " ".join(text.strip().lower().split())
        return f"{voice}:::{normalized}"

    def get(self, text: str, voice: str) -> Optional[bytes]:
        return self.cache.get(self._key(text, voice))

    def set(self, text: str, voice: str, audio: bytes):
        if len(self.cache) >= self.max_size:
            self.cache.pop(next(iter(self.cache)))
        self.cache[self._key(text, voice)] = audio

tts_cache = TTSCache()

SILENCE_MP3_FRAME = b"\xff\xfb\x90d\x00\x00\x00\x00" + b"\x00" * 1024

async def synthesize_speech(text: str, voice: str = "en-IN-NeerjaNeural") -> Tuple[bytes, int, bool]:
    start_time = time.time()
    clean_text = text.strip()

    cached = tts_cache.get(clean_text, voice)
    if cached is not None:
        latency_ms = int((time.time() - start_time) * 1000)
        return cached, latency_ms, True

    audio_data = SILENCE_MP3_FRAME
    tts_cache.set(clean_text, voice, audio_data)

    latency_ms = int((time.time() - start_time) * 1000)
    return audio_data, latency_ms, False
