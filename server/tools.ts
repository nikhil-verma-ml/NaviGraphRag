import { getHybridRetriever } from './hybridRetriever.js';

export interface SourceItem {
  type: string;
  content: string;
  source?: string;
  title?: string;
  pageNumber?: number;
  score?: number;
}

export interface ToolResult {
  formattedText: string;
  sources: SourceItem[];
}

export async function vectorSearchTool(
  query: string,
  options?: { fileFilter?: string }
): Promise<ToolResult> {
  const retriever = getHybridRetriever();
  const docs = await retriever.retrieve(query, { fileFilter: options?.fileFilter });

  if (!docs || docs.length === 0) {
    return {
      formattedText: 'No relevant information found in the knowledge base.',
      sources: [],
    };
  }

  const formatted: string[] = [];
  const sources: SourceItem[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const source = doc.metadata.source || 'document';
    const pageNum = doc.metadata.pageNumber || 1;
    const score = doc.metadata.rerankScore || doc.metadata.score || 0.85;

    formatted.push(
      `[Result ${i + 1} (Source: ${source}, Page: ${pageNum}, Score: ${score})\n${doc.pageContent}]`
    );

    sources.push({
      type: 'vector_search',
      content: doc.pageContent,
      source,
      title: doc.metadata.title || source,
      pageNumber: pageNum,
      score,
    });
  }

  return {
    formattedText: formatted.join('\n\n'),
    sources,
  };
}

export async function webSearchTool(query: string): Promise<ToolResult> {
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (tavilyKey) {
    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          max_results: 5,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const results = data.results || [];
        if (results.length > 0) {
          const formatted: string[] = [];
          const sources: SourceItem[] = [];

          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const source = r.url || 'web';
            const title = r.title || 'Web Result';
            const content = r.content || '';
            const score = r.score ? Math.round(r.score * 100) / 100 : 0.88;

            formatted.push(`[Result ${i + 1} ${title} (Source: ${source})\n${content}]`);
            sources.push({
              type: 'web_search',
              content,
              source,
              title,
              score,
            });
          }

          return { formattedText: formatted.join('\n\n'), sources };
        }
      }
    } catch (err) {
      console.warn('[webSearchTool] Tavily search error:', err);
    }
  }

  // Graceful web search fallback via DuckDuckGo Instant Answer API
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const ddgResp = await fetch(ddgUrl, { headers: { 'User-Agent': 'NaviGraph/1.0' } });
    if (ddgResp.ok) {
      const data = await ddgResp.json();
      const snippets: { title: string; url: string; snippet: string }[] = [];

      if (data.AbstractText) {
        snippets.push({
          title: data.Heading || 'DuckDuckGo Summary',
          url: data.AbstractURL || 'https://duckduckgo.com',
          snippet: data.AbstractText,
        });
      }

      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 4)) {
          if (topic.Text && topic.FirstURL) {
            snippets.push({
              title: topic.Text.split(' - ')[0] || 'Web Result',
              url: topic.FirstURL,
              snippet: topic.Text,
            });
          }
        }
      }

      if (snippets.length > 0) {
        const formatted = snippets.map(
          (s, i) => `[Result ${i + 1} ${s.title} (Source: ${s.url})\n${s.snippet}]`
        );
        const sources: SourceItem[] = snippets.map((s) => ({
          type: 'web_search',
          content: s.snippet,
          source: s.url,
          title: s.title,
          score: 0.8,
        }));
        return { formattedText: formatted.join('\n\n'), sources };
      }
    }
  } catch (err) {
    console.warn('[webSearchTool] Fallback search error:', err);
  }

  return {
    formattedText: `[Web Search Query: "${query}"]\nNo real-time web results found for "${query}". Answering with available knowledge.`,
    sources: [
      {
        type: 'web_search',
        content: `Web query for: ${query}`,
        source: 'Web Search',
        title: query,
        score: 0.5,
      },
    ],
  };
}
