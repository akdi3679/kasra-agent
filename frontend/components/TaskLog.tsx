'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Loader2, XCircle, ListTodo } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface Task {
  id: string;
  description: string;
  status: 'running' | 'done' | 'failed';
}

const FRIENDLY_NAMES: Record<string, string> = {
  get_inventory: 'Fetching inventory',
  get_sales_data: 'Loading sales data',
  db_update: 'Updating stock',
  web_search: 'Searching web',
  browse_web: 'Browsing page',
  read_local_file: 'Reading file',
  list_local_directory: 'Listing files',
  export_excel: 'Exporting Excel',
  generate_pdf: 'Generating PDF',
  create_ical_event: 'Creating event',
  to_table: 'Building table',
  to_html: 'Rendering chart',
  execute_python: 'Running Python',
  send_email: 'Sending email',
  schedule_task: 'Scheduling task',
  list_crons: 'Listing schedules',
  find_file: 'Searching files',
  live_screen: 'Taking screenshot',
  browser_control: 'Controlling browser',
  desktop_control: 'Desktop action',
  analyze_project: 'Analyzing project',
  save_to_memory: 'Saving to memory',
  search_memory: 'Searching memory',
};

function friendlyDescription(raw: string): string {
  // Handle composite descriptions like "Turn 2 — to_table, export_excel"
  if (raw.startsWith('Turn ') && raw.includes(' — ')) {
    const tools = raw.split(' — ')[1] || raw;
    return tools.split(', ').map(t => FRIENDLY_NAMES[t] || t).join(' + ');
  }
  return FRIENDLY_NAMES[raw] || raw.replace(/_/g, ' ');
}

export function TaskLog({ isOpen, onClose, tasks }: { isOpen: boolean; onClose: () => void; tasks: Task[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tasks.length]);

  // Count statuses
  const running = tasks.filter(t => t.status === 'running').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const failed = tasks.filter(t => t.status === 'failed').length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -8 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="fixed top-16 right-4 w-80 max-h-[70vh] z-50 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <h3 className="font-semibold text-white text-sm flex items-center gap-2">
              <ListTodo className="w-4 h-4 text-blue-400" />
              Tasks
            </h3>
            <div className="flex items-center gap-3 text-xs">
              {running > 0 && <span className="text-amber-400">{running} active</span>}
              {done > 0 && <span className="text-emerald-400">{done} done</span>}
              {failed > 0 && <span className="text-rose-400">{failed} failed</span>}
              <button onClick={onClose} className="text-slate-400 hover:text-white ml-1">
                ✕
              </button>
            </div>
          </div>

          {/* Task list */}
          <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1"
               style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
            {tasks.length === 0 && (
              <p className="text-slate-500 text-xs text-center py-6">Waiting for tasks...</p>
            )}
            {tasks.map(task => (
              <div
                key={task.id}
                className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                {task.status === 'done' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                )}
                {task.status === 'running' && (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0 mt-0.5" />
                )}
                {task.status === 'failed' && (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span className={`text-xs leading-relaxed ${
                  task.status === 'done' ? 'text-slate-300' :
                  task.status === 'running' ? 'text-blue-300' :
                  'text-rose-300'
                }`}>
                  {friendlyDescription(task.description)}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}