'use client';
import { useEffect } from 'react';

export function RequestLocalFileListener() {
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { requestId, fileName } = e.detail;
      // Show a subtle toast
      const toast = document.createElement('div');
      toast.innerText = `Kasra is requesting: ${fileName}. Select the file.`;
      Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#1e293b',
        color: '#e2e8f0',
        padding: '12px 24px',
        borderRadius: '8px',
        zIndex: '99999',
        fontWeight: 'bold',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      });
      document.body.appendChild(toast);

      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async (ev: any) => {
        document.body.removeChild(toast);
        const file = ev.target.files?.[0];
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