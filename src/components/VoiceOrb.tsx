import React, { useEffect, useRef, useState } from 'react';

export type VoiceOrbState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type VoiceOrbVisualizationStyle = 'circular' | 'bars' | 'wave';

export interface VoiceOrbProps {
  /** Current state of the voice interface */
  state: VoiceOrbState;
  /** HTMLAudioElement playing TTS audio, connected to AnalyserNode */
  audioElement?: HTMLAudioElement | null;
  /** Direct Web Audio API AnalyserNode connected to AudioBufferSourceNode during speech */
  speechAnalyser?: AnalyserNode | null;
  /** Optional microphone AnalyserNode for listening reactivity */
  micAnalyser?: AnalyserNode | null;
  /** Optional boolean flag indicating listening mode */
  isListening?: boolean;
  /** Optional fallback mic amplitude (0 - 100) */
  audioLevel?: number;
  /** Optional custom CSS classes */
  className?: string;
  /** Diameter of the orb container in pixels (default 260) */
  size?: number;
  /** Visualization style: 'circular' (3D sphere), 'bars' (equalizer spectrum), 'wave' (concentric ripple) */
  visualizationStyle?: VoiceOrbVisualizationStyle;
}

// Global WeakMap to prevent recreating MediaElementSourceNode on the same HTMLAudioElement
const audioSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  state,
  audioElement,
  speechAnalyser,
  micAnalyser,
  audioLevel = 0,
  className = '',
  size = 260,
  visualizationStyle = 'circular',
}) => {
  // References to visual elements
  const centeredOrbRef = useRef<HTMLDivElement | null>(null);
  const outerGlowRef = useRef<HTMLDivElement | null>(null);
  const barsContainerRef = useRef<HTMLDivElement | null>(null);
  const waveContainerRef = useRef<HTMLDivElement | null>(null);

  // References to keep current values inside requestAnimationFrame without re-renders
  const stateRef = useRef<VoiceOrbState>(state);
  stateRef.current = state;

  const styleRef = useRef<VoiceOrbVisualizationStyle>(visualizationStyle);
  styleRef.current = visualizationStyle;

  const audioLevelRef = useRef<number>(audioLevel);
  audioLevelRef.current = audioLevel;

  const micAnalyserRef = useRef<AnalyserNode | null>(micAnalyser || null);
  micAnalyserRef.current = micAnalyser || null;

  const speechAnalyserRef = useRef<AnalyserNode | null>(speechAnalyser || null);
  speechAnalyserRef.current = speechAnalyser || null;

  // Web Audio Context and AnalyserNode for audioElement
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);

  // 9 bars for equalizer mode
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Connect the audioElement to the Web Audio API AnalyserNode
  useEffect(() => {
    if (!audioElement) return;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtxClass();
      }

      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (!analyserNodeRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserNodeRef.current = analyser;
        analyser.connect(ctx.destination);
      }

      const analyser = analyserNodeRef.current;

      // Re-use or create MediaElementAudioSourceNode safely
      let source = audioSourceCache.get(audioElement);
      if (!source) {
        try {
          source = ctx.createMediaElementSource(audioElement);
          audioSourceCache.set(audioElement, source);
          source.connect(analyser);
        } catch {
          // Cross-origin or already attached
        }
      } else {
        try {
          source.connect(analyser);
        } catch {}
      }
    } catch (err) {
      console.warn('[VoiceOrb] Web Audio API setup:', err);
    }
  }, [audioElement]);

  // Main 60FPS requestAnimationFrame animation loop:
  // Reads frequency data from AnalyserNode, computes real-time volume,
  // and smoothly updates circular scale, equalizer bars, or concentric ripple waves.
  useEffect(() => {
    let animationId: number;
    let time = 0;

    // Smoothed values for exponential damping (lerp)
    let currentScale = 1.0;
    let targetScale = 1.0;

    let currentGlow = 20.0;
    let targetGlow = 20.0;

    let currentOpacity = 0.9;
    let targetOpacity = 0.9;

    // Bar heights smoothing array for 9 bars
    const currentBarHeights = [0.2, 0.3, 0.5, 0.7, 0.9, 0.7, 0.5, 0.3, 0.2];
    const targetBarHeights = [0.2, 0.3, 0.5, 0.7, 0.9, 0.7, 0.5, 0.3, 0.2];

    const freqData = new Uint8Array(128);

    const renderFrame = () => {
      time += 0.025;
      const currentState = stateRef.current;
      const currentStyle = styleRef.current;
      let calculatedVolume = 0;

      // ─────────────────────────────────────────────────────────────────────────
      // 1. CALCULATE REAL-TIME AUDIO FREQUENCY DATA & VOLUME
      // ─────────────────────────────────────────────────────────────────────────
      if (currentState === 'speaking') {
        const analyser = speechAnalyserRef.current || analyserNodeRef.current;
        if (analyser) {
          analyser.getByteFrequencyData(freqData);

          let sum = 0;
          const activeBins = 32;
          for (let i = 0; i < activeBins; i++) {
            sum += freqData[i];
          }
          calculatedVolume = sum / activeBins / 255; // 0.0 to 1.0

          // Update individual target bar heights from frequency bins
          for (let b = 0; b < 9; b++) {
            const binIdx = Math.min(31, b * 3);
            const val = freqData[binIdx] / 255;
            targetBarHeights[b] = Math.max(0.15, Math.min(1.0, val * 1.3));
          }
        }

        // Fallback smooth harmonic wave if volume is low or synthetic Web Speech is used
        if (calculatedVolume < 0.03) {
          const wave =
            (Math.sin(time * 3.5) * 0.5 + 0.5) * (Math.cos(time * 2.0) * 0.4 + 0.6);
          calculatedVolume = 0.25 + wave * 0.45;

          for (let b = 0; b < 9; b++) {
            const offsetWave = Math.sin(time * 4.0 + b * 0.6) * 0.5 + 0.5;
            targetBarHeights[b] = 0.2 + offsetWave * 0.65;
          }
        }

        targetScale = 1.0 + calculatedVolume * 0.35;
        targetGlow = 24.0 + calculatedVolume * 45.0;
        targetOpacity = 0.95 + calculatedVolume * 0.05;
      } else if (currentState === 'listening') {
        const micAnalyser = micAnalyserRef.current;
        if (micAnalyser) {
          micAnalyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 0; i < 32; i++) {
            sum += freqData[i];
          }
          calculatedVolume = sum / 32 / 255;

          for (let b = 0; b < 9; b++) {
            const binIdx = Math.min(31, b * 3);
            const val = freqData[binIdx] / 255;
            targetBarHeights[b] = Math.max(0.15, Math.min(1.0, val * 1.4));
          }
        } else {
          calculatedVolume = Math.min(1.0, Math.max(0, audioLevelRef.current / 60));
          for (let b = 0; b < 9; b++) {
            const profile = Math.sin((b / 8) * Math.PI);
            targetBarHeights[b] = Math.max(0.15, profile * calculatedVolume);
          }
        }

        const idlePulse = Math.sin(time * 2.0) * 0.03;
        targetScale = 0.96 + idlePulse + calculatedVolume * 0.3;
        targetGlow = 18.0 + calculatedVolume * 36.0;
        targetOpacity = 0.85 + calculatedVolume * 0.15;
      } else if (currentState === 'thinking') {
        const thinkingPulse = Math.sin(time * 1.5) * 0.5 + 0.5;
        targetScale = 0.92 + thinkingPulse * 0.08;
        targetGlow = 20.0 + thinkingPulse * 22.0;
        targetOpacity = 0.8 + thinkingPulse * 0.2;

        for (let b = 0; b < 9; b++) {
          const wavePhase = Math.sin(time * 3.0 + b * 0.7) * 0.5 + 0.5;
          targetBarHeights[b] = 0.2 + wavePhase * 0.5;
        }
      } else {
        const restingPulse = Math.sin(time * 0.9) * 0.02;
        targetScale = 0.92 + restingPulse;
        targetGlow = 15.0;
        targetOpacity = 0.75;

        for (let b = 0; b < 9; b++) {
          targetBarHeights[b] = 0.15;
        }
      }

      // Smooth lerp
      currentScale += (targetScale - currentScale) * 0.14;
      currentGlow += (targetGlow - currentGlow) * 0.12;
      currentOpacity += (targetOpacity - currentOpacity) * 0.12;

      for (let b = 0; b < 9; b++) {
        currentBarHeights[b] += (targetBarHeights[b] - currentBarHeights[b]) * 0.2;
      }

      // State-specific glow color
      let glowColor = 'rgba(99, 102, 241, 0.85)'; // electric indigo (speaking)
      if (currentState === 'listening') {
        glowColor = 'rgba(6, 182, 212, 0.85)'; // vibrant cyan (listening)
      } else if (currentState === 'thinking') {
        glowColor = 'rgba(245, 158, 11, 0.85)'; // amber gold (thinking)
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 2. UPDATE VISUAL ELEMENTS ACCORDING TO SELECTED STYLE
      // ─────────────────────────────────────────────────────────────────────────
      if (currentStyle === 'circular') {
        if (centeredOrbRef.current) {
          centeredOrbRef.current.style.transform = `scale(${currentScale.toFixed(4)})`;
          centeredOrbRef.current.style.opacity = currentOpacity.toFixed(3);
          centeredOrbRef.current.style.boxShadow = `0 0 ${currentGlow.toFixed(
            1
          )}px ${glowColor}, inset 0 0 20px rgba(255, 255, 255, 0.3)`;
          centeredOrbRef.current.style.filter = `drop-shadow(0 0 ${(currentGlow * 0.6).toFixed(
            1
          )}px ${glowColor})`;
        }

        if (outerGlowRef.current) {
          const auraScale = currentScale * 1.45;
          outerGlowRef.current.style.transform = `scale(${auraScale.toFixed(4)})`;
          outerGlowRef.current.style.opacity = (currentOpacity * 0.35).toFixed(3);
        }
      } else if (currentStyle === 'bars') {
        // Equalizer Bars mode: animate bar heights and glowing container
        for (let b = 0; b < 9; b++) {
          const barEl = barRefs.current[b];
          if (barEl) {
            const hPercent = Math.max(12, Math.min(100, currentBarHeights[b] * 100));
            barEl.style.height = `${hPercent.toFixed(1)}%`;
            barEl.style.filter = `drop-shadow(0 0 ${(currentGlow * 0.3).toFixed(1)}px ${glowColor})`;
          }
        }
      } else if (currentStyle === 'wave') {
        // Concentric Ripple Wave mode
        if (waveContainerRef.current) {
          const waves = waveContainerRef.current.children;
          for (let i = 0; i < waves.length; i++) {
            const ringEl = waves[i] as HTMLElement;
            if (ringEl) {
              const ringMultiplier = 1 + i * 0.35;
              const ringScale = currentScale * ringMultiplier;
              const ringOpacity = Math.max(0.15, (currentOpacity / (i + 1.2)));
              ringEl.style.transform = `scale(${ringScale.toFixed(4)})`;
              ringEl.style.opacity = ringOpacity.toFixed(3);
              ringEl.style.borderColor = glowColor;
              ringEl.style.boxShadow = `0 0 ${(currentGlow * 0.5).toFixed(1)}px ${glowColor}`;
            }
          }
        }
      }

      animationId = requestAnimationFrame(renderFrame);
    };

    animationId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  // Gradients for each state
  const getOrbGradient = () => {
    switch (state) {
      case 'speaking':
        return 'radial-gradient(circle at 35% 30%, #ffffff 0%, #c7d2fe 22%, #6366f1 55%, #8b5cf6 78%, #312e81 100%)';
      case 'listening':
        return 'radial-gradient(circle at 35% 30%, #ffffff 0%, #a5f3fc 25%, #06b6d4 55%, #0284c7 80%, #0f172a 100%)';
      case 'thinking':
        return 'radial-gradient(circle at 35% 30%, #fffbeb 0%, #fde68a 25%, #f59e0b 55%, #ec4899 80%, #4c0519 100%)';
      default:
        return 'radial-gradient(circle at 35% 30%, #f8fafc 0%, #cbd5e1 30%, #64748b 70%, #1e293b 100%)';
    }
  };

  const getBarGradient = () => {
    switch (state) {
      case 'speaking':
        return 'linear-gradient(to top, #4338ca, #6366f1, #a5b4fc)';
      case 'listening':
        return 'linear-gradient(to top, #0891b2, #06b6d4, #a5f3fc)';
      case 'thinking':
        return 'linear-gradient(to top, #d97706, #f59e0b, #fef3c7)';
      default:
        return 'linear-gradient(to top, #475569, #94a3b8, #f1f5f9)';
    }
  };

  const getAuraColor = () => {
    switch (state) {
      case 'speaking':
        return 'radial-gradient(circle, rgba(99, 102, 241, 0.5) 0%, rgba(139, 92, 246, 0.25) 55%, transparent 75%)';
      case 'listening':
        return 'radial-gradient(circle, rgba(6, 182, 212, 0.55) 0%, rgba(59, 130, 246, 0.25) 55%, transparent 75%)';
      case 'thinking':
        return 'radial-gradient(circle, rgba(245, 158, 11, 0.5) 0%, rgba(236, 72, 153, 0.25) 55%, transparent 75%)';
      default:
        return 'radial-gradient(circle, rgba(148, 163, 184, 0.3) 0%, transparent 70%)';
    }
  };

  return (
    <div
      className={`relative flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {/* ─────────────────────────────────────────────────────────────────
          STYLE 1: CIRCULAR 3D FLUID ORB
      ───────────────────────────────────────────────────────────────── */}
      {visualizationStyle === 'circular' && (
        <>
          <div
            ref={outerGlowRef}
            className="absolute inset-0 rounded-full pointer-events-none transition-colors duration-500 will-change-transform"
            style={{ background: getAuraColor() }}
          />

          <div
            ref={centeredOrbRef}
            className="relative rounded-full pointer-events-none will-change-transform flex items-center justify-center transition-colors duration-500"
            style={{
              width: size * 0.75,
              height: size * 0.75,
              background: getOrbGradient(),
            }}
          >
            {/* Specular fluid light highlight reflection */}
            <div
              className="w-1/3 h-1/3 rounded-full pointer-events-none opacity-80 blur-2xs"
              style={{
                background:
                  'radial-gradient(circle, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.3) 60%, transparent 100%)',
                transform: 'translate(-20%, -20%)',
              }}
            />
          </div>
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────────
          STYLE 2: EQUALIZER FREQUENCY BARS SPECTRUM
      ───────────────────────────────────────────────────────────────── */}
      {visualizationStyle === 'bars' && (
        <div
          ref={barsContainerRef}
          className="relative flex items-center justify-center gap-1 w-full h-full p-2"
        >
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((idx) => (
            <div
              key={idx}
              ref={(el) => {
                barRefs.current[idx] = el;
              }}
              className="w-1.5 rounded-full transition-[height] duration-75 ease-out shadow-xs"
              style={{
                height: '25%',
                background: getBarGradient(),
              }}
            />
          ))}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────
          STYLE 3: CIRCULAR CONCENTRIC RIPPLE WAVES
      ───────────────────────────────────────────────────────────────── */}
      {visualizationStyle === 'wave' && (
        <div
          ref={waveContainerRef}
          className="relative flex items-center justify-center w-full h-full pointer-events-none"
        >
          {/* Innermost pulsing core */}
          <div
            className="absolute rounded-full transition-colors duration-300"
            style={{
              width: size * 0.35,
              height: size * 0.35,
              background: getOrbGradient(),
            }}
          />
          {/* Concentric ripple wave rings */}
          <div
            className="absolute rounded-full border-2 border-indigo-400 will-change-transform"
            style={{
              width: size * 0.52,
              height: size * 0.52,
            }}
          />
          <div
            className="absolute rounded-full border-2 border-indigo-400/80 will-change-transform"
            style={{
              width: size * 0.72,
              height: size * 0.72,
            }}
          />
          <div
            className="absolute rounded-full border border-indigo-300/50 will-change-transform"
            style={{
              width: size * 0.92,
              height: size * 0.92,
            }}
          />
        </div>
      )}
    </div>
  );
};
