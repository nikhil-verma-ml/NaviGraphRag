import crypto from 'crypto';

/**
 * LRU / Memory Cache for Document & Query Embeddings.
 * Prevents redundant embedding API calls and saves API quota.
 */
class EmbeddingCache {
  private cache = new Map<string, number[]>();
  private readonly maxSize: number;

  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
  }

  private hashKey(text: string): string {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
  }

  public get(text: string): number[] | undefined {
    const key = this.hashKey(text);
    const val = this.cache.get(key);
    if (val) {
      // Refresh key for LRU
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }

  public set(text: string, embedding: number[]): void {
    const key = this.hashKey(text);
    if (this.cache.size >= this.maxSize) {
      // Evict oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, embedding);
  }

  public size(): number {
    return this.cache.size;
  }
}

/**
 * Memory Cache for repeated TTS audio outputs (MP3 buffers).
 * Serves repeated phrases/sentences in <1ms without calling Edge-TTS.
 */
class TTSCache {
  private cache = new Map<string, { buffer: Buffer; voice: string; spokenText: string }>();
  private readonly maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  private makeKey(text: string, voice: string): string {
    const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
    return `${voice}:::${norm}`;
  }

  public get(text: string, voice: string) {
    const key = this.makeKey(text, voice);
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
    return entry;
  }

  public set(text: string, voice: string, data: { buffer: Buffer; voice: string; spokenText: string }) {
    const key = this.makeKey(text, voice);
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, data);
  }

  public size(): number {
    return this.cache.size;
  }
}

export const embeddingCache = new EmbeddingCache();
export const ttsCache = new TTSCache();
