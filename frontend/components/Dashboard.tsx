'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BarChart3, Package, Users, Clock, Activity, Calendar } from 'lucide-react';
import { RefreshCw } from 'lucide-react';  
interface Customer {
  id: number;
  name: string;
  email: string;
  total_orders: number;
  created_at: string;
}

interface InventoryItem {
  id: number;
  product_name: string;
  quantity: number;
  min_quantity: number;
  unit_price: number;
}

interface Forecast {
  id: number;
  product_name: string;
  predicted_days: number;
  actual_days: number | null;
  timestamp: string;
}

interface CronTask {
  id: number;
  prompt: string;
  cron_expression: string;
  next_run: string;
  status: string;
}

interface TaskOutcome {
  id: number;
  session_id: string;
  goal: string;
  tools_used: string;
  outcome: string;
  created_at: string;
}

export function Dashboard({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [crons, setCrons] = useState<CronTask[]>([]);
  const [recentTasks, setRecentTasks] = useState<TaskOutcome[]>([]);
  const [stats, setStats] = useState({ totalProducts: 0, totalCustomers: 0, totalCrons: 0, totalOrders: 0 });

  const API = 'https://kasra-agent.onrender.com';

  const fetchData = async () => {
    try {
      const [invRes, custRes, foreRes, cronRes, taskRes] = await Promise.all([
        fetch(`${API}/api/inventory`),
        fetch(`${API}/api/query?table=customers`),
        fetch(`${API}/api/forecast`),
        fetch(`${API}/api/crons`),
        fetch(`${API}/api/query?table=task_outcomes&limit=10`),
      ]);
      const inv = await invRes.json();
      const cust = await custRes.json();
      const fore = await foreRes.json();
      const cron = await cronRes.json();
      const tasks = await taskRes.json();

      setInventory(inv);
      setCustomers(Array.isArray(cust) ? cust : []);
      setForecasts(Array.isArray(fore) ? fore : []);
      setCrons(Array.isArray(cron) ? cron : []);
      setRecentTasks(Array.isArray(tasks) ? tasks : []);
      setStats({
        totalProducts: inv.length,
        totalCustomers: Array.isArray(cust) ? cust.length : 0,
        totalCrons: Array.isArray(cron) ? cron.filter((c: any) => c.status === 'active').length : 0,
        totalOrders: Array.isArray(cust) ? cust.reduce((sum: number, c: any) => sum + (c.total_orders || 0), 0) : 0,
      });
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
      const interval = setInterval(fetchData, 10000);
      return () => clearInterval(interval);
    }
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
            className="w-[900px] max-w-[95vw] max-h-[85vh] mx-4 p-6 rounded-3xl bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl overflow-y-auto"
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
  <div className="flex items-center gap-2">
    <button
      onClick={fetchData}
      className="text-white/60 hover:text-white hover:bg-white/10 rounded-xl p-2 transition"
      title="Refresh data"
    >
      <RefreshCw className="w-5 h-5" />
    </button>
    <button onClick={onClose} className="text-white/60 hover:text-white">
      <X className="w-5 h-5" />
    </button>
  </div>
</div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center gap-2 text-blue-400 mb-1"><Package className="w-4 h-4" /> Products</div>
                <div className="text-3xl font-bold text-white">{stats.totalProducts}</div>
                <div className="text-xs text-white/50">in inventory</div>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center gap-2 text-emerald-400 mb-1"><Users className="w-4 h-4" /> Customers</div>
                <div className="text-3xl font-bold text-white">{stats.totalCustomers}</div>
                <div className="text-xs text-white/50">{stats.totalOrders} total orders</div>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center gap-2 text-amber-400 mb-1"><Clock className="w-4 h-4" /> Cron Jobs</div>
                <div className="text-3xl font-bold text-white">{stats.totalCrons}</div>
                <div className="text-xs text-white/50">active</div>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center gap-2 text-purple-400 mb-1"><Activity className="w-4 h-4" /> Tasks</div>
                <div className="text-3xl font-bold text-white">{recentTasks.length}</div>
                <div className="text-xs text-white/50">recent executions</div>
              </div>
            </div>

            {/* Two‑column layout: Inventory + Customers */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Inventory Table */}
              <div>
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2"><Package className="w-4 h-4 text-blue-400" /> Inventory</h3>
                <div className="bg-white/5 rounded-xl overflow-hidden">
                  <table className="w-full text-sm text-left text-white/80">
                    <thead className="bg-white/10">
                      <tr>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Qty</th>
                        <th className="px-3 py-2">Min</th>
                        <th className="px-3 py-2">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.slice(0, 5).map((item: any) => (
                        <tr key={item.id} className="border-t border-white/5">
                          <td className="px-3 py-2">{item.product_name}</td>
                          <td className="px-3 py-2">{item.quantity}</td>
                          <td className="px-3 py-2">{item.min_quantity}</td>
                          <td className="px-3 py-2">${item.unit_price}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Customers Table */}
              <div>
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-emerald-400" /> Customers</h3>
                <div className="bg-white/5 rounded-xl overflow-hidden">
                  <table className="w-full text-sm text-left text-white/80">
                    <thead className="bg-white/10">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.slice(0, 5).map((c: any) => (
                        <tr key={c.id} className="border-t border-white/5">
                          <td className="px-3 py-2">{c.name}</td>
                          <td className="px-3 py-2">{c.email}</td>
                          <td className="px-3 py-2">{c.total_orders}</td>
                        </tr>
                      ))}
                      {customers.length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-4 text-center text-white/30">No customers yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Bottom row: Cron + Recent Tasks */}
            <div className="grid grid-cols-2 gap-4">
              {/* Scheduled Tasks */}
              <div>
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2"><Calendar className="w-4 h-4 text-amber-400" /> Scheduled Tasks</h3>
                <div className="bg-white/5 rounded-xl overflow-hidden">
                  <table className="w-full text-sm text-left text-white/80">
                    <thead className="bg-white/10">
                      <tr>
                        <th className="px-3 py-2">Task</th>
                        <th className="px-3 py-2">Next Run</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crons.slice(0, 5).map((c: any) => (
                        <tr key={c.id} className="border-t border-white/5">
                          <td className="px-3 py-2 truncate max-w-[150px]">{c.prompt}</td>
                          <td className="px-3 py-2 text-xs">{c.next_run?.slice(0, 16)}</td>
                          <td className="px-3 py-2">
                            <span className={c.status === 'active' ? 'text-emerald-400' : c.status === 'paused' ? 'text-amber-400' : 'text-rose-400'}>
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {crons.length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-4 text-center text-white/30">No scheduled tasks</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Agent Tasks */}
              <div>
                <h3 className="text-white font-semibold mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-purple-400" /> Recent Agent Tasks</h3>
                <div className="bg-white/5 rounded-xl overflow-hidden">
                  <table className="w-full text-sm text-left text-white/80">
                    <thead className="bg-white/10">
                      <tr>
                        <th className="px-3 py-2">Goal</th>
                        <th className="px-3 py-2">Tools</th>
                        <th className="px-3 py-2">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTasks.slice(0, 5).map((t: any) => (
                        <tr key={t.id} className="border-t border-white/5">
                          <td className="px-3 py-2 truncate max-w-[150px]">{t.goal}</td>
                          <td className="px-3 py-2 text-xs">{t.tools_used}</td>
                          <td className="px-3 py-2">
                            <span className={t.outcome === 'success' ? 'text-emerald-400' : 'text-rose-400'}>
                              {t.outcome}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {recentTasks.length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-4 text-center text-white/30">No tasks executed yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}