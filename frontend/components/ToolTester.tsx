'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Loader2 } from 'lucide-react';
import { BlobAvatar, BlobState } from './BlobAvatar';

const TOOLS = ['get_inventory', 'get_sales_data', 'web_search', 'export_excel', 'create_ical_event'];

export function ToolTester({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [selectedTool, setSelectedTool] = useState('');
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [blobState, setBlobState] = useState<BlobState>('idle');

  const handleTest = async () => {
    setRunning(true);
    setBlobState('using_tools');
    try {
      const res = await fetch('http://localhost:3001/api/tool-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: selectedTool, args: JSON.parse(args) }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
      setBlobState('talking');
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
      setBlobState('idle');
    } finally {
      setRunning(false);
      setTimeout(() => setBlobState('idle'), 1000);
    }
  };

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
            className="w-[540px] max-w-[90vw] mx-4 p-6 rounded-3xl bg-white/50 backdrop-blur-xl border border-gray-300 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.96, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-800">Test Tool</h2>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Blob + State Selector */}
            <div className="flex flex-col items-center gap-3 mb-6">
              <BlobAvatar state={blobState} />
              <div className="flex gap-2 flex-wrap justify-center">
                {(['idle', 'thinking', 'using_tools', 'talking'] as BlobState[]).map((state) => (
                  <button
                    key={state}
                    onClick={() => setBlobState(state)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                      blobState === state
                        ? 'bg-blue-500 text-white shadow-md'
                        : 'bg-white/50 backdrop-blur-sm text-slate-600 hover:bg-white/80'
                    }`}
                  >
                    {state}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">Select a state or leave it to change automatically during testing</p>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <select
                className="w-full p-3 rounded-2xl bg-white/50 backdrop-blur-sm border border-gray-300 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                value={selectedTool}
                onChange={(e) => setSelectedTool(e.target.value)}
              >
                <option value="">Select a tool...</option>
                {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <textarea
                className="w-full p-3 rounded-2xl bg-white/50 backdrop-blur-sm border border-gray-300 text-slate-700 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                rows={4}
                value={args}
                onChange={(e) => setArgs(e.target.value)}
              />
              <button
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-blue-700 text-white font-semibold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-blue-500/25 active:scale-[0.98] transition disabled:opacity-50"
                onClick={handleTest}
                disabled={!selectedTool || running}
              >
                {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                {running ? 'Running...' : 'Run'}
              </button>
              {result && (
                <pre className="p-4 rounded-2xl bg-white/50 backdrop-blur-sm border border-gray-300 text-slate-600 text-sm overflow-auto max-h-48 font-mono">
                  {result}
                </pre>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

