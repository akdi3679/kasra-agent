'use client';
import { useEffect, useRef, useState } from 'react';
import type { BlobState } from '@/components/BlobAvatar';
interface TaskItem {
  id: string;
  description: string;
  status: 'done' | 'running' | 'failed';
  timestamp: string;
}

interface CronResult {
  task_id: number;
  output: string;
}

interface ReasoningStep {
  turn: number;
  reason: string;
  commands: string[];
  output: string;
}

export function useAgentEvents() {
  const [blobState, setBlobState] = useState<BlobState>('idle');
  const [taskLog, setTaskLog] = useState<TaskItem[]>([]);
  const [cronResults, setCronResults] = useState<CronResult[]>([]);
  const [partialOutputs, setPartialOutputs] = useState<string[]>([]);
  const [latestReason, setLatestReason] = useState<string>('');
  const [reasoningSteps, setReasoningSteps] = useState<ReasoningStep[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [currentTool, setCurrentTool] = useState('');

  // ── Prevent duplicate EventSource connections ──────────────────
  const esRef = useRef<EventSource | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;            // only one connection ever
    initialized.current = true;

    const es = new EventSource('http://localhost:3001/api/events');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        switch (data.type) {
          case 'state':
            setBlobState(data.state || 'idle');
            setStatusMessage(data.state === 'idle' ? '' : (data.message ?? ''));
            break;

          case 'tool_start':
            setCurrentTool(data.tool);
            break;

          case 'tool_end':
            setCurrentTool('');
            break;

          case 'task':
            setTaskLog(prev => {
              const idx = prev.findIndex(t => t.id === data.task.id);
              if (idx !== -1) {
                const updated = [...prev];
                updated[idx] = data.task;
                return updated;
              }
              // only add if not already present (safety dedup)
              if (prev.some(t => t.id === data.task.id)) return prev;
              return [data.task, ...prev].slice(0, 50);
            });
            break;

          case 'partial_output':
            if (data.content) {
              window.dispatchEvent(new CustomEvent('Kasra_partial', { detail: data.content }));
            }
            break;

          case 'reasoning_step':
            if (data.reason) {
              setLatestReason(data.reason.slice(0, 60));
            }
            setReasoningSteps(prev => [...prev, {
              turn: data.turn,
              reason: (data.reason ?? '').slice(0, 80),
              commands: data.commands ?? [],
              output: (data.output ?? '').slice(0, 60),
            }]);
            break;

          case 'cron_result':
            setCronResults(prev => [data, ...prev].slice(0, 20));
            break;

          case 'confirmation_required':
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('Kasra_confirm', { detail: data }));
            }
            break;

          case 'file_inject':
            if (typeof window !== 'undefined' && (window as any).__KasraAddFile) {
              (window as any).__KasraAddFile(data.fileName, data.filePath, data.extractedText);
            }
            break;
        }
      } catch {}
    };

    es.onerror = () => {
      setBlobState('idle');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const resetSession = () => {
    setPartialOutputs([]);
    setReasoningSteps([]);
    setLatestReason('');
  };

  return {
    blobState,
    statusMessage,
    currentTool,
    taskLog,
    cronResults,
    partialOutputs,
    latestReason,
    reasoningSteps,
    resetSession,
  };
}