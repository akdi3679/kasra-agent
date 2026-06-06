'use client';
import { useEffect } from 'react';

export function RequestLocalFileListener() {
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      console.log('📂 Opening file dialog for', e.detail.fileName);
      const { requestId } = e.detail;
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = async (ev: any) => {
        const file = ev.target.files?.[0];
        document.body.removeChild(input);
        if (!file) {
          await fetch('https://kasra-agent.onrender.com/api/local-file-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, content: '', fileName: '' }),
          });
          return;
        }
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

  return null;
}