'use client';
import { Download } from 'lucide-react';

export function detectLocalAgentMarker(text: string): boolean {
  return text.includes('[LOCAL_AGENT_REQUIRED]');
}

export function LocalAgentButton() {
  const handleDownload = () => {
    window.open('https://kasra-agent.onrender.com/api/download-local-agent', '_blank');
  };

  return (
    <div className="mt-3 flex items-center gap-3 bg-blue-500/10 border border-blue-400/30 rounded-xl px-4 py-3">
      <div className="flex-1 text-sm text-blue-300">
        <strong>Kasra needs a local helper</strong> to control your desktop.
        Download and run the script, then re‑issue your command.
      </div>
      <button
        onClick={handleDownload}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors shrink-0"
      >
        <Download className="w-4 h-4" />
        Download Script
      </button>
    </div>
  );
}