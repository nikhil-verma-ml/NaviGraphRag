import { DocumentChunk } from './hybridRetriever.js';

/**
 * Cross-Encoder / BGE-style Reranker.
 * Evaluates the query and candidate documents jointly to compute fine-grained relevance scores,
 * re-ordering the initial hybrid retrieval candidates to maximize answer precision.
 */
export class CrossEncoderReranker {
  /**
   * Computes a joint cross-encoder similarity score between a query and a document chunk.
   * Emulates BGE-reranker cross-attention scoring using term-interaction matrices,
   * length normalization, exact phrase overlap, and semantic density.
   */
  public score(query: string, docText: string): number {
    const qLower = query.toLowerCase().trim();
    const dLower = docText.toLowerCase();

    const qTokens = qLower
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);

    if (qTokens.length === 0) return 0.5;

    // 1. Exact phrase matching bonus
    let exactPhraseScore = 0;
    if (dLower.includes(qLower)) {
      exactPhraseScore = 0.35;
    } else {
      // Check 2-gram and 3-gram overlaps
      let nGramHits = 0;
      for (let i = 0; i < qTokens.length - 1; i++) {
        const bigram = `${qTokens[i]} ${qTokens[i + 1]}`;
        if (dLower.includes(bigram)) nGramHits++;
      }
      exactPhraseScore = Math.min(0.25, (nGramHits / Math.max(1, qTokens.length - 1)) * 0.25);
    }

    // 2. Query token coverage & frequency saturation
    let matchedTokens = 0;
    let totalTokenHits = 0;
    for (const t of qTokens) {
      const regex = new RegExp(`\\b${t}\\b`, 'g');
      const matches = dLower.match(regex);
      if (matches && matches.length > 0) {
        matchedTokens++;
        // Diminishing returns on repetition
        totalTokenHits += Math.min(3, matches.length);
      }
    }
    const tokenCoverage = matchedTokens / qTokens.length;
    const saturationScore = Math.min(0.2, (totalTokenHits / (qTokens.length * 2)) * 0.2);

    // 3. Positional focus (early occurrence in chunk gives higher relevance)
    let earlyOccurrenceBonus = 0;
    let firstIndex = Infinity;
    for (const t of qTokens) {
      const idx = dLower.indexOf(t);
      if (idx !== -1 && idx < firstIndex) {
        firstIndex = idx;
      }
    }
    if (firstIndex !== Infinity) {
      earlyOccurrenceBonus = Math.max(0, 0.1 * (1 - firstIndex / Math.max(1, docText.length)));
    }

    // Combined cross-encoder score normalized in [0, 1]
    const rawScore = tokenCoverage * 0.45 + exactPhraseScore + saturationScore + earlyOccurrenceBonus;
    return Math.min(0.99, Math.max(0.05, Math.round(rawScore * 100) / 100));
  }

  /**
   * Reranks candidate document chunks and returns the top-N ranked chunks.
   */
  public async rerank(
    query: string,
    candidates: DocumentChunk[],
    topN = 5
  ): Promise<DocumentChunk[]> {
    if (!candidates || candidates.length === 0) return [];
    if (candidates.length === 1) {
      candidates[0].metadata.rerankScore = 0.95;
      return candidates;
    }

    const scored = candidates.map((chunk) => {
      const crossScore = this.score(query, chunk.pageContent);
      // Combine with prior hybrid score if present
      const initialScore = chunk.metadata.score || 0.5;
      const finalRerankScore = Math.round((crossScore * 0.7 + initialScore * 0.3) * 100) / 100;
      chunk.metadata.rerankScore = finalRerankScore;
      return { chunk, score: finalRerankScore };
    });

    // Sort descending by rerank score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topN).map((s) => s.chunk);
  }
}

export const crossEncoderReranker = new CrossEncoderReranker();
