'use client';
import { AlertTriangle, Check, X, Trash2, Mail, Database, Monitor } from 'lucide-react';

interface ConfirmationRequest {
  sessionId: string;
  tool: string;
  args: Record<string, any>;
}

function getToolDescription(tool: string, args: Record<string, any>) {
  switch (tool) {
    case 'db_update':
      return {
        icon: <Database className="w-5 h-5" />,
        title: 'Update inventory',
        detail: `Set product #${args.id} quantity to ${args.quantity} units`,
        color: 'text-blue-400',
      };
    case 'delete_cron':
      return {
        icon: <Trash2 className="w-5 h-5" />,
        title: 'Delete scheduled task',
        detail: `Permanently delete task #${args.id}`,
        color: 'text-red-400',
      };
    case 'send_email':
      return {
        icon: <Mail className="w-5 h-5" />,
        title: 'Send email',
        detail: `To: ${args.to} — Subject: "${args.subject}"`,
        color: 'text-emerald-400',
      };
    case 'desktop_control':
      return {
        icon: <Monitor className="w-5 h-5" />,
        title: 'Control your desktop',
        detail: `Action: ${args.action}${args.target ? ` on "${args.target}"` : ''}`,
        color: 'text-amber-400',
      };
    default:
      return {
        icon: <AlertTriangle className="w-5 h-5" />,
        title: tool.replace(/_/g, ' '),
        detail: JSON.stringify(args).slice(0, 120),
        color: 'text-slate-400',
      };
  }
}

export function ConfirmationDialog({
  request,
  onDecision,
}: {
  request: ConfirmationRequest | null;
  onDecision: (approved: boolean) => void;
}) {
  if (!request) return null;

  let args: Record<string, any> = {};
  try { args = typeof request.args === 'string' ? JSON.parse(request.args) : request.args; } catch {}

  const { icon, title, detail, color } = getToolDescription(request.tool, args);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-xl bg-white/5 ${color}`}>{icon}</div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider">Confirm action</p>
            <h3 className="text-white font-semibold text-base">{title}</h3>
          </div>
        </div>
        <p className="text-slate-300 text-sm bg-white/5 rounded-xl px-4 py-3 mb-5 font-mono">
          {detail}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => onDecision(false)}
            className="flex-1 flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl py-2.5 text-sm transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={() => onDecision(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

