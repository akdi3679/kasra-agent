'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { FileDown, FileText, Calendar, Image, Download } from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────

function detectFileType(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'export_excel';
  if (lower.endsWith('.ics'))   return 'create_ical_event';
  if (lower.endsWith('.pdf'))   return 'generate_pdf';
  if (/\.(png|jpe?g)$/.test(lower)) return 'live_screen';
  if (lower.includes('/files/')) return 'file';
  return null;
}

function extractAllAttachments(text: string): {
  cards: { name: string; url: string; type: string }[];
  clean: string;
} {
  const cards: { name: string; url: string; type: string }[] = [];
  let clean = text;

  // 1. [ATTACHMENT] markers
  const attachRegex = /\[ATTACHMENT\](.+?)\|(.+?)\|(.+?)\[\/ATTACHMENT\]/g;
  let m;
  while ((m = attachRegex.exec(text)) !== null) {
    cards.push({ name: m[1], url: m[2], type: m[3] });
    clean = clean.replace(m[0], '');
  }

  // 2. Markdown links [text](url)
  const mdRegex = /\[([^\]]*?)\]\((https?:\/\/[^\s"'<>)]+)\)/g;
  while ((m = mdRegex.exec(clean)) !== null) {
    const url = m[2];
    const type = detectFileType(url);
    if (type) {
      cards.push({ name: m[1] || url.split('/').pop() || 'Download', url, type });
      clean = clean.replace(m[0], '');
    }
  }

  // 3. Bare file URLs
  const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
  while ((m = urlRegex.exec(clean)) !== null) {
    const url = m[1];
    const type = detectFileType(url);
    if (type) {
      cards.push({ name: url.split('/').pop() || 'Download', url, type });
      clean = clean.replace(url, '').trim();
    }
  }

  // 4. Fallback: if clean contains "report" and "pdf" but no URL, still try to extract
  if (cards.length === 0 && /pdf|excel|calendar/i.test(clean)) {
    const fallbackUrl = clean.match(/(\/files\/[^\s"'<>]+)/)?.[1];
    if (fallbackUrl) {
      cards.push({ name: fallbackUrl.split('/').pop() || 'Download', url: fallbackUrl, type: 'file' });
      clean = clean.replace(fallbackUrl, '').trim();
    }
  }

  return { cards, clean: clean.replace(/\n{3,}/g, '\n\n').trim() };
}

function FileCard({ name, url, type }: { name: string; url: string; type: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      if (downloading) return;
      setDownloading(true);
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch {
        window.open(url, '_blank');
      } finally {
        setDownloading(false);
      }
    },
    [url, name, downloading]
  );

  const icon =
    type === 'export_excel' || type === 'file' ? (
      <FileDown className="w-5 h-5 text-emerald-400" />
    ) : type === 'generate_pdf' ? (
      <FileText className="w-5 h-5 text-rose-400" />
    ) : type === 'create_ical_event' ? (
      <Calendar className="w-5 h-5 text-blue-400" />
    ) : (
      <Image className="w-5 h-5 text-purple-400" />
    );

  return (
    <a
      href={url}
      download={name}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleDownload}
      className="flex items-center gap-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-3 transition-colors cursor-pointer select-none no-underline"
    >
      {downloading ? <Download className="w-5 h-5 text-blue-400 animate-bounce" /> : icon}
      <div>
        <div className="text-sm font-medium text-slate-200">{name}</div>
        <div className="text-xs text-slate-400">
          {downloading ? 'Downloading...' : 'Click to download'}
        </div>
      </div>
    </a>
  );
}

function parseCronResult(text: string): { isCron: boolean; taskId?: string; prompt?: string; body: string } {
  const cronMatch = text.match(/^\[CRON_RESULT\|task_id:(\d+)\|prompt:([^\]]+)\]\n?([\s\S]*)/);
  if (cronMatch) {
    return {
      isCron: true,
      taskId: cronMatch[1],
      prompt: cronMatch[2],
      body: cronMatch[3],
    };
  }
  return { isCron: false, body: text };
}

export function Results({ text }: { text: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'resize') {
        setIframeHeight(event.data.height + 32);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

 let raw = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
raw = raw.replace(/^\[TOOL:[^\]]*\]\n?/, '').trim();
raw = raw.replace(/^\[CRON_LIST:.*?\]\n?/, '').trim();

  const cronParsed = parseCronResult(raw);
  const { cards, clean } = extractAllAttachments(cronParsed.body);

 const isHTML =
  raw.includes('<!DOCTYPE html>') ||
  raw.includes('<html') ||
  (raw.trim().startsWith('<') && /<\/?[a-z][\s\S]*?>/i.test(raw));

  const resizeScript = `
    <script>
      function sendHeight() {
        window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
      }
      window.onload = sendHeight;
      new ResizeObserver(sendHeight).observe(document.body);
    </script>`;

  const contentElement = (
    <div className="space-y-3">
      {isHTML && clean && (
        <iframe
          ref={iframeRef}
          srcDoc={
            clean.startsWith('<!DOCTYPE')
              ? clean.replace('</html>', resizeScript + '</html>')
              : `<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin:0; font-family:'Segoe UI',system-ui,sans-serif; background:#0f172a; color:#e2e8f0; padding:16px; }
    table { width:100%; border-collapse:collapse; }
    th,td { border:1px solid #334155; padding:8px 12px; text-align:left; }
    th { background:#1e293b; color:#93c5fd; font-weight:600; }
    tr:nth-child(even) { background:#1e293b; }
  </style>
  ${resizeScript}
</head>
<body>${clean}</body>
</html>`
          }
         className="w-full rounded-2xl border border-white/10 overflow-hidden"
         style={{ height: iframeHeight || 'auto', border: 'none' }}
          sandbox="allow-scripts allow-same-origin"
        />
      )}
     {!isHTML && clean && (
  <div className="whitespace-pre-wrap rounded-2xl p-4 border border-white/10 font-mono text-sm text-black overflow-x-auto overflow-y-hidden">
    {clean}
  </div>
)}
      {cards.length > 0 && (
        <div className="space-y-2 mt-2">
          {cards.map((c, i) => (
            <FileCard key={i} name={c.name} url={c.url} type={c.type} />
          ))}
        </div>
      )}
    </div>
  );

  if (cronParsed.isCron) {
    return (
      <div className="border-l-2 border-blue-500 pl-3 mb-1">
        <div className="text-xs text-blue-400 font-mono mb-1">
          ⏰ Scheduled task #{cronParsed.taskId} · {cronParsed.prompt}
        </div>
        {contentElement}
      </div>
    );
  }

  return contentElement;
}