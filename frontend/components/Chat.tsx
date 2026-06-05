'use client';
import { useEffect, useRef, useState } from 'react';
import { Results } from './Results';
import { Copy, Check } from 'lucide-react';
import { ReasoningTimeline } from './ReasoningTimeline';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  isCron?: boolean;
  reasoningSteps?: { turn: number; reason: string; commands: string[]; output: string }[];
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUser = msg.role === 'user';

  // ── Detect if content is a rich visual (HTML/table/attachment) ──────────────
  // These render via <Results> which handles iframes, attachments, etc.
  // Plain text messages render as whitespace-preserved text.
  const isRichContent =
    msg.content.includes('<!DOCTYPE') ||
    msg.content.includes('<html') ||
    msg.content.includes('[ATTACHMENT]') ||
    msg.content.startsWith('<div') ||
    msg.content.startsWith('<pre');

  return (
    <div
      className={`flex w-full mb-6 ${isUser ? 'justify-start' : 'justify-end'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`relative ${isUser ? 'max-w-[85%]' : isRichContent ? 'w-full' : 'max-w-[85%]'}`}>
        <div
          className={`px-4 py-2 rounded-2xl text-sm overflow-hidden ${
            msg.isCron
              ? 'border-l-2 border-emerald-400 bg-emerald-500/10 text-emerald-100'
              : isUser
                ? 'bg-blue-500 text-white'
                : isRichContent
                  ? 'bg-transparent p-0'                        // visuals: no bubble wrapper
                  : 'backdrop-blur-md bg-white/5 border border-white/10 text-black'
          }`}
        >
          {msg.isCron && (
            <div className="text-xs text-emerald-400 font-mono mb-1">⏰ Scheduled task</div>
          )}

          {msg.role === 'assistant' && !msg.isCron ? (
            isRichContent
              ? <Results text={msg.content} />                  // rich: iframe/card
              : <div className="whitespace-pre-wrap">{highlightText(msg.content.replace(/<[^>]*>/g, ''))}</div>  // text: plain
          ) : (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          )}
        </div>

        {/* Reasoning timeline — only on assistant text messages */}
        {msg.role === 'assistant' && !isRichContent && msg.reasoningSteps && msg.reasoningSteps.length > 0 && (
          <ReasoningTimeline steps={msg.reasoningSteps} />
        )}

        {/* Copy button */}
        {!isRichContent && (
          <div
            className={`absolute -bottom-5 right-2 transition-opacity duration-150 ${
              hovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-slate-800/80 rounded-full px-2 py-0.5"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
function highlightText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\{\{(danger|warn|good)\}\}(.*?)\{\{\/\1\}\}/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    const type = match[1];
    const value = match[2];
    
    const colors = {
      danger: 'bg-red-500/70 text-black px-1.5 py-0.5 ',
      warn:   'bg-yellow-300/70 text-black px-1.5 py-0.5  ',
      good:   'bg-green-400/70 text-black px-1.5 py-0.5 ',
    };
    
    parts.push(
      <span key={match.index} className={colors[type as keyof typeof colors]}>
        {value}
      </span>
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : text;
}
export function ChatHistory({
  messages,
  loading,
  loadingReason,
}: {
  messages: ChatMessage[];
  loading: boolean;
  loadingReason?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div className="w-full max-w-2xl mx-auto px-4 mt-4 pb-4 border border-white/10 rounded-2xl bg-white/10 backdrop-blur-sm overflow-visible">
      <div className="flex items-center justify-end mb-2 pt-2 px-2">
        <span className="text-xs text-slate-400">{messages.length} messages</span>
      </div>

      {messages.map(msg => (
        <MessageBubble key={msg.id} msg={msg} />
      ))}

      {/* Loading indicator — shows current AI reason */}
      {loading && (
        <div className="flex justify-end mb-3">
          <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            <span className="text-xs text-slate-400">
              {loadingReason ? loadingReason.slice(0, 60) : 'Thinking...'}
            </span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}