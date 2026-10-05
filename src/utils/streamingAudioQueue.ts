/**
 * StreamingAudioQueue handles real-time streaming TTS:
 * Converts text into speech progressively as sentences complete,
 * while the LLM is still generating subsequent tokens.
 * Supports interruption (barge-in), cancellation, and gapless sequential playback.
 */

import { apiUrl } from './api.js';

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
  private pendingFetchesCount = 0;
  private maxSentencesToSpeak = 100;
  private hasReportedFirstChunkLatency = false;
  private isWebSpeechActive = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private unlockedContext: AudioContext | null = null;

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

  public setAudioContext(ctx: AudioContext | null) {
    this.unlockedContext = ctx;
    console.log('[StreamingAudioQueue] Associated with AudioContext. State:', ctx ? ctx.state : 'null');
  }

  public getAudioContext(): AudioContext | null {
    return this.unlockedContext;
  }

  public getAudioContextState(): AudioContextState | 'unavailable' {
    return this.unlockedContext ? this.unlockedContext.state : 'unavailable';
  }

  /**
   * Explicitly resumes the Web Audio API context on user gesture.
   */
  public async resumeAudioContext(): Promise<AudioContextState | 'unavailable'> {
    console.log('[StreamingAudioQueue.resumeAudioContext] Attempting to resume AudioContext...');
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      console.warn('[StreamingAudioQueue.resumeAudioContext] AudioContext is not supported in this environment.');
      return 'unavailable';
    }

    if (!this.unlockedContext || this.unlockedContext.state === 'closed') {
      this.unlockedContext = new AudioCtx();
      console.log('[StreamingAudioQueue.resumeAudioContext] Created new AudioContext instance. Initial state:', this.unlockedContext.state);
    }

    console.log('[StreamingAudioQueue.resumeAudioContext] Pre-resume state:', this.unlockedContext.state);
    if (this.unlockedContext.state === 'suspended') {
      try {
        await this.unlockedContext.resume();
        console.log('[StreamingAudioQueue.resumeAudioContext] Successfully resumed. Post-resume state:', this.unlockedContext.state);
      } catch (err) {
        console.error('[StreamingAudioQueue.resumeAudioContext] Failed to resume AudioContext:', err);
      }
    } else {
      console.log('[StreamingAudioQueue.resumeAudioContext] AudioContext is already in non-suspended state:', this.unlockedContext.state);
    }

    // Also prime speech synthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
        console.log('[StreamingAudioQueue.resumeAudioContext] SpeechSynthesis resumed.');
      } catch (e) {
        console.warn('[StreamingAudioQueue.resumeAudioContext] SpeechSynthesis resume notice:', e);
      }
    }

    return this.unlockedContext.state;
  }

  public getCurrentAudio(): HTMLAudioElement | null {
    return this.currentAudio;
  }

  public reset() {
    this.stop();
    this.isCancelled = false;
    this.enqueuedSentencesCount = 0;
    this.pendingFetchesCount = 0;
    this.hasReportedFirstChunkLatency = false;
  }

  /**
   * Browser Autoplay Policy Unlock:
   * Must be triggered directly within user gestures (button click, mic tap, submit).
   * Unlocks Web Audio, HTML5 Audio, and Web Speech API.
   */
  public unlockAudio() {
    console.log('[StreamingAudioQueue.unlockAudio] Invoking unlock routine...');
    try {
      // 1. Unlock Web Audio API context
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!this.unlockedContext || this.unlockedContext.state === 'closed') {
          this.unlockedContext = new AudioCtx();
        }
        console.log('[StreamingAudioQueue.unlockAudio] Current AudioContext state:', this.unlockedContext.state);
        if (this.unlockedContext.state === 'suspended') {
          this.unlockedContext.resume().then(() => {
            console.log('[StreamingAudioQueue.unlockAudio] AudioContext resumed asynchronously. New state:', this.unlockedContext?.state);
          }).catch((err) => {
            console.warn('[StreamingAudioQueue.unlockAudio] Failed to resume AudioContext:', err);
          });
        }
        // Play an inaudible 10ms micro-beep to permanently satisfy browser activation
        const osc = this.unlockedContext.createOscillator();
        const gain = this.unlockedContext.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(this.unlockedContext.destination);
        osc.start();
        osc.stop(this.unlockedContext.currentTime + 0.01);
      }

      // 2. Unlock HTML5 Audio
      const silentAudio = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      );
      silentAudio.play().catch(() => {});

      // 3. Resume SpeechSynthesis
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.resume();
      }
    } catch (e) {
      console.warn('[StreamingAudioQueue.unlockAudio] Notice:', e);
    }
  }

  public getEnqueuedCount(): number {
    return this.enqueuedSentencesCount;
  }

  public canEnqueueMore(): boolean {
    return !this.isCancelled && this.enqueuedSentencesCount < this.maxSentencesToSpeak;
  }

  /**
   * Strips markdown artifacts, bullets, and citations so spoken audio sounds conversational.
   */
  private cleanTextForSpeech(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[(?:Result\s*)?\d+[^\]]*\]/gi, ' ')
      .replace(/\[source:[^\]]*\]/gi, ' ')
      .replace(/\(source:[^)]*\)/gi, ' ')
      .replace(/\[\d+\]/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/^\s*\d+\.\s+/gm, '') // Remove list numbers like "1. "
      .replace(/^[\s*+-]+\s+/gm, '') // Remove bullet dashes
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Enqueues a single sentence for immediate or queued playback.
   * Includes explicit verification logging for AudioContext state and audio buffer reception.
   */
  public async enqueueSentence(sentence: string, preferredVoice?: string): Promise<void> {
    if (this.isCancelled) {
      console.log('[StreamingAudioQueue.enqueueSentence] Skipped: queue is cancelled.');
      return;
    }
    if (this.enqueuedSentencesCount >= this.maxSentencesToSpeak) {
      console.log('[StreamingAudioQueue.enqueueSentence] Skipped: maximum sentence threshold reached.');
      return;
    }

    const cleaned = this.cleanTextForSpeech(sentence);
    if (!cleaned || cleaned.length < 2) {
      console.log('[StreamingAudioQueue.enqueueSentence] Skipped: sentence empty after cleaning:', { raw: sentence, cleaned });
      return;
    }

    const ctxState = this.unlockedContext ? this.unlockedContext.state : 'uninitialized';
    console.log('[StreamingAudioQueue.enqueueSentence] ENQUEUING SENTENCE:', {
      text: cleaned,
      rawLength: sentence.length,
      cleanedLength: cleaned.length,
      audioContextState: ctxState,
      isAudioContextSuspended: ctxState === 'suspended',
      enqueuedCount: this.enqueuedSentencesCount + 1,
    });

    if (ctxState === 'suspended') {
      console.warn('[StreamingAudioQueue.enqueueSentence] WARNING: AudioContext is currently in "suspended" state! Browser may block audio playback until user clicks "Unmute/Activate Audio".');
    }

    this.enqueuedSentencesCount++;
    this.pendingFetchesCount++;

    // Mark as playing immediately so UI transitions to SPEAKING right away
    if (!this.isProcessing) {
      this.isProcessing = true;
      this.onPlayStateChange?.(true);
    }

    const controller = new AbortController();
    this.abortControllers.push(controller);

    const ttsStart = Date.now();
    try {
      const endpoint = apiUrl('/voice/tts');
      console.log(`[StreamingAudioQueue.enqueueSentence] Sending TTS request to: ${endpoint}`, { text: cleaned, voice: preferredVoice });

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned, voice: preferredVoice }),
        signal: controller.signal,
      });

      console.log(`[StreamingAudioQueue.enqueueSentence] TTS HTTP response status: ${resp.status} ${resp.statusText}`);

      if (!resp.ok || this.isCancelled) {
        console.warn(`[StreamingAudioQueue.enqueueSentence] /voice/tts responded with status ${resp.status}. Falling back to browser Web Speech API for this sentence.`);
        this.queue.push({ text: cleaned });
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
      if (this.isCancelled) {
        console.log('[StreamingAudioQueue.enqueueSentence] Discarding audio blob because queue was cancelled.');
        return;
      }

      console.log(`[StreamingAudioQueue.enqueueSentence] Audio buffer verification: Received Blob of ${blob.size} bytes (type: ${blob.type || 'unknown'}).`);

      // If the backend returned an actual audio payload (> 200 bytes)
      if (blob.size > 200) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        console.log(`[StreamingAudioQueue.enqueueSentence] Audio element created with object URL. Queueing for playback. AudioContext state: ${this.unlockedContext?.state}`);
        this.queue.push({ audio, url, text: cleaned });
      } else {
        console.warn(`[StreamingAudioQueue.enqueueSentence] Audio blob is suspiciously small (${blob.size} bytes). Falling back to Web Speech API.`);
        this.queue.push({ text: cleaned });
      }

      this.processQueue();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('[StreamingAudioQueue.enqueueSentence] Fetch error:', err, 'Falling back to Web Speech API.');
        if (!this.isCancelled) {
          this.queue.push({ text: cleaned });
          this.processQueue();
        }
      } else {
        console.log('[StreamingAudioQueue.enqueueSentence] TTS fetch aborted via controller.');
      }
    } finally {
      this.pendingFetchesCount = Math.max(0, this.pendingFetchesCount - 1);
      if (this.queue.length === 0 && !this.currentAudio && !this.isWebSpeechActive && this.pendingFetchesCount === 0) {
        this.isProcessing = false;
        this.onPlayStateChange?.(false);
        this.onQueueEmpty?.();
      }
    }
  }

  private processQueue() {
    if (this.isCancelled) {
      console.log('[StreamingAudioQueue.processQueue] Stopped: queue is cancelled.');
      return;
    }
    if (this.currentAudio || this.isWebSpeechActive) {
      console.log('[StreamingAudioQueue.processQueue] Playback currently in progress. Queued items count:', this.queue.length);
      return;
    }

    if (this.queue.length === 0) {
      if (this.pendingFetchesCount === 0 && this.isProcessing) {
        console.log('[StreamingAudioQueue.processQueue] Queue is completely empty and no pending fetches remain.');
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

      console.log(`[StreamingAudioQueue] Starting audio playback for sentence: "${next.text?.slice(0, 40)}...". AudioContext state: ${this.unlockedContext?.state}`);

      this.currentAudio.onended = () => {
        console.log('[StreamingAudioQueue] Audio element playback finished.');
        if (this.currentUrl) {
          URL.revokeObjectURL(this.currentUrl);
        }
        this.currentAudio = null;
        this.currentUrl = null;
        this.processQueue();
      };

      this.currentAudio.onerror = (e) => {
        console.warn('[StreamingAudioQueue] Audio element error encountered, falling back to Web Speech:', e);
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
      };

      this.currentAudio.play().catch((err) => {
        console.warn('[StreamingAudioQueue] audio.play() was blocked or rejected (AudioContext state: ' + this.unlockedContext?.state + '). Error:', err);
        console.warn('[StreamingAudioQueue] Falling back to Web Speech API synthesis.');
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
      console.log('[StreamingAudioQueue] Initiating Web Speech API fallback playback.');
      this.speakWebSpeech(next.text);
    }
  }

  private speakWebSpeech(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      console.warn('[StreamingAudioQueue.speakWebSpeech] SpeechSynthesis is unavailable.');
      this.processQueue();
      return;
    }

    try {
      this.isWebSpeechActive = true;
      if (!this.isProcessing) {
        this.isProcessing = true;
        this.onPlayStateChange?.(true);
      }

      // Resume in case browser suspended speech
      window.speechSynthesis.resume();

      const utterance = new SpeechSynthesisUtterance(text);
      // Persist reference on instance so Chromium GC does not free it mid-speech!
      this.currentUtterance = utterance;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        console.log('[StreamingAudioQueue.speakWebSpeech] Utterance finished playing.');
        this.currentUtterance = null;
        this.isWebSpeechActive = false;
        this.processQueue();
      };

      utterance.onerror = (e) => {
        console.warn('[StreamingAudioQueue.speakWebSpeech] Utterance error:', e);
        this.currentUtterance = null;
        this.isWebSpeechActive = false;
        this.processQueue();
      };

      console.log(`[StreamingAudioQueue.speakWebSpeech] Speaking utterance: "${text.slice(0, 40)}..."`);
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[StreamingAudioQueue.speakWebSpeech] Exception during speak():', e);
      this.currentUtterance = null;
      this.isWebSpeechActive = false;
      this.processQueue();
    }
  }

  /**
   * Immediately stops speech, clears queue, cancels pending fetches (Barge-in).
   */
  public stop() {
    console.log('[StreamingAudioQueue.stop] Interruption requested. Halting all playback and aborting fetches.');
    this.isCancelled = true;

    // Cancel Web Speech API
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.isWebSpeechActive = false;
    this.currentUtterance = null;

    // Abort all in-flight TTS fetches
    for (const c of this.abortControllers) {
      try {
        c.abort();
      } catch {}
    }
    this.abortControllers = [];
    this.pendingFetchesCount = 0;

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
    return (
      this.isProcessing ||
      this.currentAudio !== null ||
      this.isWebSpeechActive ||
      this.queue.length > 0 ||
      this.pendingFetchesCount > 0
    );
  }
}
