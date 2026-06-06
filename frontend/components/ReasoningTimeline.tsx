'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';

interface ReasoningStep {
  turn: number;
  reason: string;
  commands: string[];
  output: string;
}

export function ReasoningTimeline({ steps }: { steps: ReasoningStep[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!steps.length) return null;

  return (
    <div className="mt-1 ml-2">
      {/* Toggle — tiny, unobtrusive */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-2.5 h-2.5" />
          : <ChevronRight className="w-2.5 h-2.5" />}
        <Zap className="w-2.5 h-2.5" />
        {steps.length} steps
      </button>

      {expanded && (
        <div className="mt-1 space-y-0.5 pl-2 border-l border-white/10">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] text-slate-500">
              {/* Turn badge */}
              <span className="font-mono text-slate-600">{step.turn}</span>

              {/* Tool chips — very small */}
              {step.commands.slice(0, 2).map(cmd => (
                <span key={cmd} className="bg-blue-500/10 text-blue-400 px-1 rounded text-[9px] font-mono">
                  {cmd.replace(/_/g, ' ')}
                </span>
              ))}

              {/* Truncated reason */}
              <span className="text-slate-500 truncate max-w-[160px]">
                {step.reason.slice(0, 55)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

