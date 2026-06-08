'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Wrench, Check } from 'lucide-react';
import { useState, useEffect } from 'react';

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  available: boolean;
}

interface ToolOption {
  name: string;
  friendly: string;
}


export function SlashCommandPanel({
  query,
  onSelectModel,
  onSelectTool,
  onClose,
}: {
  query: string;
  onSelectModel: (modelId: string) => void;
  onSelectTool: (toolName: string) => void;
  onClose: () => void;
}) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [tools, setTools] = useState<ToolOption[]>([]);
  const [loading, setLoading] = useState(false);

  const showCommands = !query.startsWith('/model') && !query.startsWith('/tool');
  const showModels = query.startsWith('/model');
  const showTools = query.startsWith('/tool');

  // Load models when /model is detected
  useEffect(() => {
    if (!showModels) return;
    setLoading(true);
    fetch('http://kasra-agent.onrender.com/api/models')
  .then(r => r.json())
  .then(data => setModels(data || []))
  .catch(() => setModels([]))   // just empty on failure
  .finally(() => setLoading(false));
  }, [showModels]);

  // Load tools when /tool is detected
  useEffect(() => {
    if (!showTools) return;
    setLoading(true);
    fetch('http://kasra-agent.onrender.com/api/tools-list')
  .then(r => r.json())
  .then(data => setTools(data || []))
  .catch(() => {})
  .finally(() => setLoading(false));
  }, [showTools]);

  const commands = [
    { id: '/model', icon: <Cpu className="w-4 h-4" />, label: '/model', description: 'Switch LLM model' },
    { id: '/tool', icon: <Wrench className="w-4 h-4" />, label: '/tool', description: 'Suggest a tool' },
  ];

  const filteredCommands = commands.filter(c => c.id.startsWith(query));

  return (
    <AnimatePresence>
      {query && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          className="absolute bottom-full left-0 right-0 mb-2 bg-slate-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
        >
          {/* Command list (when no specific command selected yet) */}
          {showCommands && filteredCommands.map(cmd => (
            <button
              key={cmd.id}
              onClick={() => {
                // Instead of closing, we change the query to trigger the next step
                if (cmd.id === '/model') onSelectModel('__select__'); // placeholder to trigger model list
                if (cmd.id === '/tool') onSelectTool('__select__');
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left transition"
            >
              <div className="text-slate-400">{cmd.icon}</div>
              <div>
                <div className="text-sm font-medium text-white">{cmd.label}</div>
                <div className="text-xs text-slate-500">{cmd.description}</div>
              </div>
            </button>
          ))}

          {/* Model list */}
          {showModels && (
            <div className="max-h-48 overflow-y-auto">
              <div className="px-4 py-2 text-xs text-slate-500 uppercase tracking-wider flex items-center justify-between">
                <span>Select Model</span>
                <button onClick={onClose} className="text-slate-500 hover:text-white text-xs">Cancel</button>
              </div>
              {loading ? (
                <div className="px-4 py-3 text-xs text-slate-400">Loading models...</div>
              ) : (
                models.map(m => (
                  <button
                    key={m.id}
                    onClick={() => m.available && onSelectModel(m.id)}
                    disabled={!m.available}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 text-left transition ${
                      !m.available ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-white">{m.name}</div>
                      <div className="text-xs text-slate-500">{m.provider}</div>
                    </div>
                    {m.available && <Check className="w-4 h-4 text-emerald-400" />}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Tool list */}
          {showTools && (
            <div className="max-h-48 overflow-y-auto">
              <div className="px-4 py-2 text-xs text-slate-500 uppercase tracking-wider flex items-center justify-between">
                <span>Select Tool</span>
                <button onClick={onClose} className="text-slate-500 hover:text-white text-xs">Cancel</button>
              </div>
               {loading ? (
    <div className="px-4 py-3 text-xs text-slate-400">Loading tools...</div>
  ) : (
    tools.map(t => (
      <button
        key={t.name}
        onClick={() => onSelectTool(t.name)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/5 text-left transition"
      >
        <Wrench className="w-3.5 h-3.5 text-blue-400" />
<span className="text-sm text-slate-300">{t.friendly}</span>
      </button>
    ))
  )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

