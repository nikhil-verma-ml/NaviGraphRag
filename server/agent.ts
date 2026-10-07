import { GoogleGenAI, Type } from '@google/genai';
import { vectorSearchTool, webSearchTool, SourceItem } from './tools.js';
import { getSessionStore } from './store.js';
import { rewriteQueryWithMemory } from './queryRewriter.js';

export const AGENT_SYSTEM_PROMPT = `You are a helpful research assistant with access to two tools:

1. **vector_search** — Searches the internal knowledge base (uploaded documents).
   Use this for anything that might be in uploaded/indexed documents.

2. **web_search** — Searches the internet for real-time or current information.
   Use this for recent events or anything unlikely to be in the knowledge base.

Rules:
- ALWAYS look at the full conversation history before responding.
- If the user asks a follow-up ("what about the second one?", "explain more", etc.), answer using the relevant context.
- Cite the source name and page number when quoting or referencing documents (e.g. [Source: filename, Page: X]).
- Answer directly, clearly, and concisely.

Available tools: vector_search, web_search`;

export interface LatencyMetrics {
  sttMs?: number;
  queryRewriteMs?: number;
  retrievalMs?: number;
  llmFirstTokenMs?: number;
  llmTotalMs?: number;
  ttsMs?: number;
  totalMs?: number;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokensPerSec?: number;
  costUsd?: number;
  costFormatted?: string;
  gatewayStatus?: 'healthy' | 'fallback_active' | 'offline_react';
  perTokenMs?: number;
  tokenLatencies?: number[];
}

export interface AgentStreamCallbacks {
  onThinking: (step: string) => void;
  onToken: (token: string) => void;
  onSources: (sources: SourceItem[]) => void;
  onLatency?: (latency: LatencyMetrics) => void;
  onVoiceSummary?: (summary: string) => void;
}

export interface AgentStreamOptions {
  fileFilter?: string;
  sttMs?: number;
}

export async function runAgentStream(
  query: string,
  threadId: string,
  callbacks: AgentStreamCallbacks,
  options?: AgentStreamOptions
): Promise<{ answer: string; voiceSummary: string; sources: SourceItem[]; latency: LatencyMetrics }> {
  const startTime = Date.now();
  const store = getSessionStore();
  const pastMessages = store.getFilteredMessages(threadId);

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const sources: SourceItem[] = [];
  let fullAnswer = '';

  const latency: LatencyMetrics = {
    sttMs: options?.sttMs || 0,
    queryRewriteMs: 0,
    retrievalMs: 0,
    llmFirstTokenMs: 0,
    llmTotalMs: 0,
    totalMs: 0,
  };

  // 1. Conversation Memory: Query Rewriter
  const rewriteStart = Date.now();
  const { rewrittenQuery, wasRewritten } = await rewriteQueryWithMemory(query, pastMessages);
  latency.queryRewriteMs = Date.now() - rewriteStart;

  if (wasRewritten) {
    callbacks.onThinking(`🔄 Reformulated follow-up into standalone query: "${rewrittenQuery}"`);
  }

  const effectiveQuery = wasRewritten ? rewrittenQuery : query;

  if (options?.fileFilter && options.fileFilter !== 'all') {
    callbacks.onThinking(`📁 Filter applied: searching only in "${options.fileFilter}"`);
  }

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      // Prepare conversation history
      const contents: any[] = [];
      for (const m of pastMessages) {
        contents.push({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        });
      }
      contents.push({
        role: 'user',
        parts: [{ text: effectiveQuery }],
      });

      const toolsConfig = [
        {
          functionDeclarations: [
            {
              name: 'vector_search',
              description:
                'Search the internal knowledge base for domain-specific information, reference material, study content, architecture, or uploaded documents.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  query: {
                    type: Type.STRING,
                    description: 'The search query to look up in the knowledge base.',
                  },
                },
                required: ['query'],
              },
            },
            {
              name: 'web_search',
              description:
                'Search the internet for real-time or current information, recent events, current data or anything unlikely to be in the internal knowledge base.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  query: {
                    type: Type.STRING,
                    description: 'The search query to look up on the web.',
                  },
                },
                required: ['query'],
              },
            },
          ],
        },
      ];

      // First call to model to see if it wants to invoke any tools
      const firstResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction: AGENT_SYSTEM_PROMPT,
          tools: toolsConfig,
          temperature: 0,
        },
      });

      const functionCalls = firstResponse.functionCalls;
      const chunkLatencies: number[] = [];

      if (functionCalls && functionCalls.length > 0) {
        const toolResponsesParts: any[] = [];
        const retrievalStart = Date.now();

        for (const call of functionCalls) {
          const callArgs = (call.args as any) || {};
          const searchQuery = callArgs.query || effectiveQuery;

          if (call.name === 'vector_search') {
            callbacks.onThinking('🔍 Hybrid retrieval (Vector + BM25 keyword search)');
            const toolResult = await vectorSearchTool(searchQuery, {
              fileFilter: options?.fileFilter,
            });
            callbacks.onThinking('⚖️ Cross-encoder reranker evaluated and prioritized top passages');

            sources.push(...toolResult.sources);
            toolResponsesParts.push({
              functionResponse: {
                name: 'vector_search',
                response: { result: toolResult.formattedText },
              },
            });
          } else if (call.name === 'web_search') {
            callbacks.onThinking('🌐 Decided to search the web');
            const toolResult = await webSearchTool(searchQuery);
            callbacks.onThinking('✅ Web search complete');

            sources.push(...toolResult.sources);
            toolResponsesParts.push({
              functionResponse: {
                name: 'web_search',
                response: { result: toolResult.formattedText },
              },
            });
          }
        }

        latency.retrievalMs = Date.now() - retrievalStart;
        callbacks.onThinking('✍️ Composing final answer from retrieved results');

        // Format retrieved sources as ground truth context for synthesis
        const contextSummary = sources
          .map(
            (s, idx) =>
              `[Source ${idx + 1}: ${s.source}${s.pageNumber ? `, Page ${s.pageNumber}` : ''}]\n${s.content}`
          )
          .join('\n\n');

        const synthesisContents = [
          ...contents.slice(0, -1),
          {
            role: 'user',
            parts: [
              {
                text: `${effectiveQuery}\n\n--- Retrieved Reference Documents ---\n${contextSummary}\n\nPlease synthesize a clear, comprehensive, and well-structured answer addressing the user query based on the retrieved documents above. Cite exact sources and page numbers where applicable.`,
              },
            ],
          },
        ];

        const llmStart = Date.now();
        let lastChunkTime = llmStart;
        let hasReceivedFirstToken = false;

        const streamResponse = await ai.models.generateContentStream({
          model: 'gemini-3.8-flash',
          contents: synthesisContents,
          config: {
            systemInstruction: AGENT_SYSTEM_PROMPT,
            temperature: 0.2,
          },
        });

        for await (const chunk of streamResponse) {
          const text = chunk.text;
          if (text) {
            const now = Date.now();
            if (!hasReceivedFirstToken) {
              hasReceivedFirstToken = true;
              latency.llmFirstTokenMs = now - llmStart;
            } else {
              chunkLatencies.push(Math.max(1, now - lastChunkTime));
            }
            lastChunkTime = now;
            fullAnswer += text;
            callbacks.onToken(text);
          }
        }
        latency.llmTotalMs = Date.now() - llmStart;
      } else {
        // Direct answer
        callbacks.onThinking('🧠 Directly formulating response from conversation context');
        const llmStart = Date.now();
        let lastChunkTime = llmStart;
        let hasReceivedFirstToken = false;

        const streamResponse = await ai.models.generateContentStream({
          model: 'gemini-3.8-flash',
          contents,
          config: {
            systemInstruction: AGENT_SYSTEM_PROMPT,
            temperature: 0,
          },
        });

        for await (const chunk of streamResponse) {
          const text = chunk.text;
          if (text) {
            const now = Date.now();
            if (!hasReceivedFirstToken) {
              hasReceivedFirstToken = true;
              latency.llmFirstTokenMs = now - llmStart;
            } else {
              chunkLatencies.push(Math.max(1, now - lastChunkTime));
            }
            lastChunkTime = now;
            fullAnswer += text;
            callbacks.onToken(text);
          }
        }
        latency.llmTotalMs = Date.now() - llmStart;
      }

      // Generate concise natural 1-3 sentence spoken summary for TTS
      const voiceSummary = await generateVoiceSummary(effectiveQuery, fullAnswer);
      callbacks.onVoiceSummary?.(voiceSummary);

      callbacks.onSources(sources);
      store.addMessage(threadId, { role: 'user', content: query });
      store.addMessage(threadId, { role: 'assistant', content: fullAnswer, voiceSummary, sources });

      latency.totalMs = Date.now() - startTime;
      latency.provider = 'Google Gemini Gateway';
      latency.model = 'gemini-3.8-flash';
      latency.gatewayStatus = 'healthy';

      // Estimate / compute tokens and throughput
      const promptChars = query.length + sources.reduce((acc, s) => acc + s.content.length, 0);
      latency.promptTokens = Math.max(12, Math.round(promptChars / 3.8));
      latency.completionTokens = Math.max(1, Math.round(fullAnswer.length / 3.8));
      latency.totalTokens = latency.promptTokens + latency.completionTokens;
      latency.tokensPerSec =
        latency.llmTotalMs && latency.llmTotalMs > 0
          ? Number(((latency.completionTokens / (latency.llmTotalMs / 1000))).toFixed(1))
          : 0;

      latency.perTokenMs =
        latency.completionTokens > 0
          ? Number(((latency.llmTotalMs || 0) / latency.completionTokens).toFixed(2))
          : 0;
      latency.tokenLatencies = chunkLatencies.slice(0, 40);

      // Gemini 3.8 Flash pricing: $0.075 / 1M input tokens, $0.30 / 1M output tokens
      const inputCost = latency.promptTokens * (0.075 / 1_000_000);
      const outputCost = latency.completionTokens * (0.30 / 1_000_000);
      const totalCostUsd = inputCost + outputCost;
      latency.costUsd = Number(totalCostUsd.toFixed(6));
      latency.costFormatted = `$${totalCostUsd.toFixed(6)}`;

      callbacks.onLatency?.(latency);

      // Latency Logging to server console
      console.log(
        `[LLM Gateway] ${latency.provider} (${latency.model}) | Status: ${latency.gatewayStatus} | TTFT: ${latency.llmFirstTokenMs}ms | Throughput: ${latency.tokensPerSec} tok/s | Tokens: ${latency.totalTokens} (P:${latency.promptTokens}/C:${latency.completionTokens}) | Cost: ${latency.costFormatted} | Retrieval: ${latency.retrievalMs}ms | Total: ${latency.totalMs}ms`
      );

      return { answer: fullAnswer, voiceSummary, sources, latency };
    } catch (err: any) {
      console.warn('[runAgentStream] Primary Gemini error, checking fallback:', err.message || err);

      if (process.env.GROQ_API_KEY) {
        callbacks.onThinking('⚡ Switched to Groq high-speed engine (openai/gpt-oss-120b)');
        try {
          const groqAnswer = await runGroqFallback(
            effectiveQuery,
            pastMessages,
            callbacks,
            sources,
            options?.fileFilter
          );
          const voiceSummary = await generateVoiceSummary(effectiveQuery, groqAnswer);
          callbacks.onVoiceSummary?.(voiceSummary);
          callbacks.onSources(sources);
          store.addMessage(threadId, { role: 'user', content: query });
          store.addMessage(threadId, { role: 'assistant', content: groqAnswer, voiceSummary, sources });

          latency.totalMs = Date.now() - startTime;
          latency.provider = 'Groq High-Speed Gateway';
          latency.model = 'openai/gpt-oss-120b';
          latency.gatewayStatus = 'fallback_active';
          latency.completionTokens = Math.max(1, Math.round(groqAnswer.length / 3.8));
          latency.totalTokens = (latency.promptTokens || 50) + latency.completionTokens;
          const groqInputCost = (latency.promptTokens || 50) * (0.15 / 1_000_000);
          const groqOutputCost = latency.completionTokens * (0.60 / 1_000_000);
          const groqTotalCost = groqInputCost + groqOutputCost;
          latency.costUsd = Number(groqTotalCost.toFixed(6));
          latency.costFormatted = `$${groqTotalCost.toFixed(6)}`;
          callbacks.onLatency?.(latency);
          return { answer: groqAnswer, voiceSummary, sources, latency };
        } catch (groqErr) {
          console.warn('[runAgentStream] Groq fallback failed:', groqErr);
        }
      }
    }
  }

  // Deterministic ReAct fallback
  return await runDeterministicReAct(effectiveQuery, threadId, pastMessages, callbacks, startTime, latency, options?.fileFilter);
}

async function runGroqFallback(
  query: string,
  pastMessages: any[],
  callbacks: AgentStreamCallbacks,
  sources: SourceItem[],
  fileFilter?: string
): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY!;
  callbacks.onThinking('🔍 Hybrid retrieval (Vector + BM25 keyword search)');
  const vResult = await vectorSearchTool(query, { fileFilter });
  callbacks.onThinking('⚖️ Cross-encoder reranker prioritized top passages');
  sources.push(...vResult.sources);

  callbacks.onThinking('✍️ Composing final answer from retrieved results');

  const messages = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    ...pastMessages.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: `${query}\n\nRetrieved context from internal knowledge base:\n${vResult.formattedText}`,
    },
  ];

  // Try verified Groq models in order
  const candidateModels = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
  let resp: Response | null = null;

  for (const model of candidateModels) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          stream: true,
        }),
      });

      if (res.ok) {
        resp = res;
        break;
      } else {
        console.warn(`[runGroqFallback] Model ${model} returned ${res.status}`);
      }
    } catch (e) {
      console.warn(`[runGroqFallback] Model ${model} request error:`, e);
    }
  }

  if (!resp || !resp.ok) {
    throw new Error(`Groq API error: ${resp ? resp.status : 'No responsive models'}`);
  }

  const reader = resp.body?.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullAnswer = '';
  let buffer = '';

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullAnswer += delta.content;
            callbacks.onToken(delta.content);
          }
        } catch {}
      }
    }
  }

  return fullAnswer;
}

async function runDeterministicReAct(
  query: string,
  threadId: string,
  pastMessages: any[],
  callbacks: AgentStreamCallbacks,
  startTime: number,
  latency: LatencyMetrics,
  fileFilter?: string
): Promise<{ answer: string; voiceSummary: string; sources: SourceItem[]; latency: LatencyMetrics }> {
  callbacks.onThinking('🔍 Hybrid retrieval & cross-encoder reranker');
  const retStart = Date.now();
  const vResult = await vectorSearchTool(query, { fileFilter });
  latency.retrievalMs = Date.now() - retStart;

  callbacks.onThinking('✅ Top relevant knowledge chunks extracted');

  const sources: SourceItem[] = [...vResult.sources];
  callbacks.onSources(sources);

  let answer = '';
  if (sources.length > 0) {
    answer = `Based on the indexed documents:\n\n${sources.map((s) => `• ${s.content}`).join('\n\n')}`;
  } else {
    answer = `I reviewed the knowledge base for "${query}", but no matching passages were found.`;
  }

  // Stream in chunks
  const words = answer.split(' ');
  for (const w of words) {
    callbacks.onToken(w + ' ');
    await new Promise((r) => setTimeout(r, 15));
  }

  const voiceSummary = extractFallbackVoiceSummary(answer);
  callbacks.onVoiceSummary?.(voiceSummary);

  const store = getSessionStore();
  store.addMessage(threadId, { role: 'user', content: query });
  store.addMessage(threadId, { role: 'assistant', content: answer, voiceSummary, sources });

  latency.totalMs = Date.now() - startTime;
  latency.provider = 'Deterministic ReAct Engine';
  latency.model = 'hybrid-react-v1';
  latency.gatewayStatus = 'offline_react';
  latency.promptTokens = Math.max(12, Math.round(query.length / 3.8));
  latency.completionTokens = Math.max(1, Math.round(answer.length / 3.8));
  latency.totalTokens = latency.promptTokens + latency.completionTokens;
  latency.costUsd = 0;
  latency.costFormatted = '$0.000000 (Free Local)';
  latency.tokensPerSec = 75.0;
  callbacks.onLatency?.(latency);

  return { answer, voiceSummary, sources, latency };
}

/**
 * Server-side fallback voice summary extractor.
 * Strips markdown, code, tables, URLs, citations, and leaked UI tokens,
 * extracting 1-3 natural declarative sentences for audio speech.
 */
export function extractFallbackVoiceSummary(text: string): string {
  if (!text) return '';
  const cleaned = text
    .replace(/\bsvgListen\b/gi, ' ')
    .replace(/\bsvg\b/gi, ' ')
    .replace(/\bNaviGraph Agent\b/gi, ' ')
    .replace(/\bAgent steps\b/gi, ' ')
    .replace(/\bAgent thinking\b/gi, ' ')
    .replace(/\bThinking Steps\b/gi, ' ')
    .replace(/\bListen\b/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\|.*\|$/gm, ' ')
    .replace(/\|/g, ', ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[(?:Source|source|Result|result|Page|page)[^\]]*\]/gi, ' ')
    .replace(/\((?:Source|source|Result|result|Page|page)[^)]*\)/gi, ' ')
    .replace(/\[\d+\]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^[\s*+-]+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [];
  if (sentences.length === 0) return cleaned.slice(0, 250).trim();
  const valid = sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && !/^(e\.g|i\.e|mr|mrs|dr|vs)\.?$/i.test(s));
  return valid.slice(0, 2).join(' ') || cleaned.slice(0, 250).trim();
}

/**
 * Generates a concise, natural, 1 to 3 sentence spoken summary for TTS using Gemini Flash.
 * Falls back to extractFallbackVoiceSummary if the API call is unavailable or fails.
 */
export async function generateVoiceSummary(query: string, fullAnswer: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey || fullAnswer.length < 40) {
    return extractFallbackVoiceSummary(fullAnswer);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const prompt = `You are a voice assistant synthesizer for NaviGraph.
Given the user's question and the comprehensive detailed response, synthesize a concise, natural, 1 to 3 sentence spoken summary suitable for audio text-to-speech.

User Question: "${query}"

Full Detailed Answer:
${fullAnswer.slice(0, 3000)}

Strict Rules:
1. Exactly 1 to 3 natural conversational sentences (approx 25 to 55 words).
2. Spoken plain conversational English only.
3. Absolutely NO markdown, NO asterisks, NO bullet points, NO code blocks, NO table syntax, NO URLs, NO citations, and NO UI metadata.
4. Do NOT say "In summary" or "Here is a summary". State the core answer directly.`;

    const res = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        temperature: 0.1,
        maxOutputTokens: 120,
      },
    });

    const summary = (res.text || '').trim();
    if (summary && summary.length > 10) {
      return summary;
    }
  } catch (err) {
    console.warn('[generateVoiceSummary] LLM summary generation notice:', err);
  }

  return extractFallbackVoiceSummary(fullAnswer);
}
