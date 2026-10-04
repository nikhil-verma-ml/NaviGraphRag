import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Loader2 } from 'lucide-react';

interface ThinkingAccordionProps {
  steps: string[];
  isStreaming?: boolean;
}

export const ThinkingAccordion: React.FC<ThinkingAccordionProps> = ({ steps, isStreaming = false }) => {
  const [isOpen, setIsOpen] = useState(isStreaming);

  if (!steps || steps.length === 0) return null;

  return (
    <div className="my-2 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 text-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between text-left text-slate-700 hover:bg-slate-100/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
          ) : (
            <Brain className="w-3.5 h-3.5 text-purple-600" />
          )}
          <span className="font-medium text-slate-800">
            {isStreaming ? '🤔 Agent thinking...' : '🧠 Agent steps'}
          </span>
          <span className="text-slate-500 text-[11px]">
            ({steps.length} {steps.length === 1 ? 'step' : 'steps'})
          </span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {isOpen && (
        <div className="px-3.5 py-2.5 bg-white border-t border-slate-200 space-y-1.5 font-mono">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2 text-slate-700 leading-relaxed text-[11.5px]">
              <span className="text-slate-400 select-none">•</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
