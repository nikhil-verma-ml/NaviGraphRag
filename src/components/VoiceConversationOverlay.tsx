import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Square,
  X,
  Sparkles,
  Volume2,
  VolumeX,
  Settings,
  Circle,
  BarChart2,
  Waves,
  Check,
} from 'lucide-react';
import { VoiceConversationState, LatencyMetrics } from '../types.js';
import { VoiceOrb, VoiceOrbState, VoiceOrbVisualizationStyle } from './VoiceOrb.js';

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
  speechAnalyser?: AnalyserNode | null;
  micAnalyser?: AnalyserNode | null;
  llmMetrics?: LatencyMetrics;
  isAudioSuspended?: boolean;
  onActivateAudio?: () => void;
}

/**
 * Fixed-position floating Voice Mode widget with Visualization Style Toggle.
 * Container: 'fixed bottom-6 right-6 z-50 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl'
 * Keeps the existing chat interface fully visible, with the VoiceOrb centered
 * and allows users to toggle between circular 3D orb, equalizer frequency bars, and acoustic ripple waves.
 */
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
  speechAnalyser,
  micAnalyser,
  llmMetrics,
  isAudioSuspended = false,
  onActivateAudio,
}) => {
  // Visualization style setting with localStorage persistence
  const [visualizationStyle, setVisualizationStyle] = useState<VoiceOrbVisualizationStyle>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('navigraph_orb_style') as VoiceOrbVisualizationStyle;
      if (saved === 'circular' || saved === 'bars' || saved === 'wave') {
        return saved;
      }
    }
    return 'circular';
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleSelectStyle = (style: VoiceOrbVisualizationStyle) => {
    setVisualizationStyle(style);
    if (typeof window !== 'undefined') {
      localStorage.setItem('navigraph_orb_style', style);
    }
    setIsSettingsOpen(false);
  };

  // If voice mode is inactive, render nothing
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

  return (
    <div
      aria-label="Floating Voice Mode Widget"
      className="fixed bottom-6 right-6 z-50 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden p-4 animate-in fade-in slide-in-from-bottom-4 duration-200 select-none"
    >
      {/* Widget Header: Status & Controls */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              conversationState === 'LISTENING'
                ? 'bg-cyan-500 animate-pulse'
                : conversationState === 'THINKING'
                ? 'bg-amber-500 animate-spin'
                : conversationState === 'SPEAKING'
                ? 'bg-indigo-600 animate-pulse'
                : 'bg-slate-400'
            }`}
          />
          <span className="text-xs font-semibold text-slate-800 tracking-tight truncate">
            {isSettingsOpen
              ? 'Orb Settings'
              : conversationState === 'LISTENING'
              ? 'Listening...'
              : conversationState === 'THINKING'
              ? 'Thinking & Searching'
              : 'AI Speaking'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Visualizer Style Settings Button */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isSettingsOpen
                ? 'bg-blue-100 text-blue-700'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            }`}
            title="Toggle Orb Visualization Style (Circle, Bars, Waves)"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Mute/Unmute Mic Button */}
          <button
            type="button"
            onClick={onToggleMute}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isMuted
                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            }`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Close Voice Mode Button */}
          <button
            type="button"
            onClick={onExitVoiceMode}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Exit Voice Mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Conditional: Settings Menu View OR Live Orb Visualization */}
      {isSettingsOpen ? (
        <div className="py-1 space-y-2 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-1">
            <span className="text-[11px] font-semibold text-slate-700">Choose Animation Style</span>
            <span className="text-[10px] text-slate-400">Real-time Audio</span>
          </div>

          <div className="space-y-1.5">
            {/* Style 1: Circular 3D Orb */}
            <button
              type="button"
              onClick={() => handleSelectStyle('circular')}
              className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer ${
                visualizationStyle === 'circular'
                  ? 'bg-blue-50 text-blue-800 font-semibold border border-blue-200 shadow-2xs'
                  : 'hover:bg-slate-50 text-slate-700 border border-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <Circle className="w-4 h-4 text-indigo-500 fill-indigo-100 shrink-0" />
                <div className="text-left">
                  <p className="leading-tight">Circular 3D Orb</p>
                  <p className="text-[10px] text-slate-400 font-normal">Fluid glowing sphere with aura</p>
                </div>
              </div>
              {visualizationStyle === 'circular' && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
            </button>

            {/* Style 2: Bar Graph Equalizer Spectrum */}
            <button
              type="button"
              onClick={() => handleSelectStyle('bars')}
              className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer ${
                visualizationStyle === 'bars'
                  ? 'bg-blue-50 text-blue-800 font-semibold border border-blue-200 shadow-2xs'
                  : 'hover:bg-slate-50 text-slate-700 border border-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-cyan-600 shrink-0" />
                <div className="text-left">
                  <p className="leading-tight">Bar Graph Spectrum</p>
                  <p className="text-[10px] text-slate-400 font-normal">Frequency equalizer spectrum</p>
                </div>
              </div>
              {visualizationStyle === 'bars' && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
            </button>

            {/* Style 3: Circular Ripple Waves */}
            <button
              type="button"
              onClick={() => handleSelectStyle('wave')}
              className={`w-full flex items-center justify-between p-2 rounded-xl text-xs transition-all cursor-pointer ${
                visualizationStyle === 'wave'
                  ? 'bg-blue-50 text-blue-800 font-semibold border border-blue-200 shadow-2xs'
                  : 'hover:bg-slate-50 text-slate-700 border border-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-purple-600 shrink-0" />
                <div className="text-left">
                  <p className="leading-tight">Circular Waves</p>
                  <p className="text-[10px] text-slate-400 font-normal">Concentric acoustic ripples</p>
                </div>
              </div>
              {visualizationStyle === 'wave' && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(false)}
            className="w-full mt-2 py-1 text-center text-[11px] font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          {/* Centered Voice Orb */}
          <div className="flex items-center justify-center py-2 relative">
            <div className="w-20 h-20 flex items-center justify-center">
              <VoiceOrb
                state={orbState}
                audioElement={audioElement}
                speechAnalyser={speechAnalyser}
                micAnalyser={micAnalyser}
                isListening={conversationState === 'LISTENING'}
                audioLevel={audioLevel}
                size={76}
                visualizationStyle={visualizationStyle}
              />
            </div>
          </div>

          {/* Content Area: Status Message & Live Text Preview */}
          <div className="mt-2 text-center">
            <div className="text-[11px] font-medium text-slate-500 leading-snug">
              {conversationState === 'LISTENING' && (
                <span>{isMuted ? 'Microphone muted. Tap mic to speak.' : 'Speak your question naturally'}</span>
              )}
              {conversationState === 'THINKING' && (
                <span className="text-amber-600 font-mono text-[11px]">
                  {latestThinkingStep || 'Searching knowledge base...'}
                </span>
              )}
              {conversationState === 'SPEAKING' && (
                <div className="text-left bg-slate-50 border border-slate-100 rounded-xl p-2.5 max-h-20 overflow-y-auto">
                  <p className="text-xs text-slate-700 leading-relaxed font-normal">
                    {currentAssistantMessage || 'Generating response...'}
                  </p>
                </div>
              )}
            </div>

            {/* Telemetry pill (if available) */}
            {llmMetrics && (
              <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] font-mono text-slate-400">
                <span>{llmMetrics.provider || 'Gemini'}</span>
                {llmMetrics.llmFirstTokenMs ? (
                  <>
                    <span>•</span>
                    <span className="text-blue-600">{llmMetrics.llmFirstTokenMs}ms</span>
                  </>
                ) : null}
                {llmMetrics.tokensPerSec ? (
                  <>
                    <span>•</span>
                    <span className="text-indigo-600">{llmMetrics.tokensPerSec} t/s</span>
                  </>
                ) : null}
              </div>
            )}

            {/* Visual Unmute / Activate Audio button if AudioContext is suspended */}
            {isAudioSuspended && (
              <button
                type="button"
                onClick={onActivateAudio}
                className="w-full mt-2.5 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-98 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer animate-pulse"
                title="Browser requires user interaction to enable audio. Click to activate."
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>Unmute / Activate Audio</span>
              </button>
            )}

            {/* Barge-in / Interrupt Button when AI is speaking */}
            {conversationState === 'SPEAKING' && (
              <button
                type="button"
                onClick={onInterrupt}
                className="w-full mt-2.5 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 active:scale-98 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer animate-pulse"
                title="Interrupt AI and speak"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Interrupt & Speak</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
