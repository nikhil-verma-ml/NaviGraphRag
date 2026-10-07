/**
 * StreamingAudioQueue handles real-time streaming TTS using Web Audio API:
 * 1. enqueueSentence() -> Fetches TTS audio from /voice/tts
 * 2. Decodes ArrayBuffer -> AudioBuffer via AudioContext.decodeAudioData()
 * 3. Queues AudioBuffer for gapless sequential playback
 * 4. Plays via AudioBufferSourceNode connected to masterGain & analyserNode
 * 5. Supports intentional user barge-in interruption without accidental aborts
 */

import { apiUrl } from './api.js';
import { cleanTextForSpeech } from './voiceSummary.js';

export interface QueueItem {
  buffer: AudioBuffer;
  text: string;
}

export class StreamingAudioQueue {
  private queue: QueueItem[] = [];
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  private isCancelled = false;
  private isPlaying = false;
  private activeControllers = new Set<AbortController>();

  private onPlayStateChange?: (isPlaying: boolean) => void;
  private onFirstChunkLatency?: (latencyMs: number) => void;
  private onQueueEmpty?: () => void;

  private enqueuedSentencesCount = 0;
  private pendingFetchesCount = 0;
  private maxSentencesToSpeak = 100;
  private hasReportedFirstChunkLatency = false;

  // Web Speech API fallback in case decodeAudioData or TTS fails
  private isWebSpeechActive = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

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

  /**
   * Sets or attaches the shared Web Audio API AudioContext.
   * Initializes master GainNode and AnalyserNode.
   */
  public setAudioContext(ctx: AudioContext | null) {
    if (!ctx) return;
    this.audioContext = ctx;
    this.ensureAudioGraph();
    console.log('[StreamingAudioQueue] Associated with AudioContext. State:', ctx.state);
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getAudioContextState(): AudioContextState | 'unavailable' {
    return this.audioContext ? this.audioContext.state : 'unavailable';
  }

  private ensureAudioGraph() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }
    if (!this.audioContext) return;

    if (!this.masterGain) {
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.audioContext.destination);
    }

    if (!this.analyserNode) {
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.analyserNode.connect(this.masterGain);
    }
  }

  /**
   * Primary user gesture audio context unlock:
   * Explicitly resumes AudioContext if suspended.
   */
  public async unlockAudio(): Promise<void> {
    console.log('[StreamingAudioQueue.unlockAudio] Unlocking audio context...');
    this.ensureAudioGraph();
    if (!this.audioContext) return;

    try {
      if (this.audioContext.state !== 'running') {
        console.log('[StreamingAudioQueue.unlockAudio] AudioContext state is', this.audioContext.state, '- calling resume()...');
        await this.audioContext.resume();
        console.log('[StreamingAudioQueue.unlockAudio] AudioContext resumed. New state:', this.audioContext.state);
      }

      // Play 10ms inaudible buffer to satisfy browser activation token
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start();
      osc.stop(this.audioContext.currentTime + 0.01);

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.resume();
      }
    } catch (err) {
      console.warn('[StreamingAudioQueue.unlockAudio] Unlock notice:', err);
    }
  }

  public async resumeAudioContext(): Promise<AudioContextState | 'unavailable'> {
    console.log('[StreamingAudioQueue.resumeAudioContext] Resuming AudioContext...');
    this.ensureAudioGraph();
    if (!this.audioContext) return 'unavailable';

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('[StreamingAudioQueue.resumeAudioContext] Resumed successfully. State is:', this.audioContext.state);
      } catch (err) {
        console.error('[StreamingAudioQueue.resumeAudioContext] Error during resume():', err);
      }
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
      } catch {}
    }

    return this.audioContext.state;
  }

  public reset() {
    console.log('[StreamingAudioQueue.reset] Resetting queue for new conversation turn (without cancelling abort controllers).');
    this.isCancelled = false;
    this.enqueuedSentencesCount = 0;
    this.pendingFetchesCount = 0;
    this.hasReportedFirstChunkLatency = false;
  }

  public getEnqueuedCount(): number {
    return this.enqueuedSentencesCount;
  }

  public canEnqueueMore(): boolean {
    return !this.isCancelled && this.enqueuedSentencesCount < this.maxSentencesToSpeak;
  }

  private cleanTextForSpeech(text: string): string {
    return cleanTextForSpeech(text);
  }

  /**
   * Pipeline Step 1 & 2: Enqueue text sentence and initiate TTS network request.
   */
  public async enqueueSentence(sentence: string, preferredVoice?: string): Promise<void> {
    if (this.isCancelled) {
      console.log('[StreamingAudioQueue.enqueueSentence] Skipped: queue is currently cancelled.');
      return;
    }
    if (this.enqueuedSentencesCount >= this.maxSentencesToSpeak) {
      console.log('[StreamingAudioQueue.enqueueSentence] Skipped: sentence threshold reached.');
      return;
    }

    const cleaned = this.cleanTextForSpeech(sentence);
    if (!cleaned || cleaned.length < 2) {
      console.log('[StreamingAudioQueue.enqueueSentence] Skipped: sentence empty after cleaning:', { raw: sentence, cleaned });
      return;
    }

    this.ensureAudioGraph();
    const ctxState = this.audioContext ? this.audioContext.state : 'uninitialized';

    // Step [1]: enqueueSentence called - track pipeline state
    console.log('[StreamingAudioQueue.enqueueSentence] Pipeline state:', {
      text: cleaned,
      rawLength: sentence.length,
      cleanedLength: cleaned.length,
      audioContextState: ctxState,
      isSuspended: ctxState === 'suspended',
      enqueuedCount: this.enqueuedSentencesCount + 1,
      queueDepth: this.queue.length,
      isPlaying: this.isPlaying,
      pendingFetches: this.pendingFetchesCount + 1,
    });

    if (ctxState === 'suspended') {
      console.warn('[StreamingAudioQueue] Notice: AudioContext is currently suspended. Audio will play once resumed.');
      // Attempt auto-resume
      this.audioContext?.resume().catch(() => {});
    }

    this.enqueuedSentencesCount++;
    this.pendingFetchesCount++;

    if (!this.isPlaying) {
      this.onPlayStateChange?.(true);
    }

    // Step [2]: TTS request started with isolated per-request AbortController
    const controller = new AbortController();
    this.activeControllers.add(controller);

    const ttsStart = Date.now();
    const endpoint = apiUrl('/voice/tts');
    console.log(`[2] TTS request started: URL="${endpoint}" text="${cleaned.slice(0, 50)}..."`);

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned, voice: preferredVoice }),
        signal: controller.signal,
      });

      // Step [3]: TTS response verification
      const contentType = resp.headers.get('content-type') || 'unknown';
      const contentLength = resp.headers.get('content-length') || 'unknown';
      console.log('[StreamingAudioQueue.fetch] Response received:', {
        status: resp.status,
        statusText: resp.statusText,
        contentType,
        contentLength,
        url: endpoint,
        isAudioType: contentType.includes('audio') || contentType.includes('mpeg') || contentType.includes('wav'),
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        console.error(`[StreamingAudioQueue.fetch] TTS API returned HTTP error ${resp.status}:`, errorText);
        // Fallback to Web Speech API
        this.fallbackWebSpeech(cleaned);
        return;
      }

      if (this.isCancelled) {
        console.log('[StreamingAudioQueue.fetch] Discarding response: queue was cancelled during fetch.');
        return;
      }

      const headerMs = resp.headers.get('X-TTS-Latency-Ms');
      const measuredMs = headerMs ? parseInt(headerMs, 10) : Date.now() - ttsStart;
      if (!this.hasReportedFirstChunkLatency) {
        this.hasReportedFirstChunkLatency = true;
        this.onFirstChunkLatency?.(measuredMs);
      }

      // Step [4]: Audio bytes received & length validation
      const arrayBuffer = await resp.arrayBuffer();
      const byteLength = arrayBuffer.byteLength;
      console.log('[StreamingAudioQueue.fetch] Audio payload verified:', {
        bytesReceived: byteLength,
        isNonEmpty: byteLength > 0,
        meetsMinimumAudioSize: byteLength > 200,
        expectedLength: contentLength,
      });

      if (byteLength === 0) {
        console.warn('[StreamingAudioQueue.fetch] Response body is completely empty (0 bytes). Falling back to Web Speech API.');
        this.fallbackWebSpeech(cleaned);
        return;
      }

      // Step [5]: Web Audio API decode status check
      if (!this.audioContext) {
        this.ensureAudioGraph();
      }

      if (this.audioContext) {
        console.log('[StreamingAudioQueue.fetch] Starting decodeAudioData()... AudioContext state:', this.audioContext.state);
        try {
          // Decode a slice copy to avoid detachment issues
          const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
          console.log('[StreamingAudioQueue.fetch] Audio successfully decoded:', {
            durationSeconds: Number(audioBuffer.duration.toFixed(3)),
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRateHz: audioBuffer.sampleRate,
            isValidDuration: audioBuffer.duration > 0,
          });

          if (this.isCancelled) {
            console.log('[StreamingAudioQueue.fetch] Queue cancelled during decode. Discarding audio buffer.');
            return;
          }

          // Step [6]: Audio buffer queued for playback
          console.log('[StreamingAudioQueue.fetch] Enqueuing decoded buffer before playback:', {
            textPreview: cleaned.slice(0, 40) + '...',
            duration: audioBuffer.duration,
            currentQueueDepth: this.queue.length + 1,
            isPlaying: this.isPlaying,
          });
          this.queue.push({ buffer: audioBuffer, text: cleaned });
          this.playNext();
        } catch (decodeErr) {
          console.error('[StreamingAudioQueue.fetch] AudioContext.decodeAudioData failed to decode bytes:', decodeErr);
          this.fallbackWebSpeech(cleaned);
        }
      } else {
        console.warn('[StreamingAudioQueue.fetch] No AudioContext available for decoding, falling back to Web Speech.');
        this.fallbackWebSpeech(cleaned);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[StreamingAudioQueue.enqueueSentence] TTS intentionally aborted via controller.');
      } else {
        console.error('[StreamingAudioQueue.enqueueSentence] Unexpected TTS fetch error:', err);
        if (!this.isCancelled) {
          this.fallbackWebSpeech(cleaned);
        }
      }
    } finally {
      this.activeControllers.delete(controller);
      this.pendingFetchesCount = Math.max(0, this.pendingFetchesCount - 1);
      this.checkCompletion();
    }
  }

  /**
   * Step [7], [8], [9]: Sequential playback of queued AudioBuffers via AudioBufferSourceNode.
   */
  private playNext() {
    if (this.isCancelled) {
      console.log('[StreamingAudioQueue.playNext] Cancelled, halting playback.');
      return;
    }
    if (this.isPlaying) {
      console.log(`[StreamingAudioQueue.playNext] Already playing a chunk. Queue depth: ${this.queue.length}`);
      return;
    }
    if (this.queue.length === 0) {
      console.log('[StreamingAudioQueue.playNext] Queue is empty.');
      this.checkCompletion();
      return;
    }

    const next = this.queue.shift()!;
    this.isPlaying = true;
    this.onPlayStateChange?.(true);

    this.ensureAudioGraph();
    if (!this.audioContext || !this.analyserNode) {
      console.error('[StreamingAudioQueue.playNext] Missing AudioContext or graph nodes.');
      this.isPlaying = false;
      this.checkCompletion();
      return;
    }

    try {
      // Step [7]: playNext called
      console.log(`[7] playNext called for sentence: "${next.text.slice(0, 40)}...". Remaining queue: ${this.queue.length}`);

      // Resume context if suspended
      if (this.audioContext.state === 'suspended') {
        console.log('[StreamingAudioQueue.playNext] AudioContext suspended, calling resume()...');
        this.audioContext.resume().catch(() => {});
      }

      // Step [8]: AudioBufferSource created and connected to destination
      const source = this.audioContext.createBufferSource();
      source.buffer = next.buffer;
      source.connect(this.analyserNode);
      this.currentSource = source;
      console.log('[8] AudioBufferSource created and connected to analyserNode -> masterGain -> destination');

      // Step [9]: source.start(0) called
      console.log('Starting audio playback', {
        contextState: this.audioContext.state,
        duration: next.buffer.duration,
      });
      console.log('[9] source.start(0) called');
      source.start(0);

      source.onended = () => {
        console.log(`[StreamingAudioQueue] Finished playback for: "${next.text.slice(0, 40)}..."`);
        if (this.currentSource === source) {
          this.currentSource = null;
        }
        this.isPlaying = false;
        // Proceed directly to next queued sentence
        this.playNext();
      };
    } catch (playErr) {
      console.error('[StreamingAudioQueue.playNext] Failed to start AudioBufferSourceNode:', playErr);
      this.currentSource = null;
      this.isPlaying = false;
      this.playNext();
    }
  }

  private fallbackWebSpeech(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      console.log(`[StreamingAudioQueue] Speaking via Web Speech API fallback: "${text.slice(0, 40)}..."`);
      window.speechSynthesis.resume();
      this.isWebSpeechActive = true;
      this.isPlaying = true;
      this.onPlayStateChange?.(true);

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        console.log('[StreamingAudioQueue] Web Speech utterance completed.');
        this.currentUtterance = null;
        this.isWebSpeechActive = false;
        this.isPlaying = false;
        this.playNext();
      };

      utterance.onerror = () => {
        this.currentUtterance = null;
        this.isWebSpeechActive = false;
        this.isPlaying = false;
        this.playNext();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      this.isWebSpeechActive = false;
      this.isPlaying = false;
      this.checkCompletion();
    }
  }

  private checkCompletion() {
    if (
      this.queue.length === 0 &&
      !this.isPlaying &&
      !this.isWebSpeechActive &&
      this.pendingFetchesCount === 0
    ) {
      console.log('[StreamingAudioQueue] Queue finished: all sentences played.');
      this.onPlayStateChange?.(false);
      this.onQueueEmpty?.();
    }
  }

  /**
   * Stops playback, clears queue, and aborts active TTS fetches (User Barge-in / Exit).
   * Diagnostic console.trace identifies the exact caller to prevent accidental stops.
   */
  public stop() {
    console.trace('[StreamingAudioQueue.stop] called by:');
    console.log('[StreamingAudioQueue.stop] Interruption requested. Halting all playback and aborting fetches.', {
      hadCurrentSource: !!this.currentSource,
      queueLength: this.queue.length,
      activeFetchesCount: this.activeControllers.size,
    });
    this.isCancelled = true;

    // Stop current Web Audio buffer source
    if (this.currentSource) {
      try {
        this.currentSource.stop(0);
        this.currentSource.disconnect();
      } catch {}
      this.currentSource = null;
    }

    // Cancel Web Speech API
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.isWebSpeechActive = false;
    this.currentUtterance = null;

    // Abort active in-flight TTS fetches
    for (const c of this.activeControllers) {
      try {
        c.abort();
      } catch {}
    }
    this.activeControllers.clear();
    this.pendingFetchesCount = 0;

    // Clear queue
    this.queue = [];
    this.isPlaying = false;
    this.onPlayStateChange?.(false);
  }

  public isSpeaking(): boolean {
    return (
      this.isPlaying ||
      this.isWebSpeechActive ||
      this.queue.length > 0 ||
      this.pendingFetchesCount > 0
    );
  }
}
