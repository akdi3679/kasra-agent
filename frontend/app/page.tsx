'use client';

import { useState, useEffect , useRef } from 'react';
//import { CommandOverlay } from '@/components/CommandOverlay';
import { ToolTester } from '@/components/ToolTester';
import { TaskLog } from '@/components/TaskLog';
import { InputArea } from '@/components/InputArea';
import { ChatHistory, ChatMessage } from '@/components/Chat';
import { CronNotification } from '@/components/CronNotification';
import { Dashboard } from '@/components/Dashboard';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { Zap, ListTodo, BarChart3, MessageSquare } from 'lucide-react';
import { Results } from '@/components/Results';
import { Dock } from '@/components/Dock';
import { RequestLocalFileListener } from '@/components/RequestLocalFileListener';

import { BlobAvatar, BlobState } from '@/components/BlobAvatar';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { BookOpen, Brain, Target, NotebookPen, Wrench, Clock } from 'lucide-react';
import { SessionSlidePanel } from '@/components/SessionSlidePanel';
export default function Home() {
 const { blobState, taskLog, cronResults, partialOutputs, latestReason, reasoningSteps, resetSession , statusMessage, currentTool } = useAgentEvents();

  const [showCron, setShowCron] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('default');
  const [showSessions, setShowSessions] = useState(false);
const [confirmRequest, setConfirmRequest] = useState<any>(null);
const [sessions, setSessions] = useState<any[]>([]);
const lastAssistantRef = useRef('');

  // Listen for confirmation requests
  useEffect(() => {
    const handler = (e: any) => setConfirmRequest(e.detail);
    window.addEventListener('Kasra_confirm', handler);
    return () => window.removeEventListener('Kasra_confirm', handler);
  }, []);

  
  useEffect(() => {
    const saved = localStorage.getItem('Kasra-session');
    if (saved) setSessionId(saved);
  }, []);


useEffect(() => {
  fetch('https://kasra-agent.onrender.com/api/sessions')
    .then(r => r.json())
    .then(data => setSessions(data || []))
    .catch(() => {});
}, [sessionId, messages]); // reload when messages change
  useEffect(() => {
    localStorage.setItem('Kasra-session', sessionId);
  }, [sessionId]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const res = await fetch(
          `https://kasra-agent.onrender.com/api/chat-history?sessionId=${sessionId}&limit=100`
        );
        const data = await res.json();
       // No filter – keep all messages
const msgs: ChatMessage[] = (data || []).map((m: any) => ({
    id: String(m.id),
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    isCron: m.content?.startsWith('[CRON_RESULT') || false,
}));
setMessages(msgs);
      } catch (err) {
        console.error('Failed to load chat history:', err);
      }
    };
    loadHistory();
  }, [sessionId]);

  useEffect(() => {
    if (cronResults.length > 0) {
      const latest = cronResults[0];
      const cronMsg: ChatMessage = {
        id: `cron_live_${latest.task_id}_${Date.now()}`,
        role: 'assistant',
        content: latest.output,
        timestamp: new Date().toISOString(),
        isCron: true,
      };
      setMessages(prev => [...prev, cronMsg]);
    }
  }, [cronResults]);

useEffect(() => {
  const handler = (e: CustomEvent) => {
    const { action, target } = e.detail;
    const toast = document.createElement('div');
    toast.innerText = `🖥️ Kasra is executing: ${action} ${target || ''}`;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', color: '#e2e8f0', padding: '8px 16px',
      borderRadius: '8px', zIndex: '99999', fontSize: '13px',
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };
  window.addEventListener('kasra_desktop_action', handler as EventListener);
  return () => window.removeEventListener('kasra_desktop_action', handler as EventListener);
}, []);
 // const [showOverlay, setShowOverlay] = useState(false);
  const [showTester, setShowTester] = useState(false);
  const [showTaskLog, setShowTaskLog] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [systemView, setSystemView] = useState<string | null>(null);
  const [systemData, setSystemData] = useState<any>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [skillsList, setSkillsList] = useState<any[]>([]);
  const [cronsList, setCronsList] = useState<any[]>([]);
  const [editingSkill, setEditingSkill] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    method_prompt: '',
    description: '',
    applies_to: 'all',
    expected_result: '',
  });
  const [editingCron, setEditingCron] = useState<number | null>(null);
  const [cronForm, setCronForm] = useState({ prompt: '', cron_expression: '* * * * *' });
const handleConfirmDecision = async (approved: boolean) => {
  if (!confirmRequest) return;
  await fetch('https://kasra-agent.onrender.com/api/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: confirmRequest.sessionId, approved }),
  });
  setConfirmRequest(null);
};
  const handleRun = async (  displayGoal: string,
  combinedGoal: string,
  preferredModel?: string | null,
  preferredTool?: string | null,
  ) => {
  const userMsg: ChatMessage = {
    id: `user_${Date.now()}`,
    role: 'user',
    content: displayGoal,
    timestamp: new Date().toISOString(),
  };
  setMessages(prev => [...prev, userMsg]);
  setLoading(true);

  try {
    const res = await fetch('https://kasra-agent.onrender.com/api/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    goal: combinedGoal,
    sessionId,
    preferredModel,
    preferredTool,
  }),
});
    const data = await res.json();
   if (data.success && data.result) {
      const plainText = data.result.replace(/<[^>]*>/g, '').trim();
      if (plainText && plainText !== lastAssistantRef.current) {
        lastAssistantRef.current = plainText;
        setMessages(prev => [...prev, {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          content: plainText,
          timestamp: new Date().toISOString(),
        }]);
      }
    }
  } catch (err) {
    console.error('API error:', err);
  } finally {
    setLoading(false);
  }};
  const handleSwitchSession = (newSessionId: string) => {
    setSessionId(newSessionId);
    setMessages([]);
    setShowSessions(false);
  };

  const fetchSystemData = async (type: string) => {
    setSystemView(type);
    setSystemLoading(true);
    if (type === 'skills') {
      const res = await fetch('https://kasra-agent.onrender.com/api/skills');
      const data = await res.json();
      setSkillsList(data);
    } else if (type === 'crons') {
      const res = await fetch('https://kasra-agent.onrender.com/api/crons');
      const data = await res.json();
      setCronsList(Array.isArray(data) ? data : []);
    } else {
      const endpoints: Record<string, string> = {
        cpm: '/api/cpm',
        memoire: '/api/memoire',
        agents: '/api/active-agents',
        tools: '/api/tools-list',
self_improve: '/api/self-improve-notes',
      };
      const res = await fetch(`https://kasra-agent.onrender.com${endpoints[type]}`);
      const data = await res.json();
      setSystemData(data);
    }
    setSystemLoading(false);
  };

  const handleCronAction = async (id: number, action: 'pause' | 'resume' | 'stop' | 'delete') => {
    const toolMap: Record<string, string> = {
      pause: 'pause_cron', resume: 'resume_cron',
      stop: 'stop_cron',   delete: 'delete_cron',
    };
    await fetch('https://kasra-agent.onrender.com/api/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolMap[action], args: { id } }),
    });
    fetchSystemData('crons');
  };

  const handleSaveCron = async () => {
    const isNew = editingCron === 0;
    const body = isNew
      ? { tool: 'schedule_task', args: { prompt: cronForm.prompt, cron_expression: cronForm.cron_expression } }
      : { tool: 'update_cron', args: { id: editingCron, prompt: cronForm.prompt, cron_expression: cronForm.cron_expression } };
    await fetch('https://kasra-agent.onrender.com/api/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setEditingCron(null);
    fetchSystemData('crons');
  };

  const hasMessages = messages.length > 0;

  
  return (
    <main className="min-h-screen flex flex-col overflow-x-hidden">
     <CronNotification results={cronResults} />

      {hasMessages ? (
       <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-2 px-4 py-2 bg-transparent backdrop-blur-md border-b border-white/10" dir="ltr">
  <button onClick={() => setShowSessions(true)} className="text-lg font-bold bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 bg-clip-text text-transparent hover:opacity-80 transition">
    Kasra
  </button>
  <div className="w-9 h-9">
    <BlobAvatar state={blobState as BlobState} size={36} />

  </div>
</div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center pt-12">
          <div className="w-48 h-48">
            <BlobAvatar state={blobState as BlobState} />

          </div>
          <div className="text-center">
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700 bg-clip-text text-transparent">
              Kasra OS
            </h1>
            <p className="text-slate-500 text-lg font-medium -mt-2">Intelligent Business Operating System</p>
          </div>
        </div>
      )}

      {hasMessages && <div className="mt-14" />}

      <ChatHistory
        messages={messages}
        loading={loading}
        loadingReason={latestReason}
      />
      <div className="w-full max-w-2xl mx-auto px-4 mt-4">
<InputArea onRun={handleRun} blobState={blobState} statusMessage={statusMessage} currentTool={currentTool} />      </div>

<Dock activeType={systemView} onSelect={fetchSystemData} />
      {systemView && systemView !== 'skills' && systemView !== 'crons' && (
        <div className="glass-card p-4 max-w-2xl mx-auto mt-4 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-slate-800">
              {systemView === 'cpm' ? 'CPM – Tool Index' : systemView === 'memoire' ? 'Memoire – Project Memory' : systemView === 'agents' ? 'Agents – Agents' : systemView === 'self_improve' ? 'Self-Improve – Notes' : 'Tools – Tools'}
            </h3>
            <button onClick={() => setSystemView(null)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
          {systemLoading ? (
            <div className="text-center py-4 text-slate-400">Loading...</div>
          ) : (
            <pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono bg-slate-50 p-3 rounded-xl">
              {JSON.stringify(systemData, null, 2)}
            </pre>
          )}
        </div>
      )}

      {systemView === 'skills' && (
        <div className="glass-card p-4 max-w-2xl mx-auto mt-4 max-h-96 overflow-y-auto">
          <h3 className="font-semibold text-slate-800 mb-3">Skills</h3>
          <button className="mb-3 text-blue-600 text-sm hover:underline" onClick={() => { setEditingSkill(0); setEditForm({ method_prompt: '', description: '', applies_to: 'all', expected_result: '' }); }}>+Add new skill</button>
          {skillsList.map((skill: any) => (
            <div key={skill.id} className="border-b border-slate-200 py-2 flex justify-between items-start">
              <div className="flex-1"><p className="text-sm whitespace-pre-wrap">{skill.method_prompt}</p></div>
              <div className="flex gap-2 ml-2">
                <button className="text-blue-500 text-sm" onClick={() => { setEditingSkill(skill.id); setEditForm({ ...editForm, method_prompt: skill.method_prompt }); }}>✏️</button>
                <button className="text-red-500 text-sm" onClick={async () => { await fetch(`https://kasra-agent.onrender.com/api/skills/${skill.id}/toggle`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) }); fetchSystemData('skills'); }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {systemView === 'crons' && (
        <div className="glass-card p-4 max-w-2xl mx-auto mt-4 max-h-96 overflow-y-auto">
          <h3 className="font-semibold text-slate-800 mb-3">Scheduled Tasks</h3>
          <button className="mb-3 text-blue-600 text-sm hover:underline" onClick={() => { setEditingCron(0); setCronForm({ prompt: '', cron_expression: '* * * * *' }); }}>+ New Task</button>
          {cronsList.map((cron: any) => (
            <div key={cron.id} className="border-b border-slate-200 py-2 flex justify-between items-start">
              <div className="flex-1">
                <p className="text-sm font-semibold">{cron.prompt}</p>
                <p className="text-xs text-slate-500">{cron.cron_expression} — Next: {cron.next_run} — <span className={cron.status === 'active' ? 'text-emerald-600' : cron.status === 'paused' ? 'text-amber-600' : 'text-rose-600'}>{cron.status}</span></p>
              </div>
              <div className="flex gap-1 ml-2 flex-wrap">
              {cron.status === 'active' && <button className="text-amber-500 text-xs underline" onClick={() => handleCronAction(cron.id, 'pause')}>Pause</button>}
{(cron.status === 'paused' || cron.status === 'stopped') && <button className="text-emerald-500 text-xs underline" onClick={() => handleCronAction(cron.id, 'resume')}>Resume</button>}
{cron.status !== 'stopped' && <button className="text-rose-500 text-xs underline" onClick={() => handleCronAction(cron.id, 'stop')}>Stop</button>}
<button className="text-blue-500 text-xs underline" onClick={() => { setEditingCron(cron.id); setCronForm({ prompt: cron.prompt, cron_expression: cron.cron_expression }); }}>Edit</button>
<button className="text-red-500 text-xs underline" onClick={() => handleCronAction(cron.id, 'delete')}>Delete</button>

              </div>
            </div>
          ))}
        </div>
      )}

      {editingCron !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass-card p-6 w-full max-w-lg mx-4">
            <h3 className="text-lg font-semibold mb-4">{editingCron === 0 ? 'New Task' : 'Edit Task'}</h3>
            <label className="block text-sm mb-1">Prompt</label>
            <textarea className="w-full p-3 rounded-xl bg-slate-100 mb-3" rows={3} value={cronForm.prompt} onChange={e => setCronForm({ ...cronForm, prompt: e.target.value })} />
            <label className="block text-sm mb-1">Cron Expression</label>
            <input className="w-full p-2 rounded-xl bg-slate-100 mb-4" value={cronForm.cron_expression} onChange={e => setCronForm({ ...cronForm, cron_expression: e.target.value })} />
            <div className="flex gap-2">
              <button className="bg-blue-500 text-white px-4 py-2 rounded-xl" onClick={handleSaveCron}>Save</button>
              <button className="bg-slate-200 text-slate-700 px-4 py-2 rounded-xl" onClick={() => setEditingCron(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <button className="fixed top-8 right-8 z-50 w-11 h-11 rounded-full bg-white/50 backdrop-blur-md border border-gray-300 shadow-md flex items-center justify-center hover:bg-white/80 hover:scale-105 transition-all" onClick={() => setShowTaskLog(!showTaskLog)} title="Task Log"><ListTodo className="w-5 h-5 text-slate-600" /></button>
      <button className="fixed top-22 right-8 z-50 w-11 h-11 rounded-full bg-white/50 backdrop-blur-md border border-gray-300 shadow-md flex items-center justify-center hover:bg-white/80 hover:scale-105 transition-all" onClick={() => setShowDashboard(true)} title="Live Dashboard"><BarChart3 className="w-5 h-5 text-slate-600" /></button>

      <ToolTester isOpen={showTester} onClose={() => setShowTester(false)} />
      <TaskLog isOpen={showTaskLog} onClose={() => setShowTaskLog(false)} tasks={taskLog} />
      <Dashboard isOpen={showDashboard} onClose={() => setShowDashboard(false)} />
      <ConfirmationDialog request={confirmRequest} onDecision={handleConfirmDecision} />

      {/* 🔥 Confirmation Modal – uses clearConfirmation from hook */}
    <SessionSlidePanel
  currentSession={sessionId}
  onSwitchSession={handleSwitchSession}
  isOpen={showSessions}
  onClose={() => setShowSessions(false)}
  showCron={showCron}
  onToggleCron={() => setShowCron(!showCron)}
/>
<RequestLocalFileListener />

    </main>
  );
}

