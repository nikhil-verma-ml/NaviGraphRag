import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Globe, ExternalLink, Eye } from 'lucide-react';
import { Source } from '../types.js';
import { DocumentPreviewModal } from './DocumentPreviewModal.js';

interface SourcesExpanderProps {
  sources: Source[];
}

export const SourcesExpander: React.FC<SourcesExpanderProps> = ({ sources }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [previewSource, setPreviewSource] = useState<Source | null>(null);

  if (!sources || sources.length === 0) return null;

  return (
    <>
      <div className="mt-2.5 border border-slate-200 rounded-xl overflow-hidden bg-slate-50/70 text-xs shadow-2xs">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-3.5 py-2 flex items-center justify-between text-left text-slate-700 hover:bg-slate-100/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            <span className="font-semibold text-slate-800">
              Sources ({sources.length} referenced)
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <span className="text-[11px] hidden sm:inline text-slate-500">
              {isOpen ? 'Collapse' : 'View chunks & pages'}
            </span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </div>
        </button>

        {isOpen && (
          <div className="px-3.5 py-2.5 bg-white border-t border-slate-200 space-y-2.5">
            {sources.map((src, idx) => {
              const isWeb = src.type === 'web_search';
              const sourceTitle = src.title || src.source || (isWeb ? 'Web Source' : 'Document');
              const pageNum = src.pageNumber;
              const scorePct = src.score ? Math.round(src.score * 100) : null;

              return (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 text-slate-700 space-y-1.5 transition-all hover:border-slate-300 hover:bg-slate-50"
                >
                  {/* Top metadata line */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold text-xs text-slate-900 truncate">
                        {isWeb ? (
                          <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        )}
                        <span className="truncate">{sourceTitle}</span>
                      </div>

                      {/* Page Number Badge */}
                      {!isWeb && pageNum !== undefined && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          Page {pageNum}
                        </span>
                      )}

                      {/* Rerank / Similarity Score */}
                      {scorePct !== null && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          Match: {scorePct}%
                        </span>
                      )}
                    </div>

                    {/* Action button: Click-through to PDF page or Open Web URL */}
                    <div>
                      {isWeb && src.source && src.source.startsWith('http') ? (
                        <a
                          href={src.source}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          <span>Visit link</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPreviewSource(src)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors shadow-2xs"
                          title="Open document centered on this page"
                        >
                          <Eye className="w-3 h-3" />
                          <span>View Page {pageNum || 1}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Matching Chunk Excerpt */}
                  <p className="text-slate-600 text-[11px] leading-relaxed line-clamp-3 font-mono bg-white p-2 rounded-lg border border-slate-200/80">
                    {src.content}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Document Page Preview Modal */}
      {previewSource && (
        <DocumentPreviewModal source={previewSource} onClose={() => setPreviewSource(null)} />
      )}
    </>
  );
};
