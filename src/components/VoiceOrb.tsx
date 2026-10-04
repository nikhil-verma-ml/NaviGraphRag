import React, { useEffect, useRef } from 'react';

export type VoiceOrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface VoiceOrbProps {
  /** Current state of the voice interface */
  state: VoiceOrbState;
  /** HTMLAudioElement playing TTS audio, connected to AnalyserNode */
  audioElement?: HTMLAudioElement | null;
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
}

// Global WeakMap to prevent recreating MediaElementSourceNode on the same HTMLAudioElement
const audioSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

/**
 * VoiceOrb Component
 * Implements a Web Audio API-driven animation.
 * Accepts `state` ('idle', 'listening', 'thinking', 'speaking') and `audioElement` props.
 * Uses an AnalyserNode to calculate frequency data on requestAnimationFrame
 * and applies smooth scaling / glow effects via CSS transforms and styles to a centered div,
 * ensuring the visualization reacts to real-time audio volume.
 */
export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  state,
  audioElement,
  micAnalyser,
  audioLevel = 0,
  className = '',
  size = 260,
}) => {
  // Ref to the centered circular div element
  const centeredOrbRef = useRef<HTMLDivElement | null>(null);
  // Ref to outer ambient glow halo div
  const outerGlowRef = useRef<HTMLDivElement | null>(null);

  // References to keep current values inside requestAnimationFrame without re-renders
  const stateRef = useRef<VoiceOrbState>(state);
  stateRef.current = state;

  const audioLevelRef = useRef<number>(audioLevel);
  audioLevelRef.current = audioLevel;

  const micAnalyserRef = useRef<AnalyserNode | null>(micAnalyser || null);
  micAnalyserRef.current = micAnalyser || null;

  // Web Audio Context and AnalyserNode for audioElement
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);

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
  // and smoothly applies CSS transform scaling and glow effects.
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

    const freqData = new Uint8Array(128);

    const renderFrame = () => {
      time += 0.025;
      const currentState = stateRef.current;
      let calculatedVolume = 0;

      // ─────────────────────────────────────────────────────────────────────────
      // 1. CALCULATE REAL-TIME AUDIO FREQUENCY DATA & VOLUME VIA ANALYSERNODE
      // ─────────────────────────────────────────────────────────────────────────
      if (currentState === 'speaking') {
        const analyser = analyserNodeRef.current;
        if (analyser) {
          analyser.getByteFrequencyData(freqData);

          // Calculate average frequency volume across active bins
          let sum = 0;
          const activeBins = 32;
          for (let i = 0; i < activeBins; i++) {
            sum += freqData[i];
          }
          calculatedVolume = sum / activeBins / 255; // 0.0 to 1.0
        }

        // Fallback smooth harmonic wave if volume is low or synthetic Web Speech is used
        if (calculatedVolume < 0.03) {
          const wave =
            (Math.sin(time * 3.5) * 0.5 + 0.5) * (Math.cos(time * 2.0) * 0.4 + 0.6);
          calculatedVolume = 0.25 + wave * 0.45;
        }

        // Map speaking volume to scale and glow:
        // Loud speech expands the orb up to 1.35x with deep electric glow
        targetScale = 1.0 + calculatedVolume * 0.35;
        targetGlow = 24.0 + calculatedVolume * 45.0;
        targetOpacity = 0.95 + calculatedVolume * 0.05;
      } else if (currentState === 'listening') {
        // Real-time microphone audio volume
        const micAnalyser = micAnalyserRef.current;
        if (micAnalyser) {
          micAnalyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 0; i < 32; i++) {
            sum += freqData[i];
          }
          calculatedVolume = sum / 32 / 255;
        } else {
          calculatedVolume = Math.min(1.0, Math.max(0, audioLevelRef.current / 60));
        }

        // Gentle breathing pulse when silent, expands dynamically when user speaks
        const idlePulse = Math.sin(time * 2.0) * 0.03;
        targetScale = 0.96 + idlePulse + calculatedVolume * 0.3;
        targetGlow = 18.0 + calculatedVolume * 36.0;
        targetOpacity = 0.85 + calculatedVolume * 0.15;
      } else if (currentState === 'thinking') {
        // Hypnotic, slow celestial breathing pulse (no audio input)
        const thinkingPulse = Math.sin(time * 1.5) * 0.5 + 0.5;
        targetScale = 0.92 + thinkingPulse * 0.08;
        targetGlow = 20.0 + thinkingPulse * 22.0;
        targetOpacity = 0.8 + thinkingPulse * 0.2;
      } else {
        // Idle state: peaceful, resting orb
        const restingPulse = Math.sin(time * 0.9) * 0.02;
        targetScale = 0.92 + restingPulse;
        targetGlow = 15.0;
        targetOpacity = 0.75;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // 2. SMOOTH LERP INTERPOLATION (Zero jitter / abrupt jumping)
      // ─────────────────────────────────────────────────────────────────────────
      currentScale += (targetScale - currentScale) * 0.14;
      currentGlow += (targetGlow - currentGlow) * 0.12;
      currentOpacity += (targetOpacity - currentOpacity) * 0.12;

      // ─────────────────────────────────────────────────────────────────────────
      // 3. APPLY CSS TRANSFORMS & GLOW EFFECTS DIRECTLY TO CENTERED DIV
      // ─────────────────────────────────────────────────────────────────────────
      if (centeredOrbRef.current) {
        // Smooth scaling via CSS transform
        centeredOrbRef.current.style.transform = `scale(${currentScale.toFixed(4)})`;
        centeredOrbRef.current.style.opacity = currentOpacity.toFixed(3);

        // State-specific glow colors
        let glowColor = 'rgba(99, 102, 241, 0.85)'; // electric indigo (speaking)
        if (currentState === 'listening') {
          glowColor = 'rgba(6, 182, 212, 0.85)'; // vibrant cyan (listening)
        } else if (currentState === 'thinking') {
          glowColor = 'rgba(245, 158, 11, 0.85)'; // amber gold (thinking)
        }

        // Multi-layered smooth glow effect via box-shadow and drop-shadow
        centeredOrbRef.current.style.boxShadow = `0 0 ${currentGlow.toFixed(
          1
        )}px ${glowColor}, inset 0 0 20px rgba(255, 255, 255, 0.3)`;
        centeredOrbRef.current.style.filter = `drop-shadow(0 0 ${(currentGlow * 0.6).toFixed(
          1
        )}px ${glowColor})`;
      }

      // Outer diffuse ambient glow halo
      if (outerGlowRef.current) {
        const auraScale = currentScale * 1.45;
        outerGlowRef.current.style.transform = `scale(${auraScale.toFixed(4)})`;
        outerGlowRef.current.style.opacity = (currentOpacity * 0.35).toFixed(3);
      }

      animationId = requestAnimationFrame(renderFrame);
    };

    animationId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  // Background gradient based on current state
  const getOrbGradient = () => {
    switch (state) {
      case 'speaking':
        // Luminous Indigo, Royal Blue & Purple
        return 'radial-gradient(circle at 35% 30%, #ffffff 0%, #c7d2fe 22%, #6366f1 55%, #8b5cf6 78%, #312e81 100%)';
      case 'listening':
        // Electric Cyan, Sky Blue & Turquoise
        return 'radial-gradient(circle at 35% 30%, #ffffff 0%, #a5f3fc 25%, #06b6d4 55%, #0284c7 80%, #0f172a 100%)';
      case 'thinking':
        // Celestial Amber, Warm Gold & Rose Magenta
        return 'radial-gradient(circle at 35% 30%, #fffbeb 0%, #fde68a 25%, #f59e0b 55%, #ec4899 80%, #4c0519 100%)';
      default:
        // Idle Slate Pearl
        return 'radial-gradient(circle at 35% 30%, #f8fafc 0%, #cbd5e1 30%, #64748b 70%, #1e293b 100%)';
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
      {/* Outer ambient glow halo div */}
      <div
        ref={outerGlowRef}
        className="absolute inset-0 rounded-full pointer-events-none transition-colors duration-500 will-change-transform"
        style={{ background: getAuraColor() }}
      />

      {/* The Centered Circular Div:
          Web Audio API frequency volume dynamically scales this div via CSS transforms
          and animates glowing box-shadow and drop-shadow effects */}
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
    </div>
  );
};
