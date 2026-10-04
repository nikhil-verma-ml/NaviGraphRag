import { GoogleGenAI } from '@google/genai';

/**
 * Conversation Memory: Query Rewriter.
 * Rewrites ambiguous follow-up questions (e.g. "what about the second one?", "explain more")
 * into self-contained standalone search queries using preceding conversation turns.
 */
export async function rewriteQueryWithMemory(
  query: string,
  pastMessages: { role: string; content: string }[]
): Promise<{ rewrittenQuery: string; wasRewritten: boolean }> {
  const trimmed = query.trim();

  // If no past messages or query is already long/complex, no need to rewrite
  if (!pastMessages || pastMessages.length === 0) {
    return { rewrittenQuery: trimmed, wasRewritten: false };
  }

  // Quick heuristic check for follow-up markers
  const followUpIndicators = [
    /\b(it|that|this|these|those)\b/i,
    /\b(the second|the first|the third|the other|another|both)\b/i,
    /\b(what about|how about|tell me more|explain more|elaborate)\b/i,
    /\b(why|how so|and then|what else)\b/i,
  ];

  const looksLikeFollowUp =
    trimmed.length < 50 || followUpIndicators.some((regex) => regex.test(trimmed));

  if (!looksLikeFollowUp && trimmed.length > 70) {
    return { rewrittenQuery: trimmed, wasRewritten: false };
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey && !process.env.GROQ_API_KEY) {
    return { rewrittenQuery: trimmed, wasRewritten: false };
  }

  try {
    const recentTurns = pastMessages.slice(-4);
    const historyText = recentTurns
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const prompt = `You are a search query reformulation engine. Given the conversation history and the user's latest follow-up question, rewrite the question into a clear, specific, self-contained standalone search query.
If the question is already completely standalone and unambiguous, output it unchanged.
Never add conversational filler, quotes, or preambles. Output ONLY the rewritten query.

Conversation History:
${historyText}

User Follow-Up: "${trimmed}"

Standalone Query:`;

    if (apiKey) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
      });

      const rewritten = (response.text || '').trim().replace(/^["']|["']$/g, '');
      if (rewritten && rewritten.length > 3 && rewritten.toLowerCase() !== trimmed.toLowerCase()) {
        return { rewrittenQuery: rewritten, wasRewritten: true };
      }
    } else if (process.env.GROQ_API_KEY) {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 60,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const rewritten = (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
        if (rewritten && rewritten.length > 3 && rewritten.toLowerCase() !== trimmed.toLowerCase()) {
          return { rewrittenQuery: rewritten, wasRewritten: true };
        }
      }
    }
  } catch (err: any) {
    console.warn('[rewriteQueryWithMemory] Query rewriting notice:', err.message || err);
  }

  return { rewrittenQuery: trimmed, wasRewritten: false };
}
