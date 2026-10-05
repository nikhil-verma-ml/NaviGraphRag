import React, { useState } from 'react';
import {
  User,
  Bot,
  Volume2,
  Square,
  Loader2,
  Mic,
  Keyboard,
  Zap,
  ChevronDown,
  ChevronUp,
  Coins,
  Gauge,
  Clock,
  Activity,
  BarChart3,
} from 'lucide-react';
import { ThinkingAccordion } from './ThinkingAccordion.js';
import { SourcesExpander } from './SourcesExpander.js';
import { LatencyMetricsDashboard } from './LatencyMetricsDashboard.js';
import { ChatMessage as ChatMessageType } from '../types.js';

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
  isPlayingAudio?: boolean;
  isLoadingAudio?: boolean;
  showThinkingSteps?: boolean;
  onPlayAudio?: (text: string, voice?: string) => void;
  onStopAudio?: () => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isStreaming = false,
  isPlayingAudio = false,
  isLoadingAudio = false,
  showThinkingSteps = true,
  onPlayAudio,
  onStopAudio,
}) => {
  const isUser = message.role === 'user';
  const isVoiceInput = message.inputType === 'voice';
  const [showLatencyDetails, setShowLatencyDetails] = useState(false);
  const [showVisualCharts, setShowVisualCharts] = useState(false);

  return (
    <div
      className={`flex gap-3 px-4 py-3.5 transition-all ${
        isUser
          ? 'bg-slate-50/80 rounded-xl border border-slate-200/80'
          : isPlayingAudio
          ? 'bg-white rounded-xl border border-blue-300 shadow-sm ring-2 ring-blue-500/10'
          : 'bg-white rounded-xl border border-slate-200 shadow-sm'
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-semibold ${
          isUser
            ? 'bg-slate-800 text-white shadow-xs'
            : 'bg-blue-600 text-white shadow-xs'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-900">
              {isUser ? 'You' : 'NaviGraph Agent'}
            </span>

            {/* Visual Input Method Indicator (Voice vs Text) */}
            {isUser && (
              isVoiceInput ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  <Mic className="w-3 h-3 text-blue-600" />
                  <span>Voice input</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-normal px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  <Keyboard className="w-3 h-3 text-slate-500" />
                  <span>Text input</span>
                </span>
              )
            )}

            {/* Speaking Status Indicator */}
            {!isUser && isPlayingAudio && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-blue-700 font-medium bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                Speaking answer...
              </span>
            )}
          </div>

          {/* Voice Playback Controls for Assistant */}
          {!isUser && !isStreaming && message.content && (
            <div className="flex items-center gap-1">
              {isPlayingAudio ? (
                <button
                  onClick={onStopAudio}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition-colors"
                  title="Stop speaking"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </button>
              ) : isLoadingAudio ? (
                <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-blue-600">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Loading voice...</span>
                </div>
              ) : (
                <button
                  onClick={() => onPlayAudio?.(message.content, message.audioVoice)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-600 hover:text-blue-700 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
                  title="Listen to this answer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Listen</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Thinking Accordion (for assistant messages) */}
        {!isUser && showThinkingSteps && message.thinkingSteps && message.thinkingSteps.length > 0 && (
          <ThinkingAccordion steps={message.thinkingSteps} isStreaming={isStreaming} />
        )}

        {/* Message content */}
        <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-600 animate-pulse align-middle" />
          )}
        </div>

        {/* Sources Expander (with Page Numbers & PDF Click-through) */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <SourcesExpander sources={message.sources} />
        )}

        {/* LLM Gateway & Latency Metrics Breakdown */}
        {!isUser && message.latency && !isStreaming && (
          <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500">
            {/* Clickable Header Badge */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button
                onClick={() => setShowLatencyDetails(!showLatencyDetails)}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-950 border border-slate-200 transition-colors font-mono text-[11px] group cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span className="font-semibold text-slate-900">
                  {message.latency.provider || 'Google Gemini Gateway'}
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-slate-600">{message.latency.model || 'gemini-3.8-flash'}</span>
                <span className="text-slate-300">•</span>
                <span className="font-semibold text-blue-600">
                  {message.latency.totalMs ? `${(message.latency.totalMs / 1000).toFixed(2)}s` : '0s'}
                </span>
                {message.latency.costFormatted && (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/80">
                      {message.latency.costFormatted}
                    </span>
                  </>
                )}
                {message.latency.tokensPerSec ? (
                  <>
                    <span className="text-slate-300">•</span>
                    <span className="text-indigo-600 font-semibold">{message.latency.tokensPerSec} tok/s</span>
                  </>
                ) : null}
                {showLatencyDetails ? (
                  <ChevronUp className="w-3.5 h-3.5 ml-1 text-slate-400 group-hover:text-slate-700" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 ml-1 text-slate-400 group-hover:text-slate-700" />
                )}
              </button>

              <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="uppercase font-semibold tracking-wider text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {message.latency.gatewayStatus || 'healthy'}
                </span>
              </div>
            </div>

            {/* Clean Professional LLM Metrics Table */}
            {showLatencyDetails && (
              <div className="mt-2.5 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-xs font-mono text-[11px]">
                {/* Table Header Bar */}
                <div className="bg-slate-50/90 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-blue-600" />
                    <span className="font-bold text-slate-800 text-xs">LLM Gateway Telemetry</span>
                    <span className="text-[10px] text-slate-400 font-normal">|</span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      Route: <span className="text-slate-800 font-semibold">{message.latency.provider}</span>
                    </span>
                  </div>

                  {/* Toggle Visual Charts using recharts */}
                  <button
                    onClick={() => setShowVisualCharts(!showVisualCharts)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-all cursor-pointer ${
                      showVisualCharts
                        ? 'bg-blue-600 text-white border-blue-600 shadow-2xs font-semibold'
                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    <span>{showVisualCharts ? 'Hide Visual Charts' : 'View Visual Charts'}</span>
                  </button>
                </div>

                {/* Optional Expanded Recharts Visual Performance Breakdown */}
                {showVisualCharts && (
                  <div className="p-3 border-b border-slate-200 bg-slate-50/40">
                    <LatencyMetricsDashboard
                      metrics={message.latency}
                      isOpen={true}
                    />
                  </div>
                )}

                {/* Structured Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100/70 text-[10px] uppercase text-slate-500 font-bold border-b border-slate-200 tracking-wider">
                        <th className="py-2 px-3.5">Category</th>
                        <th className="py-2 px-3.5">Metric Parameter</th>
                        <th className="py-2 px-3.5">Measured Value</th>
                        <th className="py-2 px-3.5">Notes & Unit Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[11px]">
                      {/* Latency Metrics */}
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td rowSpan={4} className="py-2.5 px-3.5 align-top font-bold text-blue-700 bg-blue-50/30 border-r border-slate-100">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-blue-600" />
                            <span>Latency</span>
                          </div>
                        </td>
                        <td className="py-2 px-3.5 text-slate-700">Time To First Token (TTFT)</td>
                        <td className="py-2 px-3.5 font-bold text-blue-600">{message.latency.llmFirstTokenMs || 0} ms</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">Initial stream latency</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-3.5 text-slate-700">LLM Generation Time</td>
                        <td className="py-2 px-3.5 font-semibold text-slate-800">{message.latency.llmTotalMs || 0} ms</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">Total token synthesis time</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-3.5 text-slate-700">Hybrid Retrieval & Reranker</td>
                        <td className="py-2 px-3.5 font-semibold text-slate-800">{message.latency.retrievalMs || 0} ms</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">Vector + BM25 + Cross-Encoder</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors bg-blue-50/10">
                        <td className="py-2 px-3.5 text-slate-900 font-semibold">Total Turnaround Latency</td>
                        <td className="py-2 px-3.5 font-bold text-blue-800 text-xs">{message.latency.totalMs || 0} ms</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">End-to-end request latency</td>
                      </tr>

                      {/* Token Usage Metrics */}
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td rowSpan={4} className="py-2.5 px-3.5 align-top font-bold text-purple-700 bg-purple-50/30 border-r border-slate-100">
                          <div className="flex items-center gap-1.5">
                            <Gauge className="w-3.5 h-3.5 text-purple-600" />
                            <span>Tokens</span>
                          </div>
                        </td>
                        <td className="py-2 px-3.5 text-slate-700">Prompt / Input Tokens</td>
                        <td className="py-2 px-3.5 font-semibold text-slate-800">{message.latency.promptTokens || 0}</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">Query & document context tokens</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-3.5 text-slate-700">Completion / Output Tokens</td>
                        <td className="py-2 px-3.5 font-semibold text-slate-800">{message.latency.completionTokens || 0}</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">Generated answer tokens</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors bg-purple-50/10">
                        <td className="py-2 px-3.5 text-slate-900 font-semibold">Total Billable Tokens</td>
                        <td className="py-2 px-3.5 font-bold text-purple-700 text-xs">{message.latency.totalTokens || 0}</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">Prompt + completion sum</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-3.5 text-slate-700">Generation Velocity</td>
                        <td className="py-2 px-3.5 font-bold text-indigo-600">{message.latency.tokensPerSec || 0} tok/s</td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">Throughput speed</td>
                      </tr>

                      {/* Cost Metrics */}
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td rowSpan={3} className="py-2.5 px-3.5 align-top font-bold text-emerald-800 bg-emerald-50/30 border-r border-slate-100">
                          <div className="flex items-center gap-1.5">
                            <Coins className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Cost</span>
                          </div>
                        </td>
                        <td className="py-2 px-3.5 text-slate-700">Prompt Tokens Cost</td>
                        <td className="py-2 px-3.5 font-mono text-slate-800">
                          ~${((message.latency.promptTokens || 0) * (0.075 / 1_000_000)).toFixed(6)}
                        </td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">$0.075 per 1M input tokens</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2 px-3.5 text-slate-700">Completion Tokens Cost</td>
                        <td className="py-2 px-3.5 font-mono text-slate-800">
                          ~${((message.latency.completionTokens || 0) * (0.30 / 1_000_000)).toFixed(6)}
                        </td>
                        <td className="py-2 px-3.5 text-slate-500 text-[10px]">$0.30 per 1M output tokens</td>
                      </tr>
                      <tr className="hover:bg-slate-50/80 transition-colors bg-emerald-50/30 font-semibold">
                        <td className="py-2 px-3.5 text-emerald-950 font-bold">Total Turn Estimated Cost</td>
                        <td className="py-2 px-3.5 font-bold text-emerald-700 text-xs">
                          {message.latency.costFormatted || (message.latency.costUsd ? `$${message.latency.costUsd.toFixed(6)}` : '$0.000000')}
                        </td>
                        <td className="py-2 px-3.5 text-emerald-800 font-medium text-[10px]">
                          Sub-cent ultra-low cost tier
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
