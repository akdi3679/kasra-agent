'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BarChart3, Clock, Package, Activity } from 'lucide-react';

export function Dashboard({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [inventory, setInventory] = useState<any[]>([]);
  const [crons, setCrons] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState({ tools: 0, sessions: 0, totalStock: 0 });

  const fetchData = async () => {
    try {
      const [invRes, cronRes, healthRes] = await Promise.all([
        fetch('https://kasra-agent.onrender.com/api/inventory'),
        fetch('https://kasra-agent.onrender.com/api/crons'),
        fetch('https://kasra-agent.onrender.com/api/health'),
      ]);
      const inv = await invRes.json();
      const crons = await cronRes.json();
      const health = await healthRes.json();
      setInventory(inv);
      setCrons(Array.isArray(crons) ? crons : []);
      setStats({
        tools: health.tools || 0,
        sessions: 1, // placeholder
        totalStock: inv.reduce((sum: number, i: any) => sum + i.quantity, 0),
      });
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  // Listen to SSE for live events
  useEffect(() => {
    if (!isOpen) return;
    const es = new EventSource('https://kasra-agent.onrender.com/api/events');
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'task' || data.type === 'tool_start' || data.type === 'cron_result') {
          setEvents((prev) => [data, ...prev].slice(0, 20));
        }
      } catch {}
    };
    return () => es.close();
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-[800px] max-w-[90vw] max-h-[80vh] mx-4 p-6 rounded-3xl bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.96, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-blue-400" />
                Live Dashboard
              </h2>
              <button onClick={onClose} className="text-white/60 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center gap-2 text-blue-400 mb-1"><Package className="w-4 h-4" /> Inventory</div>
                <div className="text-3xl font-bold text-white">{stats.totalStock}</div>
                <div className="text-xs text-white/50">total units</div>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center gap-2 text-emerald-400 mb-1"><Clock className="w-4 h-4" /> Cron Jobs</div>
                <div className="text-3xl font-bold text-white">{crons.length}</div>
                <div className="text-xs text-white/50">{crons.filter((c: any) => c.status === 'active').length} active</div>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center gap-2 text-purple-400 mb-1"><Activity className="w-4 h-4" /> Tools</div>
                <div className="text-3xl font-bold text-white">{stats.tools}</div>
                <div className="text-xs text-white/50">available</div>
              </div>
            </div>

            {/* Inventory Table */}
            <div className="mb-6">
              <h3 className="text-white font-semibold mb-2">Inventory</h3>
              <div className="bg-white/5 rounded-xl overflow-hidden">
                <table className="w-full text-sm text-left text-white/80">
                  <thead className="bg-white/10">
                    <tr>
                      <th className="px-4 py-2">Product</th>
                      <th className="px-4 py-2">Qty</th>
                      <th className="px-4 py-2">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.slice(0, 8).map((item: any) => (
                      <tr key={item.id} className="border-t border-white/5">
                        <td className="px-4 py-2">{item.product_name}</td>
                        <td className="px-4 py-2">{item.quantity}</td>
                        <td className="px-4 py-2">${item.unit_price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Live Events */}
            <div>
              <h3 className="text-white font-semibold mb-2">Live Events</h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {events.map((evt: any, i: number) => (
                  <div key={i} className="text-xs text-white/60 bg-white/5 px-3 py-1.5 rounded-lg">
                    {evt.type === 'task' && `✅ ${evt.task?.description}`}
                    {evt.type === 'tool_start' && `🔧 ${evt.tool} started`}
                    {evt.type === 'cron_result' && `⏰ Cron #${evt.taskId} done: ${evt.result?.slice(0, 40)}`}
                  </div>
                ))}
                {events.length === 0 && <div className="text-xs text-white/30">Waiting for events...</div>}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

