'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, X } from 'lucide-react';

interface CronNotificationData {
  taskId: string;
  prompt: string;
  output: string;
  timestamp: string;
}

export function CronNotification({ results }: { results: any[] }) {
  const [notifications, setNotifications] = useState<CronNotificationData[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
 useEffect(() => {
    if (results.length > 0) {
      const latest = results[0];
      setNotifications(prev => [latest, ...prev].slice(0, 5));
    }
  }, [results]);
 
  // Listen for SSE cron_result events
  useEffect(() => {
    const es = new EventSource('http://localhost:3001/api/events');

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'cron_result') {
          const newNotif: CronNotificationData = {
            taskId: data.task_id,
            prompt: data.prompt || '',
            output: data.output || '',
            timestamp: data.timestamp || new Date().toISOString(),
          };
          setNotifications(prev => [newNotif, ...prev].slice(0, 5));
        }
      } catch {}
    };

    return () => es.close();
  }, []);

  const dismiss = (index: number) => {
    setDismissed(prev => new Set(prev).add(index));
    // Remove completely after animation
    setTimeout(() => {
      setNotifications(prev => prev.filter((_, i) => i !== index));
      setDismissed(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }, 300);
  };

  // Auto‑dismiss after 6 seconds
  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      dismiss(0);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notifications]);

  return (
    <AnimatePresence>
      {notifications.map((notif, index) =>
        !dismissed.has(index) ? (
          <motion.div
            key={`${notif.taskId}-${index}`}
            initial={{ opacity: 0, y: -60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.9 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-[420px] max-w-[90vw]"
          >
            <div className="bg-gradient-to-br from-emerald-900/95 to-emerald-800/95 backdrop-blur-xl border border-emerald-500/30 rounded-2xl shadow-2xl shadow-emerald-500/10 p-4">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-emerald-300" />
                  </div>
                  <div>
                    <div className="text-xs text-emerald-400 font-medium">Scheduled Task Complete</div>
                    <div className="text-xs text-emerald-600 font-mono">#{notif.taskId}</div>
                  </div>
                </div>
                <button
                  onClick={() => dismiss(index)}
                  className="text-emerald-400 hover:text-emerald-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Prompt */}
              <div className="text-xs text-emerald-200/80 mb-2 bg-emerald-950/30 rounded-lg px-3 py-1.5 truncate">
                {notif.prompt}
              </div>

              {/* Output preview */}
              <div className="text-sm text-emerald-100 bg-emerald-950/50 rounded-lg px-3 py-2 max-h-20 overflow-y-auto">
                {notif.output.slice(0, 200)}
                {notif.output.length > 200 && '...'}
              </div>
            </div>
          </motion.div>
        ) : null
      )}
    </AnimatePresence>
  );
}