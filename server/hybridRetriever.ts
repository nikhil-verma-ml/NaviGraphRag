import { GoogleGenAI } from '@google/genai';
import { embeddingCache } from './cache.js';
import { crossEncoderReranker } from './reranker.js';

export interface DocumentChunk {
  id: string;
  pageContent: string;
  metadata: {
    source: string;
    title?: string;
    pageNumber?: number;
    chunkIndex?: number;
    score?: number;
    rerankScore?: number;
  };
  embedding?: number[];
}

export interface RetrievalOptions {
  fileFilter?: string;
  k?: number;
  useReranker?: boolean;
}

export class HybridRetriever {
  private documents: DocumentChunk[] = [];
  private ai: GoogleGenAI | null = null;
  private k: number;
  private isEmbeddingAvailable = false;

  constructor(k = 5) {
    this.k = k;
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      try {
        this.ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });
        this.isEmbeddingAvailable = true;
      } catch (err) {
        console.warn('[HybridRetriever] Could not initialize GoogleGenAI for embeddings:', err);
      }
    }
    this.seedDefaultDocs();
  }

  private seedDefaultDocs() {
    const defaultDocs: { content: string; source: string; pageNumber: number }[] = [
      {
        content:
          "Our Agentic RAG system is built using LangGraph, FastAPI, and Streamlit (migrated to Node.js / React for AI Studio). It uses a single agent node with a ReAct loop. Rather than using external CRAG or Self-RAG evaluator nodes, quality control is handled entirely in the agent's system prompt to maintain agentic autonomy.",
        source: 'architecture_guide.md',
        pageNumber: 1,
      },
      {
        content:
          'The system uses a hybrid retriever combining FAISS / vector semantic search and BM25 keyword search using an EnsembleRetriever, with weights 0.6 for semantic search and 0.4 for BM25. A cross-encoder reranker scores candidate chunks to eliminate false positives.',
        source: 'retriever_guide.md',
        pageNumber: 1,
      },
      {
        content:
          'Conversation memory is persisted across turns using a checkpointer. Follow-up queries are rewritten with conversation context into standalone search queries before retrieval.',
        source: 'memory_guide.md',
        pageNumber: 2,
      },
      {
        content:
          'The primary model is Google Gemini (gemini-3.8-flash / gemini-3.1-flash-lite). If Gemini fails or hits rate limits, the system automatically falls back to Groq running llama-3.3-70b-versatile, ensuring high availability.',
        source: 'llm_guide.md',
        pageNumber: 3,
      },
    ];

    for (let i = 0; i < defaultDocs.length; i++) {
      const doc = defaultDocs[i];
      this.documents.push({
        id: `seed_${i}`,
        pageContent: doc.content,
        metadata: {
          source: doc.source,
          title: doc.source,
          pageNumber: doc.pageNumber,
          chunkIndex: i,
        },
      });
    }

    // Embed asynchronously
    this.embedDocuments(this.documents).catch((err) => {
      console.warn('[HybridRetriever] Seed embedding notice:', err.message || err);
    });
  }

  async addDocuments(
    newDocs: { content: string; source: string; title?: string; pageNumber?: number }[]
  ): Promise<number> {
    const startIdx = this.documents.length;
    const added: DocumentChunk[] = [];

    for (let i = 0; i < newDocs.length; i++) {
      const d = newDocs[i];
      const chunk: DocumentChunk = {
        id: `doc_${startIdx + i}_${Date.now()}`,
        pageContent: d.content,
        metadata: {
          source: d.source,
          title: d.title || d.source,
          pageNumber: d.pageNumber || 1,
          chunkIndex: i,
        },
      };
      this.documents.push(chunk);
      added.push(chunk);
    }

    await this.embedDocuments(added);
    return added.length;
  }

  getDocCount(): number {
    return this.documents.length;
  }

  getAllDocs(): DocumentChunk[] {
    return this.documents;
  }

  /**
   * Returns list of unique document sources with counts and pages.
   */
  getDocumentSources(): { source: string; chunkCount: number; pages: number[] }[] {
    const map = new Map<string, { chunkCount: number; pages: Set<number> }>();
    for (const doc of this.documents) {
      const s = doc.metadata.source || 'default';
      const entry = map.get(s) || { chunkCount: 0, pages: new Set() };
      entry.chunkCount++;
      if (doc.metadata.pageNumber) {
        entry.pages.add(doc.metadata.pageNumber);
      }
      map.set(s, entry);
    }

    return Array.from(map.entries()).map(([source, data]) => ({
      source,
      chunkCount: data.chunkCount,
      pages: Array.from(data.pages).sort((a, b) => a - b),
    }));
  }

  private async embedDocuments(chunks: DocumentChunk[]) {
    for (const chunk of chunks) {
      if (chunk.embedding) continue;

      // 1. Check Embedding Cache
      const cached = embeddingCache.get(chunk.pageContent);
      if (cached) {
        chunk.embedding = cached;
        continue;
      }

      if (this.ai && this.isEmbeddingAvailable) {
        try {
          const response: any = await this.ai.models.embedContent({
            model: 'text-embedding-004',
            contents: chunk.pageContent,
          });
          const values = response?.embedding?.values || response?.embeddings?.[0]?.values;
          if (values) {
            chunk.embedding = values;
            embeddingCache.set(chunk.pageContent, values);
            continue;
          }
        } catch {
          // Fallback below
        }
      }

      // Fallback local vector
      const localVec = this.computeLocalSparseVector(chunk.pageContent);
      chunk.embedding = localVec;
      embeddingCache.set(chunk.pageContent, localVec);
    }
  }

  private async embedQuery(query: string): Promise<number[]> {
    // 1. Check Embedding Cache
    const cached = embeddingCache.get(query);
    if (cached) return cached;

    if (this.ai && this.isEmbeddingAvailable) {
      try {
        const response: any = await this.ai.models.embedContent({
          model: 'text-embedding-004',
          contents: query,
        });
        const values = response?.embedding?.values || response?.embeddings?.[0]?.values;
        if (values) {
          embeddingCache.set(query, values);
          return values;
        }
      } catch {
        // Fallback below
      }
    }

    const localVec = this.computeLocalSparseVector(query);
    embeddingCache.set(query, localVec);
    return localVec;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  }

  private computeLocalSparseVector(text: string): number[] {
    const tokens = this.tokenize(text);
    const dim = 128;
    const vec = new Array(dim).fill(0);
    for (const t of tokens) {
      let hash = 0;
      for (let i = 0; i < t.length; i++) {
        hash = (hash << 5) - hash + t.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % dim;
      vec[idx] += 1;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private computeBM25Scores(queryTokens: string[], candidateDocs: DocumentChunk[]): number[] {
    const N = candidateDocs.length;
    if (N === 0) return [];

    const k1 = 1.5;
    const b = 0.75;

    const docTokensList = candidateDocs.map((d) => this.tokenize(d.pageContent));
    const totalLength = docTokensList.reduce((acc, toks) => acc + toks.length, 0);
    const avgdl = totalLength / (N || 1);

    const df: Record<string, number> = {};
    for (const qt of queryTokens) {
      df[qt] = docTokensList.filter((toks) => toks.includes(qt)).length;
    }

    const scores = new Array(N).fill(0);

    for (let i = 0; i < N; i++) {
      const docToks = docTokensList[i];
      const docLen = docToks.length;

      const tf: Record<string, number> = {};
      for (const t of docToks) {
        tf[t] = (tf[t] || 0) + 1;
      }

      for (const qt of queryTokens) {
        const count = tf[qt] || 0;
        if (count === 0) continue;

        const docFreq = df[qt] || 0;
        const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
        const numerator = count * (k1 + 1);
        const denominator = count + k1 * (1 - b + (b * docLen) / (avgdl || 1));
        scores[i] += idf * (numerator / denominator);
      }
    }

    const maxScore = Math.max(...scores, 1e-6);
    return scores.map((s) => s / maxScore);
  }

  /**
   * Retrieves relevant documents using Hybrid (Dense + BM25) Retrieval,
   * followed by Cross-Encoder Reranking to maximize answer precision.
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<DocumentChunk[]> {
    if (this.documents.length === 0) {
      return [];
    }

    const fileFilter = options?.fileFilter;
    const k = options?.k || this.k;
    const useReranker = options?.useReranker !== false;

    // Filter by file if requested (Multi-PDF filtering)
    let candidateDocs = this.documents;
    if (fileFilter && fileFilter !== 'all') {
      candidateDocs = this.documents.filter(
        (d) => d.metadata.source.toLowerCase() === fileFilter.toLowerCase()
      );
      if (candidateDocs.length === 0) {
        candidateDocs = this.documents; // fallback if filter produced no matches
      }
    }

    const queryTokens = this.tokenize(query);
    const bm25Scores = this.computeBM25Scores(queryTokens, candidateDocs);
    const queryEmbedding = await this.embedQuery(query);

    // Compute semantic scores
    const semanticScores: number[] = [];
    for (const doc of candidateDocs) {
      if (doc.embedding && doc.embedding.length === queryEmbedding.length) {
        semanticScores.push(Math.max(0, this.cosineSimilarity(queryEmbedding, doc.embedding)));
      } else {
        semanticScores.push(0);
      }
    }

    // 60% semantic vector, 40% BM25 keyword
    const hybridScored = candidateDocs.map((doc, idx) => {
      const semantic = semanticScores[idx] || 0;
      const keyword = bm25Scores[idx] || 0;
      const finalScore = Math.round((0.6 * semantic + 0.4 * keyword) * 100) / 100;
      doc.metadata.score = finalScore;
      return { doc, score: finalScore };
    });

    // Sort descending by initial hybrid score
    hybridScored.sort((a, b) => b.score - a.score);

    // Select top candidates (2x k) for cross-encoder reranking
    const initialCandidates = hybridScored.slice(0, Math.max(k * 2, 8)).map((item) => item.doc);

    if (useReranker && initialCandidates.length > 1) {
      // Step 2: Cross-Encoder Reranker
      return await crossEncoderReranker.rerank(query, initialCandidates, k);
    }

    return initialCandidates.slice(0, k);
  }
}

let retrieverInstance: HybridRetriever | null = null;
export function getHybridRetriever(): HybridRetriever {
  if (!retrieverInstance) {
    retrieverInstance = new HybridRetriever();
  }
  return retrieverInstance;
}
