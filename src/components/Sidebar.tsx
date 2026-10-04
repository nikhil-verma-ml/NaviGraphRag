import React, { useState, useRef } from 'react';
import { Plus, Trash2, Upload, FileText, CheckCircle2, AlertCircle, Loader2, MessageSquare, Filter, Layers } from 'lucide-react';
import { SessionInfo, DocumentItem } from '../types.js';

interface SidebarProps {
  sessions: SessionInfo[];
  activeThreadId: string;
  indexedDocuments: DocumentItem[];
  activeFileFilter: string;
  onSelectFileFilter: (filter: string) => void;
  onSelectSession: (threadId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (threadId: string) => void;
  onIngestSuccess: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeThreadId,
  indexedDocuments,
  activeFileFilter,
  onSelectFileFilter,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onIngestSuccess,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
      setUploadStatus(null);
    }
  };

  const handleIngest = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setUploadStatus(null);

    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append('files', file);
    }

    try {
      const resp = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      if (resp.ok) {
        const data = await resp.json();
        setUploadStatus({
          type: 'success',
          message: `Ingested ${data.details?.files_processed} file(s) into ${data.details?.chunks_created} chunks`,
        });
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
        onIngestSuccess();
      } else {
        setUploadStatus({ type: 'error', message: 'Ingestion failed' });
      }
    } catch {
      setUploadStatus({ type: 'error', message: 'Network error during ingestion' });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <aside className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col h-screen shrink-0 text-slate-800">
      {/* Sidebar Header */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-900">Conversations</h2>
        </div>

        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs shadow-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {sessions.length === 0 ? (
          <div className="p-3 text-xs text-slate-400 italic">No past conversations.</div>
        ) : (
          sessions.map((s) => {
            const isActive = s.thread_id === activeThreadId;
            return (
              <div
                key={s.thread_id}
                className={`group flex items-center gap-1 p-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-white border border-slate-300 shadow-xs'
                    : 'hover:bg-slate-200/60 border border-transparent'
                }`}
              >
                <button
                  onClick={() => onSelectSession(s.thread_id)}
                  className="flex-1 min-w-0 text-left px-2 py-1.5 text-xs text-slate-700 hover:text-slate-900 truncate flex items-center gap-1.5"
                  title={s.title}
                >
                  {isActive && <span className="text-blue-600 font-bold shrink-0">▶</span>}
                  <span className={`truncate ${isActive ? 'font-semibold text-slate-950' : ''}`}>
                    {s.title || s.thread_id}
                  </span>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.thread_id);
                  }}
                  className="p-1 text-slate-400 hover:text-red-600 opacity-60 group-hover:opacity-100 transition-opacity rounded hover:bg-slate-200/80"
                  title="Delete session"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Multi-PDF Document Filter Section */}
      <div className="p-3 border-t border-slate-200 bg-white space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <Filter className="w-3.5 h-3.5 text-blue-600" />
            <span>Filter by Document</span>
          </div>
          {activeFileFilter !== 'all' && (
            <button
              onClick={() => onSelectFileFilter('all')}
              className="text-[10px] text-blue-600 hover:underline"
            >
              Reset
            </button>
          )}
        </div>

        <select
          value={activeFileFilter}
          onChange={(e) => onSelectFileFilter(e.target.value)}
          className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-blue-500 font-medium cursor-pointer"
        >
          <option value="all">📁 All Documents ({indexedDocuments.length} indexed)</option>
          {indexedDocuments.map((doc, idx) => (
            <option key={idx} value={doc.source}>
              📄 {doc.source} ({doc.pages?.length ? `${doc.pages.length} pages` : `${doc.chunkCount} chunks`})
            </option>
          ))}
        </select>
      </div>

      {/* Document Ingestion Section */}
      <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-700" />
            <h3 className="text-xs font-semibold text-slate-800">Upload Documents</h3>
          </div>
          <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
            <Layers className="w-3 h-3" />
            <span>Multi-PDF</span>
          </div>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md"
            onChange={handleFileChange}
            className="w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-medium file:bg-white file:text-slate-800 hover:file:bg-slate-100 cursor-pointer"
          />
        </div>

        {selectedFiles.length > 0 && (
          <div className="text-[11px] text-slate-600 font-medium">
            Selected: <span className="text-slate-900">{selectedFiles.length} file(s)</span>
          </div>
        )}

        <button
          onClick={handleIngest}
          disabled={selectedFiles.length === 0 || isUploading}
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
            selectedFiles.length === 0 || isUploading
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-200'
              : 'bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 shadow-xs'
          }`}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
              <span>Parsing & Embedding...</span>
            </>
          ) : (
            <>
              <Upload className="w-3.5 h-3.5 text-slate-700" />
              <span>Ingest Files</span>
            </>
          )}
        </button>

        {uploadStatus && (
          <div
            className={`flex items-start gap-1.5 p-2 rounded text-[11px] leading-tight ${
              uploadStatus.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {uploadStatus.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-600 mt-0.5" />
            )}
            <span>{uploadStatus.message}</span>
          </div>
        )}
      </div>
    </aside>
  );
};
