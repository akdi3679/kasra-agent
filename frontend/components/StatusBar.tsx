'use client';
import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

export function StatusBar({
  blobState,
  statusMessage,
  currentTool,
}: {
  blobState: string;
  statusMessage: string;
  currentTool: string;
}) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const updateTime = () =>
      setTime(new Date().toLocaleTimeString('ar-TN', { hour: '2-digit', minute: '2-digit' }));
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const labels: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking...',
  using_tools: 'Using tools',
  talking: 'Talking',
};

  return (
    <div className="max-w-md mx-auto px-4 py-0">
      <div className="glass-card px-5 py-0 flex items-center justify-between text-sm ">
        <div className="flex items-center gap-3">
          <span className="text-slate-500">{labels[blobState] || blobState}</span>
          {statusMessage && (
            <span className="text-slate-400 truncate max-w-[200px]">— {statusMessage}</span>
          )}
          {currentTool && (
            <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full text-xs">
              🔧 {currentTool}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <Clock className="w-4 h-4" />
          {time}
        </div>
      </div>
    </div>
  );
}