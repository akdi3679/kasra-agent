// src/orchestrator.ts
import { ToolsHub } from './tools/hub';
import { agentEventEmitter } from './events';
import { generateWithFallback } from './lib/llm';
import {
  getCPM, getMemoire, getSelfImproveNotes, getActiveSkills,
  updateMemoire, addSelfImproveNote, updateSelfImproveNote, deleteSelfImproveNote,
  updateSkillDecision, saveChatMessage, saveForecast, getPastForecasts,
} from './files';
import { buildSystemPrompt } from './prompts/system';
import { SelfImprover } from './memory/self-improve';
import { searchSessionFacts, getSkillStubs } from './files';
import { askConfirmation } from './confirmation';
import { traceAgentStep, traceSessionOutcome } from './lib/arize';
// ── Types ──────────────────────────────────────────────────────────────────────
interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AIResponse {
  output:    string;
  reason?:   string;
  notes?:    any[];
  commands?: any[];
}

interface SessionState {
  systemPrompt: string;
  history:      HistoryMessage[];
  envChanges:   string[];
  createdAt:    number;
  lastActiveAt: number;
}

// ── Module-level state ─────────────────────────────────────────────────────────
const improver       = new SelfImprover();
const sessions       = new Map<string, SessionState>();
export const stoppedSessions = new Set<string>();

const SESSION_TTL_MS      = 2 * 60 * 60 * 1000;
const SESSION_MAX_HISTORY = 8;

export const sessionSystemPrompts = { get: (id: string) => sessions.get(id)?.systemPrompt };
export const sessionHistories     = { get: (id: string) => sessions.get(id)?.history };

// ── Helpers ────────────────────────────────────────────────────────────────────

function emitState(state: string, message = '') {
  agentEventEmitter.emit('state', { type: 'state', state, message });
}
function emitTaskFor(cmd: string, status: 'done' | 'running' | 'failed', stableId?: string) {
  const id = stableId || `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  agentEventEmitter.emit('task', {
    type: 'task',
    task: { id, description: cmd, status, timestamp: new Date().toISOString() },
  });
  return id;
}
function emitTask(description: string, status: 'done' | 'running' | 'failed' = 'done', id?: string): string {
  const taskId = id || `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  agentEventEmitter.emit('task', {
    type: 'task',
    task: {
      id: taskId,
      description,
      status,
      timestamp: new Date().toISOString(),
    },
  });
  return taskId;   // <-- return the ID so callers can reuse it
}

function evictStaleSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, state] of sessions) {
    if (state.lastActiveAt < cutoff) {
      sessions.delete(id);
      console.log(`[Session] Evicted stale session: ${id}`);
    }
  }
}

function normalizeToTableArgs(args: any): any {
  if (!args?.rows || !Array.isArray(args.rows)) return args;
  const FIELD_MAP: Record<string, string[]> = {
    'Product':  ['product_name', 'name', 'Product', 'title'],
    'Qty':      ['quantity', 'qty', 'Qty', 'stock'],
    'Min Qty':  ['min_quantity', 'min_qty', 'Min Qty', 'minimum'],
    'Price':    ['unit_price', 'price', 'Price', 'cost'],
  };
  const columns: string[] = args.columns ?? [];
  const normalized = args.rows.map((row: any) => {
    if (Array.isArray(row)) return row;
    return columns.map(col => {
      const candidates = FIELD_MAP[col] ?? [col, col.toLowerCase()];
      for (const key of candidates) {
        if (row[key] !== undefined) return row[key];
      }
      return '';
    });
  });
  return { ...args, rows: normalized };
}

function buildAttachment(result: string, toolName: string): string {
  const urlMatch = result.match(/(https?:\/\/[^\s"'<>]+)/);
  const url  = urlMatch?.[1] ?? '';
  const name = url ? url.split('/').pop() || 'download' : 'download';
  return `[ATTACHMENT]${name}|${url}|${toolName}[/ATTACHMENT]`;
}

function parseAIResponse(raw: string): AIResponse | null {
  // Step 1: strip markdown fences the LLM sometimes wraps around JSON
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Step 2: try direct parse first — this handles all normal responses including
  // large to_html payloads. The old regex fallback choked on big HTML strings.
  try {
    const obj = JSON.parse(stripped);
    if (obj && typeof obj === 'object') {
      // Normalise bare { tool, args } → full response shape
      if (obj.tool && !obj.commands) {
        return { output: obj.output || '', reason: obj.reason || '', notes: obj.notes || [], commands: [{ tool: obj.tool, args: obj.args || {} }] };
      }
      if (obj.read && !obj.tool && !Array.isArray(obj.commands)) {
        return { output: obj.output || '', reason: obj.reason || '', notes: obj.notes || [], commands: [{ read: obj.read }] };
      }
      // Standard full response — return as-is
      return obj as AIResponse;
    }
  } catch {}

  // Step 3: LLM added prose before/after the JSON — find the outermost { } by
  // scanning character-by-character (handles large nested strings correctly,
  // unlike the old recursive regex which truncated big HTML payloads).
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (esc)               { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"')        { inStr = !inStr; continue; }
    if (inStr)             continue;
    if (ch === '{')        { if (depth++ === 0) start = i; }
    else if (ch === '}')   { if (--depth === 0 && start !== -1) {
      try { return JSON.parse(stripped.slice(start, i + 1)) as AIResponse; } catch {}
      start = -1;
    }}
  }

  return null;
}

// ── Orchestrator ───────────────────────────────────────────────────────────────

export class Orchestrator {
  private tools = new ToolsHub();
  get toolsHub() { return this.tools; }

async process(goal: string, sessionId = 'default', preferredModel?: string, preferredTool?: string): Promise<string> {    console.log(`\n[Orchestrator] goal="${goal}" session="${sessionId}"`);
    emitState('thinking', 'Planning...');

    evictStaleSessions();

    const isCronTask   = sessionId.startsWith('cron_');
    const isNewSession = !sessions.has(sessionId);

   if (isNewSession) {
  const basePrompt = buildSystemPrompt(
  getCPM(),
  getMemoire(),
  getSelfImproveNotes() as any[],
  getActiveSkills() as any[],
  [],   // agents (empty – you don’t have that feature yet)
);
  const systemPrompt = isCronTask
    ? `[CRON TASK — execute directly, stop immediately after.]\nTask ID: ${sessionId.replace('cron_', '')}\n\n${basePrompt}`
    : basePrompt;

  const history: HistoryMessage[] = [];

  if (!isCronTask) {
    // Search episodic memory for facts relevant to this goal
    const relevantFacts = searchSessionFacts(goal, 3) as any[];
    if (relevantFacts.length > 0) {
      history.push({
        role: 'user',
        content: '[EPISODIC MEMORY — relevant past context]\n' +
          relevantFacts.map((f: any) => `• ${f.fact}`).join('\n'),
      });
    }

    const skills = getActiveSkills() as any[];
    const si     = getSelfImproveNotes() as any[];
    if (skills.length > 0 || si.length > 0) {
      const parts: string[] = ['[ENV LOADED]'];
      if (skills.length > 0) parts.push('\n--- Skills ---\n' + skills.map((s: any) => `[${s.id}] ${s.method_prompt}`).join('\n'));
      if (si.length > 0)     parts.push('\n--- Self-Improve ---\n' + si.slice(0, 5).map((n: any) => `[${n.id}] ${n.note}`).join('\n'));
      history.push({ role: 'user', content: parts.join('') });
    }
  }

  sessions.set(sessionId, {
    systemPrompt,
    history,
    envChanges: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });

  console.log(`[Session] Created "${sessionId}" — prompt ${systemPrompt.length} chars`);
}

const session = sessions.get(sessionId)!;
session.lastActiveAt = Date.now();

const { systemPrompt, history, envChanges } = session;

if (history.length > SESSION_MAX_HISTORY) {
  history.splice(0, history.length - SESSION_MAX_HISTORY);
}

if (!isCronTask && history.some(h => h.role === 'user' && h.content === goal)) {
  console.log(`[Session] Duplicate goal detected — resetting history for "${sessionId}"`);
  history.length = 0;
  envChanges.length = 0;
}

let userContent = goal;
if (envChanges.length > 0 && !isNewSession) {
  userContent = `[ENV UPDATE: ${envChanges.join(', ')} changed]\n\n${goal}`;
  envChanges.length = 0;
}
history.push({ role: 'user', content: userContent });

// ── Progressive output cache ──────────────────────────────────────────────
const partialOutputs: string[] = [];

    // ── FIX 1: Cross-turn completed-steps tracker ─────────────────────────────
    // Tracks tools that have already succeeded in previous turns so we can:
    //   a) block the LLM from re-running them
    //   b) inject an explicit [TASK STATE] ledger into every feedback message
    //      so small models never lose track of where they are in the pipeline
    const completedTools: string[] = [];

    // ── FIX 2: Ledger builder — injected into EVERY feedback message ──────────
    // This implements "chain-of-states" for small models: rather than expecting
    // the model to infer progress from raw history, we tell it explicitly which
    // steps are done and which are still pending.
    function buildStateLedger(): string {
      if (completedTools.length === 0) return '';
      return (
        `\n\n[TASK STATE]\n` +
        `Completed: ${completedTools.map(t => `✅ ${t}`).join(' | ')}\n` +
        `RULE: Do NOT call any completed tool again. Find the first PENDING step and emit ONLY that.`
      );
    }

    // ── Agentic loop ──────────────────────────────────────────────────────────
    const MAX_TURNS = 15;
    let   finalOutput  = '';
    let   parseRetries = 0;   // per-pipeline parse-failure retry counter
    const MAX_PARSE_RETRIES = 3;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (stoppedSessions.has(sessionId)) {
        stoppedSessions.delete(sessionId);
        finalOutput = '⏹️ Task stopped.';
        break;
      }

      console.log(`[Loop] Turn ${turn + 1}/${MAX_TURNS}`);
      improver.tickTurn();

      // Periodic memory nudge — agent curates what's worth keeping
      if (improver.shouldNudge() && !isCronTask) {
        improver.nudge(history, sessionId).catch(() => {});
      }
let effectiveSystemPrompt = systemPrompt;
if (preferredTool) {
const toolMeta = this.tools.getToolsMetadata().find(t => t.name === preferredTool);
const friendly = toolMeta?.friendly || preferredTool;
effectiveSystemPrompt += `\n\n[SYSTEM NOTE: The user has selected the tool "${preferredTool}" (${friendly}) for this request. Your next command should use this tool if it is even slightly relevant. Only skip it if it is completely impossible to use.]`;

} 
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        ...history,
      ];
const raw = await generateWithFallback(messages, preferredModel);
      console.log(`[AI raw] Turn ${turn + 1} — first 300 chars: ${raw.slice(0, 300)}`);

      let ai = parseAIResponse(raw);

      if (!ai) {
        parseRetries++;
        console.log(`[Loop] Turn ${turn + 1} — parse failure #${parseRetries}/${MAX_PARSE_RETRIES}. Pipeline active: ${completedTools.length > 0}`);

        if (parseRetries <= MAX_PARSE_RETRIES) {
          // Always retry with explicit format reminder, regardless of pipeline state.
          // NEVER bail into partialOutputs mid-pipeline — the PDF still needs to run.
          const ledger = buildStateLedger();
          history.push({
            role: 'user',
            content:
              `Your last response was not valid JSON. You MUST reply with exactly ONE JSON object — no markdown, no prose.\n` +
              `{ "output": "", "reason": "", "notes": [], "commands": [{ "tool": "NEXT_TOOL", "args": {} }] }` +
              (ledger ? `\n\nReminder of task progress:${ledger}\n\nEmit the NEXT pending tool now.` : ''),
          });
          emitState('thinking', 'Retrying...');
          continue;
        }

        // All retries exhausted — only flush partialOutputs if pipeline is truly done
        // (no completedTools means nothing ran, safe to bail; with completedTools we
        // tried hard and gave up — show what we have rather than a blank error)
        if (partialOutputs.length > 0) {
          finalOutput = partialOutputs.join('\n\n');
          history.push({ role: 'assistant', content: finalOutput });
          break;
        }
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'assistant' && history[i].content?.trim()) {
            finalOutput = history[i].content;
            break;
          }
        }
        if (!finalOutput) finalOutput = '⚠️ Sorry, an internal error occurred. Please try again.';
        history.push({ role: 'assistant', content: finalOutput });
        break;
      }

      // Successful parse — reset the retry counter
      parseRetries = 0;

      // Emit a compact reasoning step for the UI timeline (max 80 chars)
      agentEventEmitter.emit('reasoning_step', {
        type: 'reasoning_step',
        turn: turn + 1,
        reason: (ai.reason ?? '').slice(0, 80) || `Turn ${turn + 1}`,
        commands: (ai.commands ?? []).map((c: any) => c.tool || 'read').filter(Boolean),
        output: (ai.output ?? '').slice(0, 60),
      });

// Trace this step with arize
      if (typeof traceAgentStep === 'function') {

traceAgentStep({
  turn: turn + 1,
  sessionId,
  goal,
  reason: ai.reason || '',
  commands: ai.commands?.map((c: any) => c.tool || 'read') || [],
  output: ai.output || '',
  status: 'success',
}); }
      if (!Array.isArray(ai.commands) && (ai as any).tool) {
        ai = { output: ai.output || '', reason: ai.reason || '', notes: ai.notes || [], commands: [{ tool: (ai as any).tool, args: (ai as any).args || {} }] };
      }

      if (!Array.isArray(ai.notes)) ai.notes = [];

      const massDelete = ai.notes.filter((n: any) => n.file === 'self_improve' && n.action === 'delete');
      if (massDelete.length > 3) {
        ai.notes = ai.notes.filter((n: any) => !(n.file === 'self_improve' && n.action === 'delete'));
      }

      if (ai.notes.length > 0) {
        const changed = await this.applyNotes(ai.notes);
        if (changed.length > 0) envChanges.push(...changed);
      }

      const commands = ai.commands ?? [];

      // ── FIX 3: Guard against premature empty-commands exit ────────────────
      // Small models sometimes emit {"output":"","commands":[]} when confused
      // mid-pipeline. If we have cached outputs but no final summary text,
      // this is NOT a real "done" — push back and demand the next step.
     if (commands.length === 0) {
        // ── CONVERSATIONAL INTENT DETECTION ────────────────────────────────────
        // Problem: nudge was firing on legitimate greetings/questions, causing the
        // agent to invent work (get_inventory→table→chart→pdf for "hi").
        // Fix: classify the goal before deciding whether to nudge.
 
        const pipelineActive  = completedTools.length > 0 || partialOutputs.length > 0;
        const pipelineExpected = /table|chart|excel|pdf|export|show.*and|generate.*report|create.*pdf/i.test(goal);
 const isChat = /^(hi+|hello|hey|how are|how r|what'?s up|sup|yo|howdy|good (morning|evening|night|day)|thanks?|thank you|ok+|okay|sure|cool|great|nice|bye|goodbye|salut|مرحبا|أهلاً|كيف حال|شكراً|صباح|مساء|i said|i just|just|nothing|nada|nm|not much)\b/i.test(goal.trim());
        // Case A: Model gave a real text answer and nothing is running → done
        if (ai.output?.trim() && !pipelineActive) {
          finalOutput = ai.output.trim();
          history.push({ role: 'assistant', content: finalOutput });
          console.log('[Loop] Conversational response — done.');
          break;
        }
 
        // Case B: Greeting/chat with empty output → single clean retry, no tool forcing
        if (isChat && !pipelineActive && turn <= 1) {
          history.push({
            role: 'user',
            content: 'This is a casual conversational message. Reply naturally in "output" with a short friendly response. Set "commands": []. Do NOT call any tools.',
          });
          emitState('thinking', 'Responding...');
          continue;
        }
 
        // Case C: Mid-pipeline stall → nudge to continue
        if (!ai.output?.trim() && pipelineActive) {
          console.log(`[Loop] Turn ${turn + 1} — mid-pipeline stall. Nudging.`);
          history.push({
            role: 'user',
            content:
              `You returned commands:[] with empty output, but the pipeline is NOT done.` +
              buildStateLedger() +
              `\n\nEmit the NEXT pending step now. Do not stop until all steps are complete.`,
          });
          emitState('thinking', 'Nudging model...');
          continue;
        }
 
        // Case D: Pipeline expected but nothing started yet (first turn empty)
        if (pipelineExpected && !pipelineActive && !ai.output?.trim() && turn === 0) {
          console.log(`[Loop] Turn ${turn + 1} — pipeline expected but not started. Nudging.`);
          history.push({
            role: 'user',
            content: `You returned empty commands and empty output. This request requires tool execution. Emit the FIRST required tool now.`,
          });
          emitState('thinking', 'Nudging model...');
          continue;
        }
 
        // Case E: Genuine done (output set or partials exist)
               // Case E: Genuine done – use ONLY the AI's text summary
        finalOutput = ai.output?.trim() || '✅ Done.';
        history.push({ role: 'assistant', content: finalOutput });
        break;
      }

      // ── Execute commands ──────────────────────────────────────────────────
      // ── Execute commands ──────────────────────────────────────────────────
      emitState('using_tools', `Executing ${commands.length} command(s)...`);

      const rawResults:    string[] = [];
      const attachments:   string[] = [];
      let   renderedContent         = '';
      const turnSucceeded           = new Set<string>(); // same-turn dupe guard

      for (const cmd of commands) {
        if (stoppedSessions.has(sessionId)) break;

        if (cmd.to_table && !cmd.tool) { cmd.tool = 'to_table'; cmd.args = cmd.to_table; }

        if (cmd.tool) {
          const DANGEROUS_TOOLS = ['db_update', 'delete_cron', 'send_email', 'desktop_control'];
          if (DANGEROUS_TOOLS.includes(cmd.tool)) {
            agentEventEmitter.emit('confirmation_required', {
              type: 'confirmation_required',
              sessionId,
              tool: cmd.tool,
              args: cmd.args,
            });

            const approved = await askConfirmation(sessionId, cmd.tool, JSON.stringify(cmd.args));
            if (!approved) {
              rawResults.push(`❌ User denied execution of ${cmd.tool}`);
              continue;
            }
          }

          // Same-turn dupe guard
          if (turnSucceeded.has(cmd.tool)) continue;

          // Cross-turn dupe guard
          if (completedTools.includes(cmd.tool)) {
            console.log(`[CMD] SKIP (already done): ${cmd.tool}`);
            rawResults.push(
              `[SKIP:${cmd.tool}] This tool already ran successfully in a previous turn. ` +
              `Do NOT call it again. Move to the next pending step.`
            );
            continue;
          }

          if (isCronTask && ['schedule_task','pause_cron','resume_cron','stop_cron','delete_cron','update_cron','list_crons'].includes(cmd.tool)) continue;

          if (cmd.tool === 'to_table') cmd.args = normalizeToTableArgs(cmd.args);

          console.log(`[CMD] tool=${cmd.tool}`, JSON.stringify(cmd.args ?? {}).slice(0, 200));

          // 🔁 Emit a unique running task for THIS tool
          const toolTaskId = emitTask(cmd.tool, 'running');

          const result = await this.tools.call(cmd.tool, cmd.args ?? {});
          rawResults.push(`[TOOL:${cmd.tool}]\n${result}`);
          turnSucceeded.add(cmd.tool);
// ── Desktop agent not installed – immediately tell the user ────────
if (result.startsWith('⚠️ LOCAL AGENT REQUIRED')) {
  finalOutput = result;
  break;
}
          // 🔁 Update the same task entry with done/failed
          emitTask(cmd.tool, result.startsWith('❌') ? 'failed' : 'done', toolTaskId);

          if (cmd.tool === 'schedule_task' && !result.startsWith('❌')) {
            finalOutput = result;
            history.push({ role: 'assistant', content: finalOutput });
            console.log('[Loop] schedule_task succeeded — done.');
            break;
          }

          const fileReadTools = ['read_local_file', 'list_local_directory'];
          if (
            /read|show|list.*file|list.*folder|package\.json/i.test(goal) &&
            fileReadTools.includes(cmd.tool) &&
            !result.startsWith('❌')
          ) {
            finalOutput = await this.formatFileReadResult(cmd.tool, result);
            history.push({ role: 'assistant', content: finalOutput });
            break;
          }

          if (cmd.tool === 'web_search' && (result.includes('"results":[]') || result.includes('No results found'))) {
            finalOutput = 'No web results found for that query.';
            history.push({ role: 'assistant', content: finalOutput });
            break;
          }

          if (cmd.tool === 'analyze_project' && cmd.args?.patterns) {
            try {
              const tr = JSON.parse(result);
              const cs = tr.customSearches || {};
              const names = Object.keys(cs);
              if (names.length > 0) {
                const rows = names.flatMap(name =>
                  (cs[name] as string[]).map((match, i) => [name, String(i + 1), match.slice(0, 120)])
                );
                finalOutput = await this.tools.call('to_table', {
                  title: 'Pattern search results',
                  columns: ['Pattern', '#', 'Match'],
                  rows,
                });
                history.push({ role: 'assistant', content: finalOutput });
                break;
              }
            } catch {}
          }

         if ((cmd.tool === 'to_table' || cmd.tool === 'to_html') && !result.startsWith('❌')) {
    completedTools.push(cmd.tool);
    // Keep the original HTML for charts (to_html); tables are already clean
    const partialContent = cmd.tool === 'to_html' ? result : result;
    partialOutputs.push(partialContent);
    agentEventEmitter.emit('partial_output', {
        type: 'partial_output',
        content: partialContent,
        sessionId,
        tool: cmd.tool,
    });
    renderedContent = `${cmd.tool} rendered successfully.`;
    continue;
}
          if (cmd.tool === 'execute_python' && !result.startsWith('❌')) {
            const escaped = result.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const pyHtml = `<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:12px 16px;font-family:'Fira Code',monospace;font-size:13px;color:#a5f3a5;white-space:pre-wrap;overflow-x:auto;">${escaped}</div>`;
            completedTools.push(cmd.tool);
            partialOutputs.push(pyHtml);
            agentEventEmitter.emit('partial_output', { type: 'partial_output', content: pyHtml, sessionId, tool: cmd.tool });
            renderedContent = 'execute_python rendered successfully.';
            continue;
          }

          const fileGenTools = ['export_excel', 'generate_pdf', 'create_ical_event', 'live_screen'];
          if (fileGenTools.includes(cmd.tool) && !result.startsWith('❌')) {
            completedTools.push(cmd.tool);
            const att = buildAttachment(result, cmd.tool);
            partialOutputs.push(att);
            attachments.push(att);
            agentEventEmitter.emit('partial_output', { type: 'partial_output', content: att, sessionId, tool: cmd.tool });
            continue;
          }

        } else if (cmd.read !== undefined) {
          const label = typeof cmd.read === 'string'
            ? cmd.read
            : `${cmd.read.file}.${cmd.read.section ?? '*'}`;
          console.log(`[CMD] read=${label}`);
          const content = typeof cmd.read === 'object' && cmd.read.file === 'prompt_section'
            ? (() => { try { const { getPromptSection } = require('./prompts/system'); return getPromptSection(cmd.read.section || ''); } catch { return ''; } })()
            : await this.readEnvFile(cmd.read);
          rawResults.push(`[READ:${label}]\n${content}`);
        }
      } // end command loop     

      if (finalOutput) break;

      // ── Post-command assembly ─────────────────────────────────────────────
      if (attachments.length > 0) {
        const parts: string[] = [];
        if (ai.output?.trim()) parts.push(ai.output);
        if (renderedContent)   parts.push(renderedContent);
        parts.push(...attachments);
        history.push({ role: 'assistant', content: parts.join('\n\n') });
        history.push({
          role: 'user',
          content:
            `Step completed successfully.\n\nResults:\n${rawResults.join('\n\n')}` +
            buildStateLedger() +
            `\n\nContinue to the next pending step. When ALL steps in the original request are done, write a natural confident message in "output": briefly describe what was produced, note any interesting insight from the data (e.g. lowest stock item), speak like a sharp operator not a status reporter. Then set "commands": [].`,
        });
        emitState('thinking', 'Next step...');
        continue;
      }

      if (renderedContent) {
       history.push({ role: 'assistant', content: renderedContent });
        history.push({
          role: 'user',
          content:
            `Display step completed successfully.` +
            buildStateLedger() +
            `\n\nContinue to the next pending step in the original request. When ALL steps are done, write a natural confident message in "output": briefly describe what was produced, add a useful observation from the data if relevant. Speak like a sharp operator, not a status reporter. Then set "commands": [].`,
        });
        emitState('thinking', 'Next step...');
        continue;
      }

      // Standard pass-back
      history.push({
        role: 'user',
        content:
          `Command results:\n\n${rawResults.join('\n\n')}` +
          buildStateLedger() +
          `\n\nIf all steps are complete, set "output" and "commands": []. If not, continue to the next step. If there was an error, retry.`,
      });
      emitState('thinking', 'Processing results...');

    } // end turn loop
    if (!finalOutput) {
      finalOutput = 'Sorry, I was unable to complete the task. Please try again.';
    }

    emitState('idle', '');
    // Save user message first, then ALL assistant content in correct order.
    // partialOutputs (tables/charts/files) come before the text summary — same
    // order the user saw them arrive via SSE.
saveChatMessage(sessionId, 'user', goal);

for (const partial of partialOutputs) {
  saveChatMessage(sessionId, 'assistant', partial);
}
// Remove all <script> and <style> blocks (and their content)
finalOutput = finalOutput
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');

// Then strip any remaining HTML tags to leave only plain text
const textSummary = finalOutput.replace(/<[^>]*>/g, '').trim();
if (textSummary && !partialOutputs.includes(textSummary)) {
  saveChatMessage(sessionId, 'assistant', textSummary);
}

finalOutput = textSummary || '✅ Done.';
    // Evaluate completed session for autonomous skill creation
    if (!isCronTask && finalOutput && finalOutput !== '⏹️ Task stopped.') {
      const toolsUsed = history
        .filter(h => h.role === 'user' && h.content.startsWith('Command results:'))
        .flatMap(h => {
          const matches = h.content.match(/\[TOOL:([^\]]+)\]/g) ?? [];
          return matches.map((m: string) => m.replace(/\[TOOL:|\]/g, ''));
        });
      const hadError   = history.some(h => h.content.includes('❌'));
      const hadCorrection = history.some(h =>
        h.role === 'user' && /wrong|incorrect|not right|fix that|redo/i.test(h.content)
      );
      improver.evaluateSession({
        sessionId, goal, toolsUsed, hadError, hadCorrection,
        turnCount: history.length,
        finalOutput,
      }).catch(() => {});
    }


    Promise.resolve(getPastForecasts(20) as any[])
      .then(p => improver.evaluate(p))
      .catch(() => {});

    for (const f of this.extractForecasts(finalOutput)) saveForecast(f);

    if (finalOutput.trim().startsWith('<') && /<\/?[a-zA-Z]/.test(finalOutput) && !finalOutput.includes('<!DOCTYPE')) {
      finalOutput = `<!DOCTYPE html><html lang="ar"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><style>body{margin:0;font-family:'Segoe UI';background:#0f172a;padding:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #334155;padding:8px 12px}th{background:#1e293b;color:#93c5fd}tr:nth-child(even){background:#1e293b}</style></head><body>${finalOutput}</body></html>`;
    }
// Trace the final session outcome
traceSessionOutcome({
  sessionId,
  goal,
  toolsUsed: completedTools,
  turnCount: Math.floor(history.length / 2),
  outcome: finalOutput.startsWith('Sorry') ? 'failed' : 'success',
});
    return finalOutput;
  }

  private async applyNotes(notes: any[]): Promise<string[]> {
    const changed: string[] = [];
    for (const note of notes) {
      if (!note?.file || note.action === 'read') continue;

      if (note.file === 'memoire') {
        const content = note.content || note.text || note.value || '';
        if (!content && note.action !== 'delete') continue;
        await updateMemoire(note.section, content, note.action ?? 'append');
        changed.push(`memoire.${note.section}`);
        if (note.section === 'client') {
          const mem = getMemoire();
          if (mem.client) {
            const lines = mem.client.split('\n').filter((l: string) => l.trim());
            if (lines.length > 5) await updateMemoire('client', lines.slice(-5).join('\n'), 'replace');
          }
          try { await new ToolsHub().call('save_to_memory', { text: `Client: ${content}` }); } catch {}
        }
      } else if (note.file === 'self_improve') {
        if (note.action === 'delete' && note.id)              { await deleteSelfImproveNote(Number(note.id)); changed.push('self_improve'); }
        else if (note.action === 'edit' && note.id && note.note) { await updateSelfImproveNote(Number(note.id), note.note); changed.push('self_improve'); }
        else if (note.note)                                   { await addSelfImproveNote(note.note, note.category ?? 'general'); changed.push('self_improve'); }
      } else if (note.file === 'skill_decision') {
        await updateSkillDecision(Number(note.skillId), note.decision ?? '');
        changed.push('skills');
      }
    }
    return changed;
  }

  private async readEnvFile(spec: any): Promise<string> {
    const name    = typeof spec === 'string' ? spec : spec.file;
    const section = typeof spec === 'object'  ? spec.section : undefined;
    switch (name) {
      case 'cpm':          return getCPM();
      case 'memoire':      { const m = getMemoire(); return section ? (m[section] ?? '') : JSON.stringify(m); }
      case 'self_improve': return JSON.stringify(getSelfImproveNotes());
      case 'skills':       return JSON.stringify(getActiveSkills());
      default:             return `❌ Unknown env file: ${name}`;
    }
  }

  private async formatFileReadResult(tool: string, result: string): Promise<string> {
    try {
      const parsed = JSON.parse(result);
      if (tool === 'list_local_directory') {
        const entries = parsed.entries || [];
        const rows = entries.map((e: any) => [e.type === 'dir' ? '📁' : '📄', e.name, e.type]);
        return await this.tools.call('to_table', {
          title: `📂 ${parsed.path || ''}`,
          columns: ['', 'Name', 'Type'],
          rows,
        });
      }
      if (parsed.path && parsed.content) {
        const esc = parsed.content
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<!DOCTYPE html><html lang="ar"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css"><script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script><script>hljs.highlightAll();</script><style>body{margin:0;font-family:'Segoe UI';background:#0f172a;padding:16px}.card{background:rgba(30,41,59,0.8);border:1px solid #334155;border-radius:16px;overflow:hidden}.header{background:linear-gradient(135deg,#2563eb,#7c3aed);padding:12px 16px;font-size:14px;font-weight:600;color:white}.body{padding:12px 16px}pre{margin:0;border-radius:8px;overflow-x:auto;max-height:400px}code{font-family:'Fira Code',monospace;font-size:13px}</style></head><body><div class="card"><div class="header">📄 ${parsed.path}</div><div class="body"><pre><code class="language-json">${esc}</code></pre></div></div></body></html>`;
      }
    } catch {}
    return result;
  }

  private extractForecasts(text: string): { productName: string; predictedDays: number }[] {
    const out: { productName: string; predictedDays: number }[] = [];
    const re = /([\u0600-\u06FF\w\s]+?)\s+will run out in\s+(\d+)\s+days/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ productName: m[1].trim(), predictedDays: parseInt(m[2]) });
    return out;
  }

  getToolsList(): string[] { return this.tools.listToolsSync(); }
}