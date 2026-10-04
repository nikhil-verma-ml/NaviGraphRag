import React, { useState } from 'react';
import { Mic, MicOff, Square, X, Minimize2, Maximize2, Sparkles, Volume2 } from 'lucide-react';
import { VoiceConversationState, LatencyMetrics } from '../types.js';
import { VoiceOrb, VoiceOrbState } from './VoiceOrb.js';

interface VoiceConversationOverlayProps {
  conversationState: VoiceConversationState;
  currentAssistantMessage: string;
  latestThinkingStep?: string;
  isAudioSpeaking: boolean;
  onInterrupt: () => void;
  onExitVoiceMode: () => void;
  onToggleMute: () => void;
  isMuted: boolean;
  audioLevel?: number; // 0 to 100 for mic/audio reactivity
  audioElement?: HTMLAudioElement | null;
  micAnalyser?: AnalyserNode | null;
  llmMetrics?: LatencyMetrics;
}

export const VoiceConversationOverlay: React.FC<VoiceConversationOverlayProps> = ({
  conversationState,
  currentAssistantMessage,
  latestThinkingStep,
  isAudioSpeaking,
  onInterrupt,
  onExitVoiceMode,
  onToggleMute,
  isMuted,
  audioLevel = 0,
  audioElement,
  micAnalyser,
  llmMetrics,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);

  if (conversationState === 'IDLE') return null;

  // Map conversationState to VoiceOrb state ('idle' | 'listening' | 'thinking' | 'speaking')
  const orbState: VoiceOrbState =
    conversationState === 'LISTENING'
      ? 'listening'
      : conversationState === 'THINKING'
      ? 'thinking'
      : conversationState === 'SPEAKING'
      ? 'speaking'
      : 'idle';

  // 1. Minimized floating pill bar (if user wants to browse chat/documents while in voice mode)
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-950/90 text-white shadow-2xl border border-slate-800 backdrop-blur-xl">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mini Voice Orb */}
            <div className="w-10 h-10 shrink-0">
              <VoiceOrb
                state={orbState}
                audioElement={audioElement}
                micAnalyser={micAnalyser}
                audioLevel={audioLevel}
                size={40}
              />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide uppercase text-slate-400">
                {conversationState === 'LISTENING' && 'Listening...'}
                {conversationState === 'THINKING' && 'Thinking...'}
                {conversationState === 'SPEAKING' && 'Speaking'}
              </div>
              <p className="text-xs text-slate-200 truncate">
                {conversationState === 'SPEAKING'
                  ? currentAssistantMessage || 'Generating...'
                  : conversationState === 'THINKING'
                  ? latestThinkingStep || 'Processing retrieval...'
                  : 'Speak your question...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            {conversationState === 'SPEAKING' && (
              <button
                type="button"
                onClick={onInterrupt}
                className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
              >
                Interrupt
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Expand to Full Orb Mode"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExitVoiceMode}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Exit Voice Mode"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Full-Screen ChatGPT-Style Voice Interface with Large Central Orb
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-slate-950/95 text-white backdrop-blur-2xl transition-all duration-300">
      {/* Top Header Bar */}
      <header className="px-6 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-sm shadow-inner">
            🤖
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-white">NaviGraph Voice</h2>
            <p className="text-[11px] text-slate-400 font-mono">Agentic RAG Mode</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Minimize button */}
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition-colors"
            title="Minimize to floating bar"
          >
            <Minimize2 className="w-4 h-4" />
          </button>

          {/* Close/Exit Voice Mode button */}
          <button
            type="button"
            onClick={onExitVoiceMode}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition-colors"
            title="Exit Voice Mode"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Center Area: Large ChatGPT Voice Orb */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 relative select-none">
        {/* Soft Ambient Background Glow */}
        <div
          className={`absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full blur-[90px] pointer-events-none opacity-25 transition-all duration-700 ${
            conversationState === 'LISTENING'
              ? 'bg-cyan-500 scale-105'
              : conversationState === 'THINKING'
              ? 'bg-amber-500 scale-95'
              : conversationState === 'SPEAKING'
              ? 'bg-indigo-600 scale-110'
              : 'bg-slate-600 scale-90'
          }`}
        />

        {/* The Animated Voice Orb */}
        <div className="relative z-10 flex items-center justify-center">
          <VoiceOrb
            state={orbState}
            audioElement={audioElement}
            micAnalyser={micAnalyser}
            isListening={conversationState === 'LISTENING'}
            audioLevel={audioLevel}
            size={280}
          />
        </div>

        {/* LLM Gateway Metrics & State Label */}
        <div className="mt-8 text-center max-w-md px-4 z-10 flex flex-col items-center gap-2">
          {/* Active State Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-xs font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                conversationState === 'LISTENING'
                  ? 'bg-cyan-400 animate-pulse'
                  : conversationState === 'THINKING'
                  ? 'bg-amber-400 animate-spin'
                  : 'bg-indigo-400 animate-pulse'
              }`}
            />
            <span className="text-slate-300 font-semibold tracking-wide uppercase text-[11px]">
              {conversationState === 'LISTENING' && 'Listening'}
              {conversationState === 'THINKING' && 'Thinking...'}
              {conversationState === 'SPEAKING' && 'Speaking'}
            </span>
          </div>

          {/* Live LLM Gateway Metrics Indicator */}
          {llmMetrics && (
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-slate-900/60 border border-slate-800/80 text-[10px] font-mono text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{llmMetrics.provider || 'Gemini Gateway'}</span>
              {llmMetrics.llmFirstTokenMs ? (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-blue-400">TTFT: {llmMetrics.llmFirstTokenMs}ms</span>
                </>
              ) : null}
              {llmMetrics.tokensPerSec ? (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-indigo-400">{llmMetrics.tokensPerSec} tok/s</span>
                </>
              ) : null}
            </div>
          )}

          {/* Thinking Step / Live Subtitle Preview */}
          {conversationState === 'THINKING' && (
            <p className="mt-3 text-xs text-amber-200/90 font-mono tracking-tight animate-pulse">
              {latestThinkingStep || 'Formulating contextual RAG answer...'}
            </p>
          )}

          {conversationState === 'LISTENING' && (
            <p className="mt-3 text-xs text-slate-400 font-normal">
              Speak naturally. NaviGraph will automatically respond.
            </p>
          )}

          {conversationState === 'SPEAKING' && (
            <div className="mt-4 max-h-24 overflow-y-auto px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-200 leading-relaxed text-left">
              {currentAssistantMessage || 'Streaming response...'}
              <span className="inline-block w-1.5 h-3 ml-1 bg-indigo-400 animate-pulse align-middle" />
            </div>
          )}
        </div>
      </main>

      {/* Bottom Control Bar */}
      <footer className="p-6 pb-8 flex flex-col items-center gap-3 z-10">
        <div className="flex items-center gap-4">
          {/* Mute Microphone Button */}
          <button
            type="button"
            onClick={onToggleMute}
            className={`p-3.5 rounded-full border transition-all shadow-lg ${
              isMuted
                ? 'bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white hover:bg-slate-800'
            }`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Barge-in / Interrupt Button */}
          {conversationState === 'SPEAKING' && (
            <button
              type="button"
              onClick={onInterrupt}
              className="flex items-center gap-2 px-5 py-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-xl transition-all active:scale-95 animate-pulse"
              title="Interrupt AI and speak"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Interrupt (Barge-in)</span>
            </button>
          )}

          {/* End Voice Mode Button */}
          <button
            type="button"
            onClick={onExitVoiceMode}
            className="p-3.5 rounded-full bg-slate-900 hover:bg-red-600 text-slate-400 hover:text-white border border-slate-800 transition-colors shadow-lg"
            title="End Conversation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          Interrupt at any time by speaking or tapping Interrupt
        </p>
      </footer>
    </div>
  );
};
