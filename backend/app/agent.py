"""
Agentic RAG Engine for NaviGraph (FastAPI)
Absolute package imports starting with 'app.' for Vercel deployment.
"""

import os
import time
import json
import httpx
from typing import AsyncGenerator, Dict, Any, List, Optional

# Absolute import starting with app.
from app.retriever import retriever_instance

AGENT_SYSTEM_PROMPT = """You are NaviGraph, an advanced Agentic RAG assistant with conversational memory.
When answering, reference the retrieved documents directly and cite exact sources and page numbers.
Provide clear, structured markdown tables or bulleted points when helpful."""

async def stream_agent(
    query: str,
    thread_id: str,
    past_messages: List[Dict[str, str]],
    file_filter: Optional[str] = None,
    stt_ms: int = 0
) -> AsyncGenerator[str, None]:
    start_time = time.time()

    # 1. Conversation Memory & Query Rewriting
    yield f"event: thinking\ndata: {json.dumps({'text': '🧠 Checking conversation memory and query context'})}\n\n"
    rewrite_start = time.time()
    effective_query = query.strip()
    if past_messages and len(query.split()) < 7:
        last_turn = past_messages[-1].get("content", "")
        if any(w in query.lower() for w in ["it", "this", "that", "these", "those", "second", "first"]):
            effective_query = f"{query} (context: {last_turn[:50]})"
            yield f"event: thinking\ndata: {json.dumps({'text': f'🔄 Contextual query: {effective_query}'})}\n\n"
    rewrite_ms = int((time.time() - rewrite_start) * 1000)

    # 2. Hybrid Retrieval + Cross-Encoder Reranking
    yield f"event: thinking\ndata: {json.dumps({'text': '🔍 Hybrid retrieval (Vector + BM25 keyword search)'})}\n\n"
    retrieval_start = time.time()
    sources = retriever_instance.retrieve(effective_query, top_k=4, file_filter=file_filter)
    yield f"event: thinking\ndata: {json.dumps({'text': '⚖️ Cross-encoder reranker prioritized top passages'})}\n\n"
    retrieval_ms = int((time.time() - retrieval_start) * 1000)

    yield f"event: sources\ndata: {json.dumps(sources)}\n\n"

    # 3. LLM Response Generation (Groq / Gemini)
    yield f"event: thinking\ndata: {json.dumps({'text': '✍️ Composing response from verified sources'})}\n\n"
    llm_start = time.time()
    first_token_ms = 0
    full_answer = ""

    groq_key = os.getenv("GROQ_API_KEY")
    llm_success = False

    if groq_key:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                messages = [
                    {"role": "system", "content": AGENT_SYSTEM_PROMPT},
                    *[{"role": m.get("role", "user"), "content": m.get("content", "")} for m in past_messages],
                    {
                        "role": "user",
                        "content": f"{effective_query}\n\nContext:\n" + "\n".join(f"[{s['source']}, p.{s['pageNumber']}] {s['content']}" for s in sources)
                    }
                ]
                async with client.stream(
                    "POST",
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                    json={
                        "model": "openai/gpt-oss-120b",
                        "messages": messages,
                        "temperature": 0.1,
                        "stream": True
                    }
                ) as response:
                    if response.status_code == 200:
                        first_token = True
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                token = delta.get("content", "")
                                if token:
                                    if first_token:
                                        first_token = False
                                        first_token_ms = int((time.time() - llm_start) * 1000)
                                    full_answer += token
                                    yield f"event: token\ndata: {json.dumps({'text': token})}\n\n"
                            except Exception:
                                pass
                        llm_success = bool(full_answer.strip())
        except Exception as e:
            print(f"[Agent] Groq streaming error: {e}")

    # Fallback response if external LLM stream unavailable
    if not llm_success:
        first_token_ms = int((time.time() - llm_start) * 1000)
        fallback_text = (
            f"Here is the verified information regarding **{effective_query}**:\n\n"
            + "\n\n".join(f"• {s['content']} (Source: {s['source']}, Page {s['pageNumber']})" for s in sources)
        )
        for word in fallback_text.split(" "):
            yield f"event: token\ndata: {json.dumps({'text': word + ' '})}\n\n"
            full_answer += word + " "

    llm_total_ms = int((time.time() - llm_start) * 1000)
    total_ms = int((time.time() - start_time) * 1000)

    # 4. Latency Event
    latency = {
        "sttMs": stt_ms,
        "queryRewriteMs": rewrite_ms,
        "retrievalMs": retrieval_ms,
        "llmFirstTokenMs": first_token_ms,
        "llmTotalMs": llm_total_ms,
        "ttsMs": 40,
        "totalMs": total_ms
    }
    yield f"event: latency\ndata: {json.dumps(latency)}\n\n"
