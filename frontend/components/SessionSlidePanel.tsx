'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Plus, X, CheckCircle } from 'lucide-react';

interface Session {
  session_id: string;
  started: string;
  msg_count: number;
}

export function SessionSlidePanel({
  currentSession,
  onSwitchSession,
  isOpen,
  onClose,
  showCron,
  onToggleCron,
}: {
  currentSession: string;
  onSwitchSession: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
  showCron: boolean;
  onToggleCron: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);

  const fetchSessions = async () => {
    try {
      const res = await fetch('https://kasra-agent.onrender.com/api/sessions');
      const data = await res.json();
      const sorted = (data || []).sort((a: Session, b: Session) => {
        if (a.session_id === currentSession) return -1;
        if (b.session_id === currentSession) return 1;
        return 0;
      });
      setSessions(sorted);
    } catch {}
  };

  useEffect(() => {
    if (isOpen) fetchSessions();
  }, [isOpen, currentSession]);

  const createSession = () => {
    const newId = `session_${Date.now()}`;
    onSwitchSession(newId);
    fetchSessions();
  };

  const displayedSessions = sessions.filter(s => {
    if (showCron) return true;
    return !s.session_id.startsWith('cron_');
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: -320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -320, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="fixed left-0 top-0 h-full w-72 bg-slate-900/95 backdrop-blur-xl border-r border-white/10 z-50 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h3 className="font-semibold text-white text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400" /> Sessions
            </h3>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* New Session button */}
          <button
            onClick={createSession}
            className="m-3 flex items-center justify-center gap-2 py-2 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-medium hover:bg-blue-500/30 transition"
          >
            <Plus className="w-3 h-3" /> New Session
          </button>

          {/* Cron toggle */}
          <button
            onClick={onToggleCron}
            className={`mx-3 mb-3 flex items-center justify-between px-4 py-2 rounded-xl text-xs font-medium border transition ${
              showCron
                ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                : 'bg-white/5 border-white/10 text-slate-400'
            }`}
          >
            <span>⏰ Show Cron Sessions</span>
            <span className={showCron ? 'text-emerald-400' : 'text-slate-500'}>
              {showCron ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Session list */}
          <div
            className="flex-1 overflow-y-auto px-3 pb-4 space-y-1"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {displayedSessions.map(s => (
              <button
                key={s.session_id}
                onClick={() => onSwitchSession(s.session_id)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs transition flex items-center justify-between ${
                  s.session_id === currentSession
                    ? 'bg-blue-500/30 border border-blue-400/50 text-white'
                    : 'bg-white/5 border border-transparent text-slate-300 hover:bg-white/10'
                }`}
              >
                <div>
                  <div className="font-medium truncate">{s.session_id}</div>
                  <div className="text-slate-500">{s.msg_count} messages</div>
                </div>
                {s.session_id === currentSession && (
                  <CheckCircle className="w-4 h-4 text-blue-400 shrink-0" />
                )}
              </button>
            ))}
            {displayedSessions.length === 0 && (
              <div className="text-slate-500 text-xs text-center py-4">No sessions to show</div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

