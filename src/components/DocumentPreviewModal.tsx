import React, { useEffect, useState } from 'react';
import { X, FileText, ExternalLink, Loader2 } from 'lucide-react';
import { Source } from '../types.js';
import { apiUrl } from '../utils/api.js';

interface DocumentPreviewModalProps {
  source: Source | null;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ source, onClose }) => {
  const [docContent, setDocContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source || !source.source) return;

    const isPdf = source.source.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      // PDF is loaded directly via iframe
      setLoading(false);
      return;
    }

    // For non-pdf files (text, markdown, seed), fetch content
    setLoading(true);
    setError(null);
    fetch(apiUrl(`/api/documents/${encodeURIComponent(source.source)}/view`))
      .then((res) => {
        if (!res.ok) throw new Error('Document preview unavailable');
        return res.json();
      })
      .then((data) => {
        setDocContent(data.content || source.content);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('Doc preview fetch error:', err);
        setDocContent(source.content);
        setLoading(false);
      });
  }, [source]);

  if (!source) return null;

  const fileName = source.source || source.title || 'Document';
  const pageNum = source.pageNumber || 1;
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const pdfViewUrl = apiUrl(`/api/documents/${encodeURIComponent(fileName)}/view#page=${pageNum}`);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 truncate">
                {fileName}
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 text-[10px]">
                  Page {pageNum}
                </span>
                {source.score && (
                  <span className="text-[10px] text-slate-500">
                    Relevance score: {Math.round(source.score * 100)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isPdf && (
              <a
                href={pdfViewUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors text-xs flex items-center gap-1 font-medium"
                title="Open PDF in new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New tab</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-hidden relative bg-slate-100 flex flex-col">
          {isPdf ? (
            <iframe
              src={pdfViewUrl}
              className="w-full h-full border-0 bg-white"
              title={`Preview of ${fileName} page ${pageNum}`}
            />
          ) : loading ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span>Loading document page...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Highlighted Chunk Box */}
              <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 shadow-2xs">
                <div className="text-[11px] font-semibold text-blue-800 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <span>Matched Chunk on Page {pageNum}</span>
                </div>
                <div className="text-xs text-slate-800 font-mono leading-relaxed whitespace-pre-wrap">
                  {source.content}
                </div>
              </div>

              {/* Full Document / Page Context */}
              {docContent && docContent !== source.content && (
                <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Full Document Content
                  </div>
                  <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-sans">
                    {docContent}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
