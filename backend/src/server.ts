// src/server.ts
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import { Orchestrator } from './orchestrator';
import { agentEventEmitter } from './events';
import {
  getCPM,
  getMemoire,
  getSelfImproveNotes,
  getActiveSkills,
  getAllSkills, 
  createSkill,
  toggleSkill,   
  updateSkill,
  getInventory,
  getForecast,
  updateForecastActual,
  getChatHistory,
  getAllSessions,
  getAllScheduledTasks,
} from './files';
import { MODEL_REGISTRY } from './lib/llm'; 
import { Scheduler } from './core/scheduler';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { getSessionHistory } from './files';
import { confirmationEmitter } from './confirmation';
const app = express();
import { pendingCommands, completedCommands } from './tools/hub';
// ── Telegram Bot with automatic retry on 409 conflict ──────────────────
async function startTelegramBot(token: string) {
  const bot = new TelegramBot(token, { polling: { interval: 1000 } });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    await bot.sendChatAction(chatId, 'typing');
    try {
      const result = await orchestrator.process(text, `tg_${chatId}`);
      await bot.sendMessage(chatId, result);
    } catch {
      await bot.sendMessage(chatId, '❌ An error occurred while processing your request.');
    }
  });

  bot.on('polling_error', async (error: any) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
      console.warn('[Telegram] Conflict detected, restarting polling in 5s…');
      bot.stopPolling();
      await new Promise(r => setTimeout(r, 5000));
      bot.startPolling();
    } else {
      console.error('[Telegram] Polling error:', error.message);
    }
  });

  console.log('🤖 Telegram Bot ready');
  return bot;
}
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/files', express.static(path.join(process.cwd(), 'public', 'files')));
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// Ensure dirs exist
fs.mkdirSync(path.join(process.cwd(), 'public', 'files'), { recursive: true });
fs.mkdirSync(path.join(process.cwd(), 'public', 'uploads'), { recursive: true });

const orchestrator = new Orchestrator();
(async () => {
  try {
    const saved = getSessionHistory();
    for (const { sessionId, history } of saved) {
      if (!sessionId || !Array.isArray(history)) continue;
      // Directly hydrate the orchestrator's sessions map
      const sessionsMap = (orchestrator as any).sessions;  // access private field
      if (sessionsMap && !sessionsMap.has(sessionId)) {
        sessionsMap.set(sessionId, {
          systemPrompt: '',   // will be rebuilt on first process() call
          history,
          envChanges: [],
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
        });
        console.log(`[Startup] Restored ${history.length} messages for session "${sessionId}"`);
      }
    }
  } catch (e) {
    console.warn('[Startup] Could not restore sessions:', e);
  }
})();
const uploadDir = path.join(process.cwd(), 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// ── Telegram ─────────────────────────────────────────────────────
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
let telegramNotify: ((chatId: number, text: string) => Promise<void>) | undefined;

if (telegramToken) {
  startTelegramBot(telegramToken);
} else {
  console.log('⚠️ No TELEGRAM_BOT_TOKEN – Telegram disabled');
}

// ── Scheduler ─────────────────────────────────────────────────────
new Scheduler(orchestrator, telegramNotify);

// ── SSE: Real-time events ─────────────────────────────────────────
app.get('/api/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx passthrough
  });

  // Send initial connected event WITH type field
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const listener = (evt: any) => {
    // Ensure type field always present for frontend hook
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };
agentEventEmitter.on('screenshot', listener);
  agentEventEmitter.on('state', listener);
  agentEventEmitter.on('agent_step', listener);
  agentEventEmitter.on('tool_start', listener);
  agentEventEmitter.on('tool_end', listener);
  agentEventEmitter.on('task', listener);
  agentEventEmitter.on('cron_result', listener);
  agentEventEmitter.on('partial_output', listener);
agentEventEmitter.on('request_local_file', listener);

// When read_local_file succeeds, emit a file_inject event
agentEventEmitter.on('file_inject', listener);
agentEventEmitter.on('confirmation_required', listener);   // <-- ADD
agentEventEmitter.on('reasoning_step', listener);          // <-- ADD
  req.on('close', () => {
    agentEventEmitter.off('state', listener);
    agentEventEmitter.off('agent_step', listener);
    agentEventEmitter.off('tool_start', listener);
    agentEventEmitter.off('tool_end', listener);
    agentEventEmitter.off('task', listener);
      agentEventEmitter.off('screenshot', listener);
        agentEventEmitter.off('cron_result', listener); 
        agentEventEmitter.off('partial_output', listener);
agentEventEmitter.off('confirmation_required', listener);   // <-- ADD
  agentEventEmitter.off('reasoning_step', listener); 
  agentEventEmitter.off('request_local_file', listener);   

  });
}); 

// ── Core: run ────────────────────────────────────────────────────
app.post('/api/run', async (req: Request, res: Response) => {
const { goal, sessionId, preferredModel, preferredTool } = req.body;
  if (!goal?.trim()) return res.status(400).json({ error: 'goal required' });
  const sid = sessionId || 'default';

  try {
const result = await orchestrator.process(goal, sid, preferredModel, preferredTool);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('[/api/run]', err);
    agentEventEmitter.emit('state', { type: 'state', state: 'idle', message: '' });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
app.get('/api/local-agent/pending', (req, res) => {
  const cmd = pendingCommands.shift();
  if (cmd) {
    res.json({ id: cmd.id, command: cmd.command });
  } else {
    res.json(null);
  }
});

app.post('/api/local-agent/result', (req, res) => {
  const { id, result } = req.body;
  completedCommands.set(id, result);
  res.json({ ok: true });
});
app.get('/api/download-local-agent', (_req, res) => {
  const scriptPath = path.join(process.cwd(), 'kasra-local-agent.js');
  if (fs.existsSync(scriptPath)) {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Content-Disposition', 'attachment; filename="kasra-local-agent.js"');
    res.sendFile(scriptPath);
  } else {
    res.status(404).send('Script not found');
  }
});
app.post('/api/local-file-result', (req, res) => {
  const { requestId, content, fileName } = req.body;
  agentEventEmitter.emit('local_file_result', { requestId, content, fileName });
  res.json({ ok: true });
});
app.get('/api/models', (_req, res) => {
  // Only send metadata (no functions) to the frontend
  const models = MODEL_REGISTRY.map(({ id, name, provider, available }) => ({
    id,
    name,
    provider,
    available,
  }));
  res.json(models);
});
// ── Chat history ─────────────────────────────────────────────────
app.get('/api/chat-history', (req, res) => {
  const { sessionId } = req.query;
  const allMessages = getChatHistory(sessionId as string, 200) as any[];

  // Only keep user messages and clean assistant messages
  const filtered = allMessages.filter(msg => {
    if (msg.role === 'user') return true;
    // Assistant messages: skip internal tool/JSON dumps
    const content = msg.content || '';
    if (content.startsWith('{"tool"') || content.startsWith('{"output"') || content.startsWith('[TOOL:') || content.startsWith('[CRON_LIST:')) {
      return false;
    }
    return true;
  });

  res.json(filtered);
});

app.get('/api/sessions', (_req, res) => {
  res.json(getAllSessions());
});

// ── Environment files ─────────────────────────────────────────────
app.get('/api/cpm', (_req, res) => res.json({ content: getCPM() }));
app.get('/api/memoire', (_req, res) => res.json(getMemoire()));
app.get('/api/self-improve-notes', (_req, res) => res.json(getSelfImproveNotes()));
app.get('/api/active-skills', (_req, res) => res.json(getActiveSkills()));

// ── Skills CRUD ───────────────────────────────────────────────────
app.get('/api/skills', (_req, res) => res.json(getAllSkills()));

app.post('/api/skills', (req: Request, res: Response) => {
  try {
    const { name, description, applies_to, method_prompt, expected_result } = req.body;
    if (!method_prompt) return res.status(400).json({ error: 'method_prompt required' });
    const r = createSkill({ name: name || 'Skill', description, applies_to, method_prompt, expected_result, created_by: 'user' });
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Simple skill (user-facing: just a text block)
app.post('/api/skills/simple', (req: Request, res: Response) => {
  const { name, text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const r = createSkill({ name: name || 'Skill', method_prompt: text, created_by: 'user' });
  res.json({ success: true, id: r.lastInsertRowid });
});

app.patch('/api/skills/:id/toggle', (req: Request, res: Response) => {
  try {
    toggleSkill(parseInt(req.params['id'] as string), req.body.active);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/skills/:id/simple', (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    updateSkill(parseInt(req.params['id'] as string), { method_prompt: text });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/skills/:id', (req: Request, res: Response) => {
  try {
    updateSkill(parseInt(req.params['id'] as string), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Tools list ────────────────────────────────────────────────────
app.get('/api/tools-list', (_req, res) => {
  res.json(orchestrator.toolsHub.getToolsMetadata());
}); 

// ── Inventory ─────────────────────────────────────────────────────
app.get('/api/inventory', (_req, res) => res.json(getInventory()));

// ── Forecasts & feedback ──────────────────────────────────────────
app.get('/api/forecast', (_req, res) => res.json(getForecast()));

app.post('/api/feedback', (req: Request, res: Response) => {
  const { forecastId, actualDays, sessionId, type, message } = req.body;

  // ── Branch 1: Forecast feedback (original) ────────────────────
  if (forecastId && typeof actualDays === 'number') {
    updateForecastActual(forecastId, actualDays);
    return res.json({ success: true });
  }

  // ── Branch 2: Task outcome correction (new — Hermes self‑improve) ──
  if (sessionId && type === 'correction' && message) {
    const { recordCorrection, addSelfImproveNote } = require('./files');
    recordCorrection(sessionId, message);
    addSelfImproveNote(
      `User correction in session ${sessionId}: ${message.slice(0, 200)}`,
      'error',
      0.85,
    );
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Invalid feedback format' });
});
app.get('/api/outcomes/stats', (_req, res) => {
  const { getOutcomeStats } = require('./files');
  res.json(getOutcomeStats());
});

// ── Scheduled tasks ───────────────────────────────────────────────
app.get('/api/crons', (_req, res) => res.json(getAllScheduledTasks()));

// ── OCR upload endpoint ───────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  res.json({
    success: true,
    fileName: file.originalname,
    filePath: `/uploads/${file.filename}`,
    url: `http://localhost:${process.env.PORT || 3001}/uploads/${file.filename}`,
    size: file.size,
    mimetype: file.mimetype,
  });
});

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools: orchestrator.getToolsList().length,
  });
});
app.post('/api/confirm', (req, res) => {
  const { sessionId, approved } = req.body;
  confirmationEmitter.emit('confirmation_decision', { sessionId, approved });
  res.json({ ok: true });
});
app.post('/api/ocr', upload.single('file'), async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

  const filePath     = req.file.path;
  const originalName = req.file.originalname;

  console.log(`[OCR] Processing: ${originalName}`);

  try {
    const { extractTextFromFile } = require('./ocr-extractor');
    const result = await extractTextFromFile(filePath, originalName);

    if (result.error && !result.text) {
      return res.json({ success: false, fileName: originalName, filePath, extractedText: '', error: result.error, method: result.method });
    }

    return res.json({
      success: true,
      fileName: originalName,
      filePath,
      extractedText: result.text,
      method: result.method,
      confidence: result.confidence,
    });
  } catch (err: any) {
    return res.json({ success: false, fileName: originalName, filePath, extractedText: '', error: err.message, method: 'exception' });
  }
});// ── Manual tool execution (bypass AI) ───────────────────────────────
app.post('/api/tool', async (req: Request, res: Response) => {
  const { tool, args } = req.body;
  if (!tool) return res.status(400).json({ error: 'tool name required' });

  try {
    const result = await (orchestrator as any).toolsHub.call(tool, args ?? {});
    return res.json({ success: true, result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Kasra OS running on :${PORT}`);
  console.log(`🔧 Tools: ${orchestrator.getToolsList().join(', ')}`);
});
