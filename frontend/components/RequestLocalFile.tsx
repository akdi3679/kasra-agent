'use client';
import { useEffect, useRef } from 'react';

export function RequestLocalFileListener() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { requestId, fileName } = e.detail;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '*';
      input.onchange = async (ev: any) => {
        const file = ev.target.files?.[0];
        if (!file) return;

        const text = await file.text();
        await fetch('https://kasra-agent.onrender.com/api/local-file-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, content: text, fileName: file.name }),
        });
      };
      input.click();
    };

    window.addEventListener('kasra_request_local_file', handler as EventListener);
    return () => window.removeEventListener('kasra_request_local_file', handler as EventListener);
  }, []);

  return null; // invisible component
}