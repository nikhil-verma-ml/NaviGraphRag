/**
 * StreamingAudioQueue handles real-time streaming TTS:
 * Converts text into speech progressively as sentences complete,
 * while the LLM is still generating subsequent tokens.
 * Supports interruption (barge-in), cancellation, and gapless sequential playback.
 */

export class StreamingAudioQueue {
  private queue: { audio?: HTMLAudioElement; url?: string; text?: string }[] = [];
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private isCancelled = false;
  private abortControllers: AbortController[] = [];
  private onPlayStateChange?: (isPlaying: boolean) => void;
  private onFirstChunkLatency?: (latencyMs: number) => void;
  private onQueueEmpty?: () => void;
  private isProcessing = false;
  private enqueuedSentencesCount = 0;
  private maxSentencesToSpeak = 100;
  private hasReportedFirstChunkLatency = false;
  private isWebSpeechActive = false;

  constructor(
    onPlayStateChange?: (isPlaying: boolean) => void,
    onFirstChunkLatency?: (latencyMs: number) => void,
    onQueueEmpty?: () => void
  ) {
    this.onPlayStateChange = onPlayStateChange;
    this.onFirstChunkLatency = onFirstChunkLatency;
    this.onQueueEmpty = onQueueEmpty;
  }

  public setOnQueueEmpty(callback: () => void) {
    this.onQueueEmpty = callback;
  }

  public getCurrentAudio(): HTMLAudioElement | null {
    return this.currentAudio;
  }

  public reset() {
    this.stop();
    this.isCancelled = false;
    this.enqueuedSentencesCount = 0;
    this.hasReportedFirstChunkLatency = false;
  }

  public unlockAudio() {
    try {
      const silentAudio = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      );
      silentAudio.play().catch(() => {});
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.resume();
      }
    } catch {}
  }

  public getEnqueuedCount(): number {
    return this.enqueuedSentencesCount;
  }

  public canEnqueueMore(): boolean {
    return !this.isCancelled && this.enqueuedSentencesCount < this.maxSentencesToSpeak;
  }

  /**
   * Enqueues a single sentence for immediate or queued playback.
   */
  public async enqueueSentence(sentence: string, preferredVoice?: string): Promise<void> {
    if (this.isCancelled) return;
    if (this.enqueuedSentencesCount >= this.maxSentencesToSpeak) return;

    const trimmed = sentence.trim();
    if (!trimmed || trimmed.length < 2) return;

    this.enqueuedSentencesCount++;
    const controller = new AbortController();
    this.abortControllers.push(controller);

    const ttsStart = Date.now();
    try {
      const resp = await fetch('/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, voice: preferredVoice }),
        signal: controller.signal,
      });

      if (!resp.ok || this.isCancelled) {
        // Fallback to browser Web Speech API for this sentence
        this.queue.push({ text: trimmed });
        this.processQueue();
        return;
      }

      const headerMs = resp.headers.get('X-TTS-Latency-Ms');
      const measuredMs = headerMs ? parseInt(headerMs, 10) : Date.now() - ttsStart;
      if (!this.hasReportedFirstChunkLatency) {
        this.hasReportedFirstChunkLatency = true;
        this.onFirstChunkLatency?.(measuredMs);
      }

      const blob = await resp.blob();
      if (this.isCancelled) return;

      // If the backend returned an actual audio payload (> 100 bytes)
      if (blob.size > 200) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.queue.push({ audio, url, text: trimmed });
      } else {
        // Fallback to Web Speech API
        this.queue.push({ text: trimmed });
      }

      this.processQueue();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // Fallback to Web Speech
        if (!this.isCancelled) {
          this.queue.push({ text: trimmed });
          this.processQueue();
        }
      }
    }
  }

  private processQueue() {
    if (this.isCancelled) return;
    if (this.currentAudio || this.isWebSpeechActive) return; // already playing

    if (this.queue.length === 0) {
      if (this.isProcessing) {
        this.isProcessing = false;
        this.onPlayStateChange?.(false);
        this.onQueueEmpty?.();
      }
      return;
    }

    const next = this.queue.shift()!;

    if (!this.isProcessing) {
      this.isProcessing = true;
      this.onPlayStateChange?.(true);
    }

    // Audio element playback
    if (next.audio && next.url) {
      this.currentAudio = next.audio;
      this.currentUrl = next.url;

      this.currentAudio.onended = () => {
        if (this.currentUrl) {
          URL.revokeObjectURL(this.currentUrl);
        }
        this.currentAudio = null;
        this.currentUrl = null;
        this.processQueue();
      };

      this.currentAudio.onerror = () => {
        if (this.currentUrl) {
          URL.revokeObjectURL(this.currentUrl);
        }
        this.currentAudio = null;
        this.currentUrl = null;
        this.processQueue();
      };

      this.currentAudio.play().catch((err) => {
        console.warn('[StreamingAudioQueue] play error, trying speech synthesis fallback:', err);
        if (this.currentUrl) {
          URL.revokeObjectURL(this.currentUrl);
        }
        this.currentAudio = null;
        this.currentUrl = null;
        if (next.text) {
          this.speakWebSpeech(next.text);
        } else {
          this.processQueue();
        }
      });
    } else if (next.text) {
      // Web Speech API fallback
      this.speakWebSpeech(next.text);
    }
  }

  private speakWebSpeech(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.processQueue();
      return;
    }

    try {
      this.isWebSpeechActive = true;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        this.isWebSpeechActive = false;
        this.processQueue();
      };

      utterance.onerror = () => {
        this.isWebSpeechActive = false;
        this.processQueue();
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      this.isWebSpeechActive = false;
      this.processQueue();
    }
  }

  /**
   * Immediately stops speech, clears queue, cancels pending fetches (Barge-in).
   */
  public stop() {
    this.isCancelled = true;

    // Cancel Web Speech API
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.isWebSpeechActive = false;

    // Abort all in-flight TTS fetches
    for (const c of this.abortControllers) {
      try {
        c.abort();
      } catch {}
    }
    this.abortControllers = [];

    // Stop and cleanup current audio
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.src = '';
      } catch {}
      this.currentAudio = null;
    }
    if (this.currentUrl) {
      try {
        URL.revokeObjectURL(this.currentUrl);
      } catch {}
      this.currentUrl = null;
    }

    // Cleanup queued audios
    for (const item of this.queue) {
      if (item.url) {
        try {
          URL.revokeObjectURL(item.url);
        } catch {}
      }
    }
    this.queue = [];

    if (this.isProcessing) {
      this.isProcessing = false;
      this.onPlayStateChange?.(false);
    }
  }

  public isSpeaking(): boolean {
    return this.isProcessing || this.currentAudio !== null || this.isWebSpeechActive || this.queue.length > 0;
  }
}
