import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Sparkles,
  Menu,
  X,
  Bot,
  AlertTriangle,
  Square,
  Volume2,
  VolumeX,
  Filter,
  Mic,
  Headphones,
  Radio,
  Activity,
} from 'lucide-react';
import { Sidebar } from './components/Sidebar.js';
import { ChatMessage } from './components/ChatMessage.js';
import { VoiceRecorderButton } from './components/VoiceRecorderButton.js';
import { VoiceConversationOverlay } from './components/VoiceConversationOverlay.js';
import { LatencyMetricsDashboard } from './components/LatencyMetricsDashboard.js';
import {
  ChatMessage as ChatMessageType,
  SessionInfo,
  Source,
  DocumentItem,
  LatencyMetrics,
  VoiceConversationState,
} from './types.js';
import { StreamingAudioQueue } from './utils/streamingAudioQueue.js';
import { useContinuousVoice } from './utils/useContinuousVoice.js';
import { extractVoiceSummary } from './utils/voiceSummary.js';
import { apiUrl } from './utils/api.js';

export function App() {
  const [threadId, setThreadId] = useState<string>(() => {
    return 'session_' + Math.random().toString(36).substring(2, 10);
  });

  // 1. Conversation & Streaming states (Explicitly satisfying user state requirements)
  const [conversation, setConversation] = useState<ChatMessageType[]>([]);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);

  // Chat-specific thinking steps and sources
  const [currentThinkingSteps, setCurrentThinkingSteps] = useState<string[]>([]);
  const [currentSources, setCurrentSources] = useState<Source[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Multi-PDF Document Filtering state
  const [indexedDocuments, setIndexedDocuments] = useState<DocumentItem[]>([]);
  const [activeFileFilter, setActiveFileFilter] = useState<string>('all');

  // Voice Conversation Mode (ChatGPT-like continuous real-time voice experience)
  const [voiceModeActive, setVoiceModeActive] = useState<boolean>(false);
  const [isVoiceMuted, setIsVoiceMuted] = useState<boolean>(false);
  const [speakAnswers, setSpeakAnswers] = useState<boolean>(true);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [latestLatency, setLatestLatency] = useState<LatencyMetrics | undefined>();
  const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState<boolean>(false);
  const [audioContextState, setAudioContextState] = useState<AudioContextState | 'unavailable' | 'unknown'>('unknown');
  const audioContextRef = useRef<AudioContext | null>(null);

  // Computed Conversation State: IDLE, LISTENING, THINKING, SPEAKING
  const conversationState: VoiceConversationState = isSpeaking
    ? 'SPEAKING'
    : isThinking
    ? 'THINKING'
    : isListening
    ? 'LISTENING'
    : voiceModeActive
    ? 'LISTENING'
    : 'IDLE';

  // Refs for audioQueue, abortController, and auto-scroll
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const warningTimeoutRef = useRef<any>(null);
  const audioQueueRef = useRef<StreamingAudioQueue | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Track if we need to auto-resume listening when speaking finishes
  const voiceModeActiveRef = useRef(voiceModeActive);
  voiceModeActiveRef.current = voiceModeActive;

  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // Show auto-dismissing warning
  const showWarning = (msg: string) => {
    setWarningMessage(msg);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
    warningTimeoutRef.current = setTimeout(() => {
      setWarningMessage(null);
    }, 6000);
  };

  // Barge-in: immediately stop TTS audio and cancel current in-flight LLM stream
  const handleBargeIn = useCallback(() => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {}
      abortControllerRef.current = null;
    }
    if (audioQueueRef.current) {
      audioQueueRef.current.stop();
    }
    setIsSpeaking(false);
    setIsStreaming(false);
    setIsThinking(false);

    // If in Voice Mode, return immediately to listening
    if (voiceModeActiveRef.current) {
      setIsListening(true);
    }
  }, []);

  // Stop audio manually
  const stopAudio = useCallback(() => {
    if (audioQueueRef.current) {
      audioQueueRef.current.stop();
    }
    setIsSpeaking(false);
  }, []);

  // Continuous Voice Hook (Handles VAD, microphone recording, barge-in speech detection)
  const continuousVoice = useContinuousVoice({
    isSpeaking,
    isThinking,
    onSpeechTranscribed: (text, sttMs) => {
      handleSend(text, 'voice', sttMs);
    },
    onBargeInDetected: () => {
      handleBargeIn();
    },
    onError: (errMsg) => {
      showWarning(errMsg);
      // If permission is blocked/denied, stop continuous voice mode to prevent retry loops
      if (
        errMsg.toLowerCase().includes('blocked') ||
        errMsg.toLowerCase().includes('denied') ||
        errMsg.toLowerCase().includes('permission')
      ) {
        setVoiceModeActive(false);
        continuousVoice.stopListening();
        return;
      }
      // If voice mode is active and listening had an issue, reset
      if (voiceModeActiveRef.current && !isStreamingRef.current) {
        setTimeout(() => {
          if (voiceModeActiveRef.current && !isStreamingRef.current) {
            continuousVoice.startListening();
            setIsListening(true);
          }
        }, 1200);
      }
    },
  });

  // Keep isListening synced
  useEffect(() => {
    setIsListening(continuousVoice.isListening);
  }, [continuousVoice.isListening]);

  // Ref-backed stable callbacks for StreamingAudioQueue so the queue is NEVER torn down on re-renders
  const continuousVoiceRef = useRef(continuousVoice);
  continuousVoiceRef.current = continuousVoice;

  const onPlayStateChangeRef = useRef<(playing: boolean) => void>(() => {});
  onPlayStateChangeRef.current = (playing) => {
    setIsSpeaking(playing);
  };

  const onFirstChunkLatencyRef = useRef<(ttsMs: number) => void>(() => {});
  onFirstChunkLatencyRef.current = (ttsMs) => {
    setConversation((prev) => {
      if (prev.length === 0) return prev;
      const lastIdx = prev.length - 1;
      if (prev[lastIdx].role === 'assistant') {
        const updated = [...prev];
        updated[lastIdx] = {
          ...updated[lastIdx],
          latency: {
            ...(updated[lastIdx].latency || {}),
            ttsMs,
          },
        };
        return updated;
      }
      return prev;
    });
  };

  const onQueueEmptyRef = useRef<() => void>(() => {});
  onQueueEmptyRef.current = () => {
    setIsSpeaking(false);
    if (voiceModeActiveRef.current && !isStreamingRef.current) {
      // Auto continuous conversation: return to listening mode!
      setIsListening(true);
      continuousVoiceRef.current.startListening();
    }
  };

  // Initialize StreamingAudioQueue ONCE on mount with empty dependency array []
  // This guarantees queue is never destroyed mid-flight on component state updates or token emissions!
  useEffect(() => {
    console.log('[App] Initializing singleton StreamingAudioQueue instance on mount...');
    const queue = new StreamingAudioQueue(
      (playing) => onPlayStateChangeRef.current(playing),
      (ttsMs) => onFirstChunkLatencyRef.current(ttsMs),
      () => onQueueEmptyRef.current()
    );

    if (audioContextRef.current) {
      queue.setAudioContext(audioContextRef.current);
    }
    audioQueueRef.current = queue;

    return () => {
      console.log('[App] Component unmounting: stopping audio queue.');
      queue.stop();
    };
  }, []);

  // Initialize Web Audio API context & event listener with explicit logging
  useEffect(() => {
    console.log('[Web Audio API in App.tsx] Initializing AudioContext...');
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        console.log('[Web Audio API in App.tsx] AudioContext successfully initialized:', {
          state: ctx.state,
          sampleRate: ctx.sampleRate,
          baseLatency: ctx.baseLatency,
          isSuspended: ctx.state === 'suspended',
        });
        setAudioContextState(ctx.state);

        ctx.onstatechange = () => {
          console.log('[Web Audio API in App.tsx] AudioContext.onstatechange event:', {
            previousState: audioContextState,
            newState: ctx.state,
          });
          setAudioContextState(ctx.state);
        };

        if (audioQueueRef.current) {
          audioQueueRef.current.setAudioContext(ctx);
        }
      } catch (err) {
        console.error('[Web Audio API in App.tsx] Error instantiating AudioContext:', err);
        setAudioContextState('unavailable');
      }
    } else {
      console.warn('[Web Audio API in App.tsx] Web Audio API not supported in this browser.');
      setAudioContextState('unavailable');
    }

    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        console.log('[Web Audio API in App.tsx] Closing AudioContext on unmount.');
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Explicitly resume AudioContext on user gesture (Unmute / Activate Audio button)
  const handleActivateAudio = async () => {
    console.log('[App.tsx] "Unmute/Activate Audio" primary user gesture triggered.');
    try {
      if (audioContextRef.current) {
        console.log('[App.tsx] Calling audioContext.resume(). Previous state was:', audioContextRef.current.state);
        await audioContextRef.current.resume();
        console.log('[App.tsx] audioContext.resume() completed successfully. Updated state is:', audioContextRef.current.state);
        setAudioContextState(audioContextRef.current.state);
      }
      if (audioQueueRef.current) {
        const nextState = await audioQueueRef.current.resumeAudioContext();
        console.log('[App.tsx] audioQueue.resumeAudioContext() returned state:', nextState);
        if (nextState !== 'unavailable') {
          setAudioContextState(nextState);
        }
      }
    } catch (err) {
      console.error('[App.tsx] Error resuming audio context on user gesture:', err);
    }
  };

  // Toggle Continuous Voice Mode (ChatGPT-style voice experience)
  const toggleVoiceMode = () => {
    if (voiceModeActive) {
      // Exit voice mode
      setVoiceModeActive(false);
      continuousVoice.stopListening();
      stopAudio();
    } else {
      // Direct user gesture: unlock browser audio context & speech synthesis
      try {
        audioQueueRef.current?.unlockAudio();
      } catch {}

      // Enter voice mode: automatically activate microphone and start listening
      setVoiceModeActive(true);
      setSpeakAnswers(true);
      setIsThinking(false);
      setIsSpeaking(false);
      continuousVoice.startListening();
    }
  };

  // Toggle speak answers globally
  const toggleSpeakAnswers = () => {
    setSpeakAnswers((prev) => {
      const next = !prev;
      if (!next) {
        stopAudio();
      }
      return next;
    });
  };

  // Play whole message on demand (when user clicks "Listen" on any bubble)
  const playSpeechForText = async (text: string, voice?: string) => {
    stopAudio();
    if (!audioQueueRef.current) return;
    audioQueueRef.current.reset();
    const speechText = extractVoiceSummary(text);
    await audioQueueRef.current.enqueueSentence(speechText, voice);
  };

  // Fetch session list
  const loadSessions = async () => {
    try {
      const resp = await fetch(apiUrl('/sessions'));
      if (resp.ok) {
        const data = await resp.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.warn('Could not load sessions:', err);
    }
  };

  // Fetch indexed documents list for Multi-PDF support
  const loadDocuments = async () => {
    try {
      const resp = await fetch(apiUrl('/api/documents'));
      if (resp.ok) {
        const data = await resp.json();
        setIndexedDocuments(data.documents || []);
      }
    } catch (err) {
      console.warn('Could not load documents:', err);
    }
  };

  // Load messages for a given thread
  const loadThreadMessages = async (tid: string) => {
    stopAudio();
    setThreadId(tid);
    try {
      const resp = await fetch(apiUrl(`/sessions/${tid}/messages`));
      if (resp.ok) {
        const data = await resp.json();
        const mapped = (data.messages || []).map((m: any, idx: number) => ({
          ...m,
          id: `msg_hist_${idx}_${Date.now()}`,
          inputType: m.inputType || 'text',
        }));
        setConversation(mapped);
      } else {
        setConversation([]);
      }
    } catch {
      setConversation([]);
    }
  };

  useEffect(() => {
    loadSessions();
    loadDocuments();
  }, []);

  // Smooth auto-scroll on new tokens or messages without jumping
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [conversation, currentAssistantMessage, currentThinkingSteps]);

  // Start new conversation
  const handleNewSession = () => {
    stopAudio();
    const newId = 'session_' + Math.random().toString(36).substring(2, 10);
    setThreadId(newId);
    setConversation([]);
    setCurrentAssistantMessage('');
    setCurrentThinkingSteps([]);
    setCurrentSources([]);
  };

  // Delete session
  const handleDeleteSession = async (tid: string) => {
    try {
      await fetch(apiUrl(`/sessions/${tid}`), { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.thread_id !== tid));
      if (threadId === tid) {
        handleNewSession();
      }
    } catch (err) {
      console.warn('Failed to delete session:', err);
    }
  };

  /**
   * Main Send / Streaming handler:
   * Progressive token-by-token rendering, streaming sentence-level TTS,
   * thinking steps, and latency instrumentation.
   */
  const handleSend = async (
    queryText?: string,
    inputMode: 'text' | 'voice' = 'text',
    sttMs?: number
  ) => {
    const query = (queryText || inputQuery).trim();
    if (!query) return;

    setInputQuery('');

    // Pre-unlock audio so browser autoplay policy does not block TTS playback
    try {
      audioQueueRef.current?.unlockAudio();
    } catch {}

    // Barge-in: interrupt any speaking audio and previous requests
    stopAudio();
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {}
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    if (audioQueueRef.current) {
      audioQueueRef.current.reset();
    }

    // Stop continuous microphone while thinking & speaking
    continuousVoice.stopListening();

    // Append user message with inputType indicator tag
    const userMsg: ChatMessageType = {
      id: 'usr_' + Date.now(),
      role: 'user',
      content: query,
      inputType: inputMode,
    };
    setConversation((prev) => [...prev, userMsg]);

    // Transition to THINKING state
    setIsThinking(true);
    setIsStreaming(true);
    setCurrentThinkingSteps([]);
    setCurrentAssistantMessage('');
    setCurrentSources([]);

    let answerAccumulator = '';
    let voiceSummaryAccumulator = '';
    let sourcesAccumulator: Source[] = [];
    let latencyAccumulator: LatencyMetrics | undefined;
    const stepsAccumulator: string[] = [];

    try {
      const response = await fetch(apiUrl('/chat/stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          thread_id: threadId,
          fileFilter: activeFileFilter,
          sttMs,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server returned ${response.status}`);
      }

      // Read stream chunk by chunk
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;
          let eventType = 'message';
          let dataText = '';

          const subLines = block.split('\n');
          for (const line of subLines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataText = line.slice(5).trim();
            }
          }

          if (dataText) {
            try {
              const payload = JSON.parse(dataText);

              if (eventType === 'thinking') {
                stepsAccumulator.push(payload.text);
                setCurrentThinkingSteps([...stepsAccumulator]);
              } else if (eventType === 'token') {
                const token = payload.text || '';
                answerAccumulator += token;

                // IMMEDIATELY update current assistant message so complete LLM answer streams progressively!
                setCurrentAssistantMessage(answerAccumulator);

                // Switch from THINKING state as soon as tokens arrive
                setIsThinking(false);
              } else if (eventType === 'voice_summary') {
                // Short natural 1-3 sentence spoken summary specifically for TTS
                voiceSummaryAccumulator = payload.summary || '';
                console.log('[Voice summary received]', voiceSummaryAccumulator);

                if (
                  speakAnswers &&
                  audioQueueRef.current &&
                  audioQueueRef.current.canEnqueueMore()
                ) {
                  audioQueueRef.current.enqueueSentence(voiceSummaryAccumulator);
                }
              } else if (eventType === 'sources') {
                sourcesAccumulator = payload;
                setCurrentSources(sourcesAccumulator);
              } else if (eventType === 'latency') {
                latencyAccumulator = payload;
                setLatestLatency(payload);
              }
            } catch (jsonErr) {
              console.warn('JSON parse error for SSE:', jsonErr);
            }
          }
        }
      }

      const finalContent = answerAccumulator.trim()
        ? answerAccumulator
        : sourcesAccumulator.length > 0
        ? 'Here is a summary based on the retrieved documents:\n\n' +
          sourcesAccumulator
            .map((s, idx) => `• **${s.source}** (Page ${s.pageNumber || 1}): ${s.content}`)
            .join('\n\n')
        : 'I completed processing the query.';

      // Extract or retrieve the concise 1-3 sentence voice summary
      const finalVoiceSummary =
        voiceSummaryAccumulator.trim() || extractVoiceSummary(finalContent);

      // If speech is enabled and nothing has been spoken yet, speak the voice summary
      if (
        speakAnswers &&
        audioQueueRef.current &&
        audioQueueRef.current.getEnqueuedCount() === 0
      ) {
        audioQueueRef.current.enqueueSentence(finalVoiceSummary);
      }

      // Finalize assistant message in conversation history with BOTH representations:
      // content: full complete LLM answer for chat UI
      // voiceSummary: short natural summary for TTS audio
      const assistantMsgId = 'asst_' + Date.now();
      const finalAssistantMsg: ChatMessageType = {
        id: assistantMsgId,
        role: 'assistant',
        content: finalContent, // fullAnswer → chat
        voiceSummary: finalVoiceSummary, // voiceSummary → TTS
        sources: sourcesAccumulator,
        thinkingSteps: [...stepsAccumulator],
        latency: latencyAccumulator,
      };

      setConversation((prev) => [...prev, finalAssistantMsg]);
      loadSessions();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Stream aborted by user barge-in; do nothing
        return;
      }
      console.error('Chat stream error:', err);
      const errMsgId = 'err_' + Date.now();
      setConversation((prev) => [
        ...prev,
        {
          id: errMsgId,
          role: 'assistant',
          content: `An error occurred: ${err.message || 'Stream connection failed'}.`,
          thinkingSteps: stepsAccumulator,
        },
      ]);
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
      setCurrentAssistantMessage('');
      setCurrentThinkingSteps([]);
      setCurrentSources([]);

      // If voice mode is active and no audio is speaking or pending, resume listening safely
      setTimeout(() => {
        if (
          voiceModeActiveRef.current &&
          !audioQueueRef.current?.isSpeaking() &&
          !isStreamingRef.current
        ) {
          setIsListening(true);
          continuousVoice.startListening();
        }
      }, 1200);
    }
  };

  const samplePrompts = [
    'Summarize the uploaded documents',
    'How does hybrid retrieval combine search methods?',
    'Explain the reasoning process',
    'What sources were used to answer?',
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar with Multi-PDF Selection */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform md:relative md:translate-x-0 transition-transform duration-200 ease-in-out ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          sessions={sessions}
          activeThreadId={threadId}
          indexedDocuments={indexedDocuments}
          activeFileFilter={activeFileFilter}
          onSelectFileFilter={setActiveFileFilter}
          onSelectSession={(tid) => {
            loadThreadMessages(tid);
            setIsSidebarOpen(false);
          }}
          onNewSession={() => {
            handleNewSession();
            setIsSidebarOpen(false);
          }}
          onDeleteSession={handleDeleteSession}
          onIngestSuccess={() => {
            loadSessions();
            loadDocuments();
          }}
        />
      </div>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 h-screen bg-slate-50/40">
        {/* Top Navbar */}
        <header className="h-14 border-b border-slate-200 px-4 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 md:hidden transition-colors"
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
                🤖
              </div>
              <h1 className="text-base font-semibold text-slate-900 tracking-tight">
                NaviGraph
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600">
            {/* Live Audio Indicator & Interrupt Button */}
            {isSpeaking && (
              <button
                type="button"
                onClick={handleBargeIn}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors shadow-xs"
                title="Stop audio playback (Barge-in)"
              >
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <Square className="w-3 h-3 fill-current" />
                <span className="hidden sm:inline">Interrupt</span>
              </button>
            )}

            {/* Live LLM Performance Dashboard Trigger Button */}
            {latestLatency && (
              <button
                type="button"
                onClick={() => setIsPerformanceModalOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-mono transition-colors shadow-2xs cursor-pointer"
                title="Open LLM Gateway Performance Dashboard"
              >
                <Activity className="w-3.5 h-3.5 text-blue-600" />
                <span className="font-semibold text-slate-800">
                  TTFT: {latestLatency.llmFirstTokenMs || 0}ms
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-indigo-600 font-semibold">
                  {latestLatency.tokensPerSec || 0} tok/s
                </span>
              </button>
            )}

            {/* Visual Unmute / Activate Audio button if AudioContext is suspended */}
            {audioContextState === 'suspended' && (
              <button
                type="button"
                onClick={handleActivateAudio}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-lg text-xs font-semibold shadow-xs transition-all animate-pulse cursor-pointer"
                title="Browser suspended audio autoplay. Click to unmute and activate audio context"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>Unmute / Activate Audio</span>
              </button>
            )}

            {/* Quick Header Voice Mode Launcher */}
            <button
              type="button"
              onClick={toggleVoiceMode}
              className={`p-1.5 rounded-lg border transition-colors ${
                voiceModeActive
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-slate-100 border-slate-200'
              }`}
              title="Launch Voice Mode"
            >
              <Headphones className="w-4 h-4" />
            </button>

            <span className="font-mono bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200 truncate max-w-[120px] sm:max-w-xs text-slate-700">
              {threadId}
            </span>
          </div>
        </header>

        {/* Warning Toast Banner */}
        {warningMessage && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{warningMessage}</span>
            </div>
            <button
              onClick={() => setWarningMessage(null)}
              className="p-1 hover:bg-amber-100 rounded text-amber-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Document Filter Notification Banner */}
        {activeFileFilter !== 'all' && (
          <div className="mx-4 mt-2 px-3 py-1.5 rounded-lg bg-blue-50/80 border border-blue-200 text-blue-800 text-xs flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-blue-600" />
              <span>
                Search scoped to document:{' '}
                <strong className="font-semibold">{activeFileFilter}</strong>
              </span>
            </div>
            <button
              onClick={() => setActiveFileFilter('all')}
              className="text-[11px] font-semibold text-blue-700 hover:underline"
            >
              Clear filter
            </button>
          </div>
        )}

        {/* Conversation Stream (Chat Transcript) */}
        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 max-w-4xl w-full mx-auto"
        >
          {conversation.length === 0 && !isStreaming && (
            <div className="py-12 sm:py-16 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center">
                <Bot className="w-6 h-6 text-blue-600" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-slate-900 tracking-tight">
                  Welcome to NaviGraph
                </h2>
                <p className="text-xs text-slate-500">
                  Ask a question by typing or start Voice Mode for a real-time conversational experience.
                </p>
              </div>

              {/* Sample Prompts */}
              <div className="pt-4 max-w-lg mx-auto text-left space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {samplePrompts.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(p, 'text')}
                      className="p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 text-left text-xs text-slate-700 transition-all flex items-start gap-2 shadow-xs group"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <span className="leading-snug">{p}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Render historical messages */}
          {conversation.map((msg, index) => (
            <ChatMessage
              key={msg.id || index}
              message={msg}
              showThinkingSteps={true}
              isPlayingAudio={isSpeaking}
              onPlayAudio={(text, voice) =>
                playSpeechForText(msg.voiceSummary || text, voice || msg.audioVoice)
              }
              onStopAudio={stopAudio}
            />
          ))}

          {/* Live Streaming Assistant Message (Tokens appear progressively) */}
          {isStreaming && (
            <ChatMessage
              message={{
                role: 'assistant',
                content: currentAssistantMessage,
                thinkingSteps: currentThinkingSteps,
                sources: currentSources,
              }}
              showThinkingSteps={true}
              isStreaming={true}
            />
          )}
        </div>

        {/* ChatGPT-like Voice Conversation Overlay (LISTENING / THINKING / SPEAKING states) */}
        <VoiceConversationOverlay
          conversationState={conversationState}
          currentAssistantMessage={currentAssistantMessage}
          latestThinkingStep={currentThinkingSteps[currentThinkingSteps.length - 1]}
          isAudioSpeaking={isSpeaking}
          onInterrupt={handleBargeIn}
          onExitVoiceMode={() => {
            setVoiceModeActive(false);
            continuousVoice.stopListening();
            stopAudio();
          }}
          onToggleMute={() => setIsVoiceMuted(!isVoiceMuted)}
          isMuted={isVoiceMuted}
          audioLevel={continuousVoice.audioLevel}
          audioElement={null}
          speechAnalyser={audioQueueRef.current?.getAnalyserNode()}
          micAnalyser={continuousVoice.micAnalyser}
          llmMetrics={latestLatency}
          isAudioSuspended={audioContextState === 'suspended'}
          onActivateAudio={handleActivateAudio}
        />

        {/* Input Bar with VAD Voice & Typed Input */}
        <div className="p-4 border-t border-slate-200 bg-white shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                audioQueueRef.current?.unlockAudio();
              } catch {}
              handleSend(undefined, 'text');
            }}
            className="max-w-4xl mx-auto flex items-center gap-2"
          >
            {/* Quick Voice Mode Launcher Button */}
            <button
              type="button"
              onClick={toggleVoiceMode}
              className={`p-2 rounded-xl border transition-all ${
                voiceModeActive
                  ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-300'
                  : 'bg-slate-100 text-slate-600 hover:text-blue-600 hover:bg-blue-50 border-slate-200'
              }`}
              title="Toggle real-time Voice Mode"
            >
              <Headphones className="w-4 h-4" />
            </button>

            {/* Push-to-Talk / VAD Microphone Button */}
            <VoiceRecorderButton
              onRecordingStart={() => {
                try {
                  audioQueueRef.current?.unlockAudio();
                } catch {}
                stopAudio();
              }}
              onTranscriptionComplete={(transcribedText, sttMs) => {
                handleSend(transcribedText, 'voice', sttMs);
              }}
              onError={(err) => showWarning(err)}
              disabled={isStreaming}
            />

            {/* Text Input */}
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder={
                isStreaming
                  ? 'NaviGraph is answering...'
                  : voiceModeActive
                  ? 'Voice Mode is active — speak or type a question...'
                  : 'Ask anything about your documents, knowledge, or architecture...'
              }
              disabled={isStreaming}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all disabled:opacity-60"
            />

            {/* Send Button */}
            <button
              type="submit"
              disabled={!inputQuery.trim() || isStreaming}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 text-white transition-colors shadow-xs"
              title="Send Message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </main>

      {/* Advanced LLM Performance Monitor Modal */}
      {isPerformanceModalOpen && latestLatency && (
        <LatencyMetricsDashboard
          metrics={latestLatency}
          isOpen={isPerformanceModalOpen}
          onClose={() => setIsPerformanceModalOpen(false)}
          isModal={true}
        />
      )}
    </div>
  );
}
