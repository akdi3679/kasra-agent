'use client';
import { useEffect } from 'react';

const TEXT_EXTS = ['.txt', '.csv', '.json', '.md', '.log', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx'];
const OCR_EXTS  = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.docx', '.doc', '.xlsx', '.xls'];

function isTextFile(name: string) {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  return TEXT_EXTS.includes(ext);
}

function needsOCR(name: string) {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  return OCR_EXTS.includes(ext);
}

export function RequestLocalFileListener() {
  useEffect(() => {
    const handler = async (e: CustomEvent) => {
      const { requestId, fileName } = e.detail;

      // Show a subtle toast
      const toast = document.createElement('div');
      toast.innerText = `Kasra is requesting: ${fileName}. Select the file.`;
      Object.assign(toast.style, {
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        background: '#1e293b', color: '#e2e8f0', padding: '12px 24px',
        borderRadius: '8px', zIndex: '99999', fontWeight: 'bold',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      });
      document.body.appendChild(toast);

      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async (ev: any) => {
        document.body.removeChild(toast);
        const file = ev.target.files?.[0];
        if (!file) {
          // User cancelled
          await fetch('https://kasra-agent.onrender.com/api/local-file-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, content: '', fileName: '' }),
          });
          return;
        }

        let content = '';
        try {
          if (isTextFile(file.name)) {
            // Direct read for text files
            content = await file.text();
          } else if (needsOCR(file.name)) {
            // OCR via backend endpoint
            const formData = new FormData();
            formData.append('file', file);
            const ocrRes = await fetch('https://kasra-agent.onrender.com/api/ocr', {
              method: 'POST',
              body: formData,
            });
            const ocrData = await ocrRes.json();
            content = ocrData.success ? ocrData.extractedText : `❌ OCR failed: ${ocrData.error || 'unknown'}`;
          } else {
            // Fallback: try reading as text
            content = await file.text();
          }
        } catch (err: any) {
          content = `❌ Error reading file: ${err.message}`;
        }

        // Send the result back to the backend
        await fetch('https://kasra-agent.onrender.com/api/local-file-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, content, fileName: file.name }),
        });
      };
      input.click();
    };

    window.addEventListener('kasra_request_local_file', handler as EventListener);
    return () => window.removeEventListener('kasra_request_local_file', handler as EventListener);
  }, []);

  return null;
}