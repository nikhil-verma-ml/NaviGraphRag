export type VoiceConversationState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

export interface Source {
  type: string;
  content: string;
  source?: string;
  title?: string;
  pageNumber?: number;
  score?: number;
}

export interface LatencyMetrics {
  sttMs?: number;
  queryRewriteMs?: number;
  retrievalMs?: number;
  llmFirstTokenMs?: number;
  llmTotalMs?: number;
  ttsMs?: number;
  totalMs?: number;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokensPerSec?: number;
  costUsd?: number;
  costFormatted?: string;
  gatewayStatus?: 'healthy' | 'fallback_active' | 'offline_react';
  perTokenMs?: number;
  tokenLatencies?: number[];
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  thinkingSteps?: string[];
  audioVoice?: string;
  inputType?: 'voice' | 'text';
  latency?: LatencyMetrics;
}

export interface SessionInfo {
  thread_id: string;
  title: string;
  created_at: string;
  last_active_at: string;
}

export interface SessionListResponse {
  sessions: SessionInfo[];
}

export interface DocumentItem {
  source: string;
  chunkCount: number;
  pages: number[];
}

export interface ChatRequest {
  query: string;
  thread_id: string;
  fileFilter?: string;
  sttMs?: number;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  latency?: LatencyMetrics;
}
