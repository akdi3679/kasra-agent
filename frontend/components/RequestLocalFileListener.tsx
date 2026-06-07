'use client';
import { useEffect, useState } from 'react';

const TEXT_EXTS = ['.txt', '.csv', '.json', '.md', '.log', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx'];
const OCR_EXTS  = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.docx', '.doc', '.xlsx', '.xls'];

function isTextFile(name: string) { return TEXT_EXTS.includes(name.slice(name.lastIndexOf('.')).toLowerCase()); }
function needsOCR(name: string)   { return OCR_EXTS.includes(name.slice(name.lastIndexOf('.')).toLowerCase()); }

export function RequestLocalFileListener() {
  const [request, setRequest] = useState<any>(null);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setRequest(e.detail);           // show the modal
    };
    window.addEventListener('kasra_request_local_file', handler as EventListener);
    return () => window.removeEventListener('kasra_request_local_file', handler as EventListener);
  }, []);

  const handleSelectFile = () => {
    if (!request) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (ev: any) => {
      const file = ev.target.files?.[0];
      if (!file) {
        // User cancelled
        await fetch('https://kasra-agent.onrender.com/api/local-file-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: request.requestId, content: '', fileName: '' }),
        });
        setRequest(null);
        return;
      }

      let content = '';
      try {
        if (isTextFile(file.name)) {
          content = await file.text();
        } else if (needsOCR(file.name)) {
          const formData = new FormData();
          formData.append('file', file);
          const ocrRes = await fetch('https://kasra-agent.onrender.com/api/ocr', {
            method: 'POST',
            body: formData,
          });
          const ocrData = await ocrRes.json();
          content = ocrData.success ? ocrData.extractedText : `❌ OCR failed: ${ocrData.error || 'unknown'}`;
        } else {
          content = await file.text();
        }
      } catch (err: any) {
        content = `❌ Error: ${err.message}`;
      }

      await fetch('https://kasra-agent.onrender.com/api/local-file-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.requestId, content, fileName: file.name }),
      });
      setRequest(null);
    };
    input.click();
  };

  if (!request) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999]">
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-white font-semibold text-base mb-2">Kasra is requesting a file</h3>
        <p className="text-slate-400 text-sm mb-4">
          <strong className="text-white">{request.fileName}</strong> from your computer.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              fetch('https://kasra-agent.onrender.com/api/local-file-result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: request.requestId, content: '', fileName: '' }),
              });
              setRequest(null);
            }}
            className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl py-2.5 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSelectFile}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
          >
            Select file
          </button>
        </div>
      </div>
    </div>
  );
}