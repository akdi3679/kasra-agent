'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Square, Paperclip, X, Search } from 'lucide-react';
import { StatusBar } from './StatusBar';
import { useAgentEvents } from '@/hooks/useAgentEvents';

import { SlashCommandPanel } from './SlashCommandPanel';

interface FilePill {
  id: string;
  fileName: string;
  filePath: string;
  extractedText: string;
  status: 'ok' | 'error' | 'loading';
}

function isErrorContent(text: string): boolean {
  if (!text || text.startsWith('❌')) return true;
  try {
    const obj = JSON.parse(text);
    return !!obj.error;   // if the OCR returned an error object, treat as failure
  } catch {
    return false;         // not JSON → real text
  }
}
const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  get_inventory: 'Inventory',
  get_sales_data: 'Sales',
  db_update: 'Update Stock',
  web_search: 'Web Search',
  browse_web: 'Browse',
  read_local_file: 'Read File',
  list_local_directory: 'List Files',
  export_excel: 'Excel',
  generate_pdf: 'PDF',
  create_ical_event: 'Calendar',
  to_table: 'Table',
  to_html: 'Chart',
  execute_python: 'Python',
  send_email: 'Email',
  schedule_task: 'Cron',
  list_crons: 'Cron List',
  pause_cron: 'Pause',
  resume_cron: 'Resume',
  stop_cron: 'Stop',
  delete_cron: 'Delete',
  update_cron: 'Edit Cron',
  manage_skill: 'Manage Skill',
  save_to_memory: 'Save',
  search_memory: 'Search',
  to_text_table: 'Text Table',
  ocr_extract: 'OCR',
  find_file: 'Find File',
  live_screen: 'Screenshot',
  browser_control: 'Browser',
  desktop_control: 'Desktop',
  analyze_project: 'Analyze',
  gitlab_create_issue: 'GitLab Issue',
  gitlab_search_merge_requests: 'GitLab MR',
  fivetran_sync_data: 'Fivetran',
  elastic_search_logs: 'Elastic',
  dynatrace_get_metrics: 'Dynatrace',
  reload_plugins: 'Reload Plugins',
};

function friendlyToolName(raw: string): string {
  return TOOL_FRIENDLY_NAMES[raw] || raw.replace(/_/g, ' ');
}
// ── FIX: onRun now receives two strings:
//   displayGoal  — shown in the chat bubble (clean, no OCR dump)
//   combinedGoal — sent to the AI (goal + file content embedded)
export function InputArea({
   onRun,
  blobState,
  statusMessage,
  currentTool,
}: {
  onRun: (displayGoal: string, combinedGoal: string, preferredModel?: string | null, preferredTool?: string | null) => Promise<void>;
  blobState: string;
  statusMessage: string;
  currentTool: string;
}) {
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<FilePill[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
const [slashQuery, setSlashQuery] = useState('');
const [selectedModel, setSelectedModel] = useState<string | null>(null);
const [selectedTool, setSelectedTool] = useState<string | null>(null);
const [activeTag, setActiveTag] = useState<{ type: 'model' | 'tool'; value: string } | null>(null);
  const isWorking = loading || blobState === 'thinking' || blobState === 'using_tools';
const [aiFileNotification, setAiFileNotification] = useState<{ fileName: string } | null>(null);
  const [toolFriendlyMap, setToolFriendlyMap] = useState<Record<string, string>>({});

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const maxHeight = 120;
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, maxHeight) + 'px';
      textareaRef.current.style.overflowY =
        textareaRef.current.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [goal]);
useEffect(() => {
  fetch('${process.env.NEXT_PUBLIC_API_URL}/api/tools-list')
    .then(r => r.json())
    .then((data: { name: string; friendly: string }[]) => {
      const map: Record<string, string> = {};
      data.forEach(t => { map[t.name] = t.friendly; });
      setToolFriendlyMap(map);
    })
    .catch(() => {});
}, []);
  // ── File upload handler ────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    for (const file of Array.from(selectedFiles)) {
      // Add a loading pill immediately so the user sees progress
      const tempId = `loading_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      setFiles(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        filePath: '',
        extractedText: '',
        status: 'loading',
      }]);

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('${process.env.NEXT_PUBLIC_API_URL}/api/ocr', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();

        setFiles(prev => prev.map(f => {
  if (f.id !== tempId) return f;

  // ✅ file extracted correctly?
  if (data.success && data.extractedText && !isErrorContent(data.extractedText)) {
    return {
      id: tempId,
      fileName: data.fileName || file.name,
      filePath: data.filePath || '',
      extractedText: data.extractedText,
      status: 'ok' as const,
    };
  }

  // ❌ extraction failed → show error pill, then remove it
  return {
    ...f,
    fileName: `⚠️ ${data.fileName || file.name}`,
    status: 'error' as const,
  };
}));
        // Auto-remove error pills after 4 seconds
        if (!data.success || isErrorContent(data.extractedText || '')) {
  setTimeout(() => setFiles(prev => prev.filter(f => f.id !== tempId)), 4000);
}
      } catch (err) {
        console.error('Upload failed:', err);
        setFiles(prev => prev.filter(f => f.id !== tempId));
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

const handleGoalChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const value = e.target.value;
  setGoal(value);
  
  if (value.startsWith('/')) {
    setSlashQuery(value);
  } else {
    setSlashQuery('');
  }
};
const handleSelectModel = (modelId: string) => {
  if (modelId === '__select__') {
    // User clicked /model command → switch to model listing
    setSlashQuery('/model');
    return;
  }
  // User picked a specific model
  setSelectedModel(modelId);
  setActiveTag({ type: 'model', value: modelId });
  setGoal('');
  setSlashQuery('');
};

const handleSelectTool = (toolName: string) => {
  if (toolName === '__select__') {
    setSlashQuery('/tool');
    return;
  }
  setSelectedTool(toolName);
  setActiveTag({ type: 'tool', value: toolName });
  setGoal('');
  setSlashQuery('');
};
  // ── Submit ─────────────────────────────────────────────────────────────────
const submit = async () => {
  if ((!goal.trim() && files.length === 0) || loading) return;

  setLoading(true);
  try {
    let displayGoal = goal.trim() || `Analyse ${files.map(f => f.fileName).join(', ')}`;
    let combinedGoal = displayGoal;

    // ── Extract the selected tool reliably ────────────────────────
    const currentTool =
      selectedTool ||                              // from slash panel
      (activeTag?.type === 'tool' ? activeTag.value : null);  // from active chip

    const currentModel =
      selectedModel ||                             // from slash panel
      (activeTag?.type === 'model' ? activeTag.value : null); // from active chip

    // ── Update display goal with friendly name ───────────────────
    if (currentTool) {
      const friendly = toolFriendlyMap[currentTool] || currentTool;
      displayGoal = `[${friendly}] ${displayGoal}`;
    }

    // ── Attach uploaded file content ─────────────────────────────
    const okFiles = files.filter(f => f.status === 'ok' && f.extractedText);
    if (okFiles.length > 0) {
      const fileBlock = okFiles
        .map((f, i) =>
          `[ATTACHED FILE ${i + 1}: ${f.fileName}]\n` +
          `--- BEGIN CONTENT ---\n${f.extractedText.slice(0, 6000)}\n--- END CONTENT ---`
        )
        .join('\n\n');
      combinedGoal = `${combinedGoal}\n\n` +
        `[CONTEXT: The user has uploaded ${okFiles.length} file(s). ` +
        `Answer the user's question using this content directly — ` +
        `do NOT call read_local_file or ocr_extract for these files.]\n\n` +
        fileBlock;
    }

    // ── Pass model & tool as separate parameters ─────────────────
    await onRun(displayGoal, combinedGoal, currentModel, currentTool);
    setGoal('');
    setFiles([]);
    setActiveTag(null);
    setSelectedModel(null);
    setSelectedTool(null);
  } catch (error) {
    console.error(error);
  } finally {
    setLoading(false);
  }
};

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // ── AI-injected files (from SSE file_inject events) ───────────────────────
  const addFileFromAI = useCallback(
  (fileName: string, filePath: string, extractedText: string) => {
    setFiles(prev => {
      // Prevent duplicate pills with the same filePath
      if (prev.some(f => f.filePath === filePath)) return prev;
      return [
        ...prev,
        {
          id: `aifile_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          fileName: `🤖 ${fileName}`,
          filePath,
          extractedText,
          status: 'ok' as const,
        },
      ];
    });
    setAiFileNotification({ fileName });
    setTimeout(() => setAiFileNotification(null), 4000);
  },
  []
);

  useEffect(() => {
    (window as any).__KasraAddFile = addFileFromAI;
    return () => { delete (window as any).__KasraAddFile; };
  }, [addFileFromAI]);

  const okCount = files.filter(f => f.status === 'ok').length;
  const hasFiles = okCount > 0;

  return (
    <div className="w-full max-w-md mx-auto px-4 pt-2 pb-4">
      <StatusBar blobState={blobState} statusMessage={statusMessage} currentTool={currentTool} />
      <div dir="ltr" className="mt-3 relative">


{aiFileNotification && (
  <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-2 rounded-2xl shadow-xl flex items-center gap-3 text-sm font-medium animate-pulse">
      <span className="text-lg">🧠</span>
      <span>Kasra found and loaded:</span>
      <span className="font-bold underline">{aiFileNotification.fileName}</span>
    </div>
  </div>
)}
        {/* ── File pills ──────────────────────────────────────────────────── */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {files.map(f => (
              <div
                key={f.id}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-all ${
                  f.status === 'ok'      ? 'bg-blue-100 text-blue-700' :
                  f.status === 'error'   ? 'bg-red-100 text-red-600' :
                                           'bg-slate-100 text-slate-500 animate-pulse'
                }`}
              >
                {f.status === 'loading' && (
                  <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                )}
                {f.status === 'ok'    && <span>📎</span>}
                {f.status === 'error' && <span>⚠️</span>}
                <span className="max-w-[120px] truncate">{f.fileName}</span>
                {f.status !== 'loading' && (
                  <button onClick={() => removeFile(f.id)} className="hover:text-red-500">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
<SlashCommandPanel
      query={slashQuery}
      onSelectModel={handleSelectModel}
      onSelectTool={handleSelectTool}
      onClose={() => setSlashQuery('')}
    />

        {/* ── Input row ────────────────────────────────────────────────────── */}
        <div className="flex items-end gap-2 p-2 rounded-2xl backdrop-blur-md bg-white/20 border border-white/30 shadow-lg">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            multiple
            accept=".txt,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.doc,.docx,.csv,.json,.xml,.html,.md"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="shrink-0 p-2 rounded-full text-slate-500 hover:bg-white/20 hover:text-blue-500 transition-colors"
            title="Attach file"
          >
            <Paperclip className={`w-5 h-5 ${uploading ? 'animate-pulse text-blue-400' : ''}`} />
          </button>
{activeTag && (
  <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
    activeTag.type === 'model'
      ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
  }`}>
{activeTag.type === 'model'
  ? `⚡ ${activeTag.value}`
  : `🔧 ${toolFriendlyMap[activeTag.value] || activeTag.value}`
}    <button onClick={() => setActiveTag(null)} className="ml-1 text-slate-400 hover:text-white">
      <X className="w-3 h-3 inline" />
    </button>
  </span>
)}
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent border-none outline-none text-slate-700 px-2 py-3 placeholder:text-slate-500 rounded-2xl resize-none"
           placeholder={
  hasFiles
    ? `Ask about ${okCount} file(s)...`
    : 'What do you want from Kasra?'
}
            value={goal}
            onChange={handleGoalChange}
            onKeyDown={handleKeyDown}
            rows={1}
            style={{ minHeight: '48px' }}
            disabled={loading}
          />

          <button
            onClick={submit}
            disabled={loading || (!goal.trim() && !hasFiles)}
            className="relative shrink-0 p-3 rounded-full transition-all duration-200 mb-1 text-blue-500 hover:bg-white/20 hover:text-blue-600 cursor-pointer disabled:opacity-40"
          >
            {isWorking ? <Square className="w-5 h-5" /> : <ArrowUp className="w-5 h-5" />}
          </button>
        </div>

        {/* ── Subtle hint when files are ready ────────────────────────────── */}
        {hasFiles && (
          <p className="text-center text-xs text-slate-400 mt-1">
            {okCount} file(s) ready — ask anything
          </p>
        )}
      </div>
    </div>
  );
}