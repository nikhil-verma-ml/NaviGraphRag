import React from 'react';
import { X, Volume2 } from 'lucide-react';
import { VoiceConversationState } from '../types.js';
import { VoiceOrb, VoiceOrbState } from './VoiceOrb.js';

interface VoiceConversationOverlayProps {
  conversationState: VoiceConversationState;
  currentAssistantMessage?: string;
  latestThinkingStep?: string;
  isAudioSpeaking: boolean;
  onInterrupt: () => void;
  onExitVoiceMode: () => void;
  onToggleMute?: () => void;
  isMuted?: boolean;
  audioLevel?: number;
  audioElement?: HTMLAudioElement | null;
  speechAnalyser?: AnalyserNode | null;
  micAnalyser?: AnalyserNode | null;
  isAudioSuspended?: boolean;
  onActivateAudio?: () => void;
  llmMetrics?: any;
}

/**
 * Pure floating circular VoiceOrb component.
 * - Absolutely NO surrounding box, card, or container.
 * - Keeps the existing chat page fully visible.
 * - Smoothly pulses and glows according to audio analyser / amplitude.
 * - Clicking the orb while speaking immediately stops TTS (via onInterrupt) and returns to listening.
 * - Supports 4 states: 'idle' | 'listening' | 'thinking' | 'speaking'.
 * - Responsive and polished on desktop and mobile.
 */
export const VoiceConversationOverlay: React.FC<VoiceConversationOverlayProps> = ({
  conversationState,
  isAudioSpeaking,
  onInterrupt,
  onExitVoiceMode,
  audioLevel = 0,
  speechAnalyser,
  micAnalyser,
  isAudioSuspended = false,
  onActivateAudio,
}) => {
  // If voice mode is inactive and no speech is playing, don't render anything
  if (conversationState === 'IDLE' && !isAudioSpeaking) return null;

  // Map conversationState to VoiceOrbState ('idle' | 'listening' | 'thinking' | 'speaking')
  const orbState: VoiceOrbState = isAudioSpeaking
    ? 'speaking'
    : conversationState === 'LISTENING'
    ? 'listening'
    : conversationState === 'THINKING'
    ? 'thinking'
    : conversationState === 'SPEAKING'
    ? 'speaking'
    : 'idle';

  // Clicking the orb stops TTS and returns to listening when speaking, or interrupts
  const handleOrbClick = () => {
    if (isAudioSpeaking || orbState === 'speaking') {
      onInterrupt();
    } else if (orbState === 'thinking') {
      onInterrupt();
    }
  };

  return (
    <div
      aria-label="Floating Voice Orb"
      className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 z-50 flex flex-col items-center select-none pointer-events-auto animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Floating Circular Orb Button Target */}
      <div className="relative group flex items-center justify-center">
        {/* Subtle Backdrop Glow Ring */}
        <div
          className={`absolute -inset-2 rounded-full opacity-60 blur-md transition-all duration-300 pointer-events-none ${
            orbState === 'speaking'
              ? 'bg-indigo-500/40 group-hover:opacity-80'
              : orbState === 'listening'
              ? 'bg-cyan-500/40 group-hover:opacity-80'
              : orbState === 'thinking'
              ? 'bg-amber-500/40 group-hover:opacity-80'
              : 'bg-slate-400/20'
          }`}
        />

        {/* The Clickable Circular Orb */}
        <button
          type="button"
          onClick={handleOrbClick}
          className={`relative rounded-full p-0 border-0 bg-transparent cursor-pointer transition-transform duration-200 focus:outline-none ${
            orbState === 'speaking'
              ? 'hover:scale-108 active:scale-95'
              : 'hover:scale-105 active:scale-95'
          }`}
          title={
            orbState === 'speaking'
              ? 'Click orb to interrupt AI speech'
              : orbState === 'listening'
              ? 'Listening to your voice...'
              : orbState === 'thinking'
              ? 'AI is thinking and searching...'
              : 'Voice Mode ready'
          }
          aria-label={
            orbState === 'speaking' ? 'Interrupt AI speech' : 'Voice Mode Orb'
          }
        >
          <VoiceOrb
            state={orbState}
            speechAnalyser={speechAnalyser}
            micAnalyser={micAnalyser}
            isListening={orbState === 'listening'}
            audioLevel={audioLevel}
            size={80}
            visualizationStyle="circular"
          />
        </button>

        {/* Minimal Dismiss / Exit Button (shown on hover/focus) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExitVoiceMode();
          }}
          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-slate-900/85 hover:bg-slate-950 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150 shadow-lg text-xs cursor-pointer border border-slate-700/50"
          title="Exit Voice Mode"
          aria-label="Exit Voice Mode"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sleek Floating Status Pill Below Orb */}
      <div
        className={`mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-tight shadow-md backdrop-blur-md transition-all duration-200 pointer-events-none flex items-center gap-1.5 ${
          orbState === 'speaking'
            ? 'bg-indigo-950/85 text-indigo-200 border border-indigo-500/30'
            : orbState === 'listening'
            ? 'bg-cyan-950/85 text-cyan-200 border border-cyan-500/30'
            : orbState === 'thinking'
            ? 'bg-amber-950/85 text-amber-200 border border-amber-500/30'
            : 'bg-slate-900/85 text-slate-300 border border-slate-700/30'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            orbState === 'speaking'
              ? 'bg-indigo-400 animate-pulse'
              : orbState === 'listening'
              ? 'bg-cyan-400 animate-pulse'
              : orbState === 'thinking'
              ? 'bg-amber-400 animate-ping'
              : 'bg-slate-400'
          }`}
        />
        <span>
          {orbState === 'speaking'
            ? 'Tap to interrupt'
            : orbState === 'listening'
            ? 'Listening...'
            : orbState === 'thinking'
            ? 'Thinking...'
            : 'Ready'}
        </span>
      </div>

      {/* Primary Autoplay Unlock Badge if AudioContext is suspended */}
      {isAudioSuspended && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActivateAudio?.();
          }}
          className="mt-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500 hover:bg-amber-600 text-white shadow-lg animate-pulse cursor-pointer flex items-center gap-1 transition-all"
          title="Click to enable audio"
        >
          <Volume2 className="w-3 h-3" />
          <span>Tap to unmute</span>
        </button>
      )}
    </div>
  );
};
