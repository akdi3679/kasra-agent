import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'kasra.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
// Ensure the data directory exists
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
 CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER DEFAULT 0,
  prompt TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  next_run TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at TEXT,
  max_runs INTEGER DEFAULT NULL,
  run_count INTEGER DEFAULT 0
);
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    applies_to TEXT DEFAULT 'all',
    method_prompt TEXT NOT NULL,
    expected_result TEXT,
    is_active INTEGER DEFAULT 1,
    created_by TEXT DEFAULT 'user',
    ai_decision TEXT,
    last_applied DATETIME,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS memoire (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cpm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    min_quantity INTEGER NOT NULL DEFAULT 50,
    unit_price REAL NOT NULL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    predicted_days INTEGER,
    actual_days INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS task_outcomes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT    NOT NULL,
  goal         TEXT    NOT NULL,
  tools_used   TEXT    NOT NULL DEFAULT '[]',
  turn_count   INTEGER NOT NULL DEFAULT 0,
  had_error    INTEGER NOT NULL DEFAULT 0,
  had_retry    INTEGER NOT NULL DEFAULT 0,
  outcome      TEXT    NOT NULL DEFAULT 'unknown',
  correction   TEXT,
  duration_ms  INTEGER,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_outcomes_session ON task_outcomes(session_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON task_outcomes(outcome);
  CREATE TABLE IF NOT EXISTS improvements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_prompt TEXT,
    improved_prompt TEXT,
    avg_error REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ocr_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    extracted_text TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS session_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  fact TEXT NOT NULL,
  tags TEXT DEFAULT '',
  importance REAL NOT NULL DEFAULT 0.5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
   CREATE TABLE IF NOT EXISTS session_history (
    session_id   TEXT PRIMARY KEY,
    history_json TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS session_facts_fts
USING fts5(fact, tags, content=session_facts, content_rowid=id);

CREATE TRIGGER IF NOT EXISTS sf_ai AFTER INSERT ON session_facts BEGIN
  INSERT INTO session_facts_fts(rowid, fact, tags) VALUES (new.id, new.fact, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS sf_ad AFTER DELETE ON session_facts BEGIN
  INSERT INTO session_facts_fts(session_facts_fts, rowid, fact, tags) VALUES('delete', old.id, old.fact, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS sf_au AFTER UPDATE ON session_facts BEGIN
  INSERT INTO session_facts_fts(session_facts_fts, rowid, fact, tags) VALUES('delete', old.id, old.fact, old.tags);
  INSERT INTO session_facts_fts(rowid, fact, tags) VALUES (new.id, new.fact, new.tags);
END;
`);

// ── Migrations: safe ALTER TABLE for existing DBs ─────────────
const migrations = [
  "ALTER TABLE scheduled_tasks ADD COLUMN status TEXT DEFAULT 'active'",
  "ALTER TABLE scheduled_tasks ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
  "ALTER TABLE scheduled_tasks ADD COLUMN chat_id INTEGER DEFAULT 0", 
  "ALTER TABLE scheduled_tasks ADD COLUMN run_count INTEGER DEFAULT 0",
  "ALTER TABLE scheduled_tasks ADD COLUMN max_runs INTEGER DEFAULT NULL",
];
for (const m of migrations) {
  try { db.exec(m); } catch { /* column already exists */ }
}
// Backfill: ensure no NULLs in status
db.exec("UPDATE scheduled_tasks SET status = 'active' WHERE status IS NULL");

// ── Seed defaults ──────────────────────────────────────────────
const invCount = (db.prepare('SELECT COUNT(*) as c FROM inventory').get() as any).c;
if (invCount === 0) {
  const ins = db.prepare('INSERT INTO inventory (product_name,quantity,min_quantity,unit_price) VALUES (?,?,?,?)');
  ins.run('iPhone 15 Pro', 120, 30, 999.99);
  ins.run('MacBook Air M3', 45, 10, 1299.99);
  ins.run('AirPods Pro 2', 230, 50, 249.99);
  ins.run('iPad Pro 12.9', 32, 10, 1099.99);
  ins.run('Apple Watch S9', 88, 20, 399.99);
}

const memoireCount = (db.prepare('SELECT COUNT(*) as c FROM memoire').get() as any).c;
if (memoireCount === 0) {
  const ins = db.prepare("INSERT INTO memoire (section,content) VALUES (?,?)");
  ins.run('client', '');
  ins.run('analyze', '');
  ins.run('context_notes', '');
}


const skillCount = (db.prepare('SELECT COUNT(*) as c FROM skills').get() as any).c;
if (skillCount === 0) {
  const ins = db.prepare('INSERT INTO skills (name,description,applies_to,method_prompt,expected_result) VALUES (?,?,?,?,?)');
  db.transaction(() => {
  ins.run('seasonal_pricing', 'Seasonal pricing', 'agent-enhancement', 'Raise seasonal product prices by 10-15% when approaching peak seasons', 'Increase revenue by 8-12%');
ins.run('stockout_prevention', 'Stockout prevention', 'agent-inventory', 'When stock falls below 20% of minimum, alert immediately with a restocking plan', 'Prevent lost sales');
ins.run('bundle_products', 'Bundle products', 'agent-enhancement', 'Identify products frequently purchased together and create bundle offers at 5-10% discount', 'Increase average order value by 15%');
 })();
}

// ── Helper: ISO → SQLite-compatible UTC string ─────────────────
// SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (space, no T, no ms, no Z)
// We store next_run in same format so SQL comparison works correctly.
function toSQLiteDateTime(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// ── Cron parser helper ─────────────────────────────────────────
function parseCronExpr(expr: string) {
  const m = require('cron-parser');
  const fn = m.parseExpression ?? m.default?.parseExpression ?? m;
  if (typeof fn !== 'function') throw new Error('cron-parser not callable');
  return fn(expr);
}

// ── Exports ────────────────────────────────────────────────────

export function getCPM(): string {
  const row = db.prepare('SELECT content FROM cpm ORDER BY id DESC LIMIT 1').get() as any;
  return row?.content ?? '';
}

export function syncCPMFromTools(toolNames: string[]) {
  const content = [
    '# CPM – Amazan Tool Index (auto-updated)',
    '',
    '## Registered Tools',
    ...toolNames.map(n => `- \`${n}\``),
    '',
    '## Update Rules',
    '- Record new client facts in memoire.client immediately',
    '- Every state-changing tool call (db_update, schedule_task, export_excel) appears in the task panel',
    '- After analyze_project runs, result is stored in memoire.analyze automatically',
  ].join('\n');
  const existing = db.prepare('SELECT id FROM cpm ORDER BY id DESC LIMIT 1').get() as any;
  if (existing) {
    db.prepare('UPDATE cpm SET content=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, existing.id);
  } else {
    db.prepare('INSERT INTO cpm (content) VALUES (?)').run(content);
  }
}

export function getMemoire(): Record<string, string> {
  const rows = db.prepare('SELECT section,content FROM memoire').all() as any[];
  const r: Record<string, string> = {};
  for (const row of rows) r[row.section] = row.content;
  return r;
}

export function updateMemoire(section: string, content: any, action: 'append' | 'replace' | 'delete' = 'append') {
  const str = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  if (action === 'delete') {
    db.prepare('UPDATE memoire SET content=?,updated_at=CURRENT_TIMESTAMP WHERE section=?').run('', section);
    return;
  }
  const existing = db.prepare('SELECT content FROM memoire WHERE section=?').get(section) as any;
  if (action === 'append') {
    const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const entry = `[${ts}][AI] ${str}`;
    const updated = existing?.content ? `${existing.content}\n${entry}` : entry;
    if (existing) {
      db.prepare('UPDATE memoire SET content=?,updated_at=CURRENT_TIMESTAMP WHERE section=?').run(updated, section);
    } else {
      db.prepare('INSERT INTO memoire (section,content) VALUES (?,?)').run(section, updated);
    }
  } else {
    if (existing) {
      db.prepare('UPDATE memoire SET content=?,updated_at=CURRENT_TIMESTAMP WHERE section=?').run(str, section);
    } else {
      db.prepare('INSERT INTO memoire (section,content) VALUES (?,?)').run(section, str);
    }
  }
}
// ── Session persistence ──────────────────────────────────────


export function getSessionHistory(): { sessionId: string; history: any[] }[] {
  try {
    const rows = db.prepare(`
      SELECT session_id, history_json FROM session_history
      WHERE updated_at > datetime('now', '-2 hours')
    `).all() as any[];
    return rows.map(r => ({
      sessionId: r.session_id,
      history:   JSON.parse(r.history_json),
    }));
  } catch {
    return [];
  }
}

export function deleteSessionHistory(sessionId: string): void {
  try {
    db.prepare('DELETE FROM session_history WHERE session_id = ?').run(sessionId);
  } catch {}
}
export function getSelfImproveNotes() {
  return db.prepare('SELECT * FROM self_improve_notes WHERE is_active=1 ORDER BY timestamp DESC').all();
}

export function updateSelfImproveNote(id: number, note: string) {
  return db.prepare('UPDATE self_improve_notes SET note=? WHERE id=?').run(note, id);
}
export function deleteSelfImproveNote(id: number) {
  return db.prepare('UPDATE self_improve_notes SET is_active=0 WHERE id=?').run(id);
}

export function getActiveSkills() {
  return db.prepare('SELECT * FROM skills WHERE is_active=1 ORDER BY id').all();
}
export function getAllSkills() {
  return db.prepare('SELECT * FROM skills ORDER BY id').all();
}

export function getScheduledTaskById(id: number) {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
}
export function toggleSkill(id: number, active: boolean) {
  return db.prepare('UPDATE skills SET is_active=? WHERE id=?').run(active ? 1 : 0, id);
}
export function updateSkill(id: number, fields: any) {
  const sets: string[] = []; const params: any[] = [];
  if (fields.method_prompt !== undefined) { sets.push('method_prompt=?'); params.push(fields.method_prompt); }
  if (fields.description !== undefined)   { sets.push('description=?');   params.push(fields.description); }
  if (fields.applies_to !== undefined)    { sets.push('applies_to=?');    params.push(fields.applies_to); }
  if (fields.expected_result !== undefined) { sets.push('expected_result=?'); params.push(fields.expected_result); }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE skills SET ${sets.join(',')} WHERE id=?`).run(...params);
}
export function updateSkillDecision(id: number, aiDecision: string) {
  return db.prepare('UPDATE skills SET ai_decision=?,last_applied=CURRENT_TIMESTAMP WHERE id=?').run(aiDecision, id);
}


export function saveChatMessage(sessionId: string, role: string, content: string) {
  return db.prepare('INSERT INTO chat_history (session_id,role,content) VALUES (?,?,?)').run(sessionId, role, content);
}
export function getChatHistory(sessionId: string, limit = 50) {
  return db.prepare('SELECT * FROM chat_history WHERE session_id=? ORDER BY timestamp ASC LIMIT ?').all(sessionId, limit);
}
export function getAllSessions() {
  return db.prepare('SELECT DISTINCT session_id, MIN(timestamp) as started, COUNT(*) as msg_count FROM chat_history GROUP BY session_id ORDER BY started DESC').all();
}

export function getInventory() {
  return db.prepare('SELECT * FROM inventory ORDER BY quantity ASC').all();
}
export function updateInventoryQuantity(id: number, quantity: number) {
  return db.prepare('UPDATE inventory SET quantity=?,last_updated=CURRENT_TIMESTAMP WHERE id=?').run(quantity, id);
}

export function saveForecast(data: { productName: string; predictedDays: number }) {
  return db.prepare('INSERT INTO forecasts (product_name,predicted_days) VALUES (?,?)').run(data.productName, data.predictedDays);
}
export function updateForecastActual(id: number, actualDays: number) {
  return db.prepare('UPDATE forecasts SET actual_days=? WHERE id=?').run(actualDays, id);
}
export function getForecast() {
  return db.prepare('SELECT * FROM forecasts ORDER BY timestamp DESC LIMIT 20').all();
}
export function getPastForecasts(limit: number) {
  return db.prepare('SELECT * FROM forecasts ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function saveImprovement(original: string, improved: string, avgError: number) {
  db.prepare('INSERT INTO improvements (original_prompt,improved_prompt,avg_error) VALUES (?,?,?)').run(original, improved, avgError);
}
export function getCurrentPrompt(): string {
  const row = db.prepare('SELECT improved_prompt FROM improvements ORDER BY timestamp DESC LIMIT 1').get() as any;
  return row?.improved_prompt || '';
}

// ── Scheduled tasks ────────────────────────────────────────────
// CRITICAL: store next_run as "YYYY-MM-DD HH:MM:SS" (SQLite format, UTC)
// so that comparison with datetime('now') works correctly.

export function addScheduledTask(chatId: number, prompt: string, cronExpression: string, maxRuns: number | null = null) {
  const interval = parseCronExpr(cronExpression);
  const nextRun = toSQLiteDateTime(interval.next().toDate());
return db.prepare(
  "INSERT INTO scheduled_tasks (chat_id, prompt, cron_expression, next_run, status, max_runs) VALUES (?,?,?,?,'active',?)"
).run(chatId, prompt, cronExpression, nextRun, maxRuns);   
}

// Returns tasks that are active AND due NOW (JS-side date comparison for reliability)
export function getScheduledTasks(): any[] {
  const now = new Date();
  const all = db.prepare("SELECT * FROM scheduled_tasks WHERE status='active'").all() as any[];
  return all.filter(t => {
    // next_run stored as "YYYY-MM-DD HH:MM:SS" UTC
    const due = new Date(t.next_run.replace(' ', 'T') + 'Z');
    return due <= now;
  });
}

export function getAllScheduledTasks() {
  return db.prepare("SELECT * FROM scheduled_tasks WHERE status != 'deleted' ORDER BY id DESC").all();
}
export function incrementRunCount(id: number) {
  return db.prepare('UPDATE scheduled_tasks SET run_count = run_count + 1 WHERE id = ?').run(id);
}
export function updateTaskStatus(id: number, status: 'active' | 'paused' | 'stopped' | 'deleted') {
  if (status === 'active') {
    const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as any;
    if (task) {
      try {
        const nextRun = toSQLiteDateTime(parseCronExpr(task.cron_expression).next().toDate());
        return db.prepare('UPDATE scheduled_tasks SET status=?,next_run=? WHERE id=?').run(status, nextRun, id);
      } catch {}
    }
  }
  return db.prepare('UPDATE scheduled_tasks SET status=? WHERE id=?').run(status, id);
}

export function updateScheduledTask(id: number, updates: { prompt?: string; cron_expression?: string }) {
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as any;
  if (!task) return;
  const newPrompt = updates.prompt ?? task.prompt;
  const newCron = updates.cron_expression ?? task.cron_expression;
  try {
    const nextRun = toSQLiteDateTime(parseCronExpr(newCron).next().toDate());
    db.prepare('UPDATE scheduled_tasks SET prompt=?,cron_expression=?,next_run=? WHERE id=?').run(newPrompt, newCron, nextRun, id);
  } catch {
    db.prepare('UPDATE scheduled_tasks SET prompt=? WHERE id=?').run(newPrompt, id);
  }
}

export function deleteScheduledTask(id: number) {
  return db.prepare("UPDATE scheduled_tasks SET status='deleted' WHERE id=?").run(id);
}

export function markTaskDone(id: number) {
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as any;
  if (!task || task.status !== 'active') return;
  try {
    const nextRun = toSQLiteDateTime(parseCronExpr(task.cron_expression).next().toDate());
    // Single atomic update: increment count AND advance next_run
    db.prepare('UPDATE scheduled_tasks SET next_run=?, run_count = run_count + 1 WHERE id=?')
      .run(nextRun, id);
  } catch {
    db.prepare("UPDATE scheduled_tasks SET status='stopped' WHERE id=?").run(id);
  }
}

export function saveOcrFile(sessionId: string, filename: string, extractedText: string) {
  return db.prepare('INSERT INTO ocr_files (session_id,filename,extracted_text) VALUES (?,?,?)').run(sessionId, filename, extractedText);
}
export function getOcrFiles(sessionId: string) {
  return db.prepare('SELECT * FROM ocr_files WHERE session_id=? ORDER BY timestamp DESC').all(sessionId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  src/files-additions.ts
//
//  Add these functions to your existing files.ts
//  They power the Hermes-grade memory, skills, and self-improve systems.
//
//  ALSO add these columns to files.ts db.exec() migration block:
//    "ALTER TABLE self_improve_notes ADD COLUMN usefulness REAL NOT NULL DEFAULT 0.5",
//    "ALTER TABLE self_improve_notes ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
//    "ALTER TABLE skills ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
//    "ALTER TABLE skills ADD COLUMN success_count INTEGER NOT NULL DEFAULT 0",
//    "ALTER TABLE skills ADD COLUMN last_used DATETIME",
//    "ALTER TABLE skills ADD COLUMN tags TEXT DEFAULT ''",
//    "ALTER TABLE skills ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
//    "ALTER TABLE skills ADD COLUMN full_prompt TEXT DEFAULT ''",
// ─────────────────────────────────────────────────────────────────────────────

// Paste these into the bottom of your existing files.ts, after the existing exports.
// The `db` variable is already defined in files.ts.

// ── Self-improve quality tracking ─────────────────────────────────────────────

/**
 * Add a self-improve note with a usefulness score (0–1).
 * Replaces the old addSelfImproveNote which had no quality scoring.
 */
export function addSelfImproveNote(note: string, category = 'general', usefulness = 0.5) {
  return db.prepare(
    'INSERT INTO self_improve_notes (note, category, usefulness, created_by) VALUES (?, ?, ?, ?)'
  ).run(note, category, Math.max(0, Math.min(1, usefulness)), 'ai');
}

export function updateSelfImproveUsefulness(id: number, usefulness: number) {
  return db.prepare('UPDATE self_improve_notes SET usefulness=? WHERE id=?')
    .run(Math.max(0, Math.min(1, usefulness)), id);
}

export function incrementSelfImproveUseCount(id: number) {
  // Each use slightly boosts the usefulness score (max 1.0)
  return db.prepare(`
    UPDATE self_improve_notes 
    SET use_count = use_count + 1,
        usefulness = MIN(1.0, usefulness + 0.05)
    WHERE id = ?
  `).run(id);
}



 export function saveTaskOutcome(data: {
  sessionId:  string;
  goal:       string;
  toolsUsed:  string[];
  turnCount:  number;
  hadError:   boolean;
  hadRetry:   boolean;
  outcome:    'success' | 'correction' | 'failed' | 'stopped';
  correction?: string;
  durationMs?: number;
}) {
  return db.prepare(
    `INSERT INTO task_outcomes (session_id, goal, tools_used, turn_count, had_error, had_retry, outcome, correction, duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    data.sessionId,
    data.goal,
    JSON.stringify(data.toolsUsed),
    data.turnCount,
    data.hadError ? 1 : 0,
    data.hadRetry ? 1 : 0,
    data.outcome,
    data.correction ?? null,
    data.durationMs ?? null,
  );
}

export function getRecentOutcomes(limit = 50): any[] {
  return db.prepare('SELECT * FROM task_outcomes ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
}

export function getOutcomeStats() {
  const rows = db.prepare(
    "SELECT outcome, COUNT(*) as c, AVG(turn_count) as avg_turns FROM task_outcomes GROUP BY outcome"
  ).all() as any[];
  const counts: Record<string, number> = {};
  let totalTurns = 0, total = 0;
  for (const r of rows) {
    counts[r.outcome] = r.c;
    total += r.c;
    totalTurns += r.c * (r.avg_turns || 0);
  }
  return {
    total:       total,
    success:     counts['success']    ?? 0,
    correction:  counts['correction'] ?? 0,
    failed:      counts['failed']     ?? 0,
    avgTurns:    total > 0 ? Math.round((totalTurns / total) * 10) / 10 : 0,
    errorRate:   total > 0 ? Math.round(((counts['failed'] ?? 0) + (counts['correction'] ?? 0)) / total * 100) : 0,
  };
}

export function recordCorrection(sessionId: string, correction: string) {
  db.prepare(
    "UPDATE task_outcomes SET outcome='correction', correction=? WHERE session_id=? ORDER BY created_at DESC LIMIT 1"
  ).run(correction, sessionId);
}
 

/**
 * Get active notes sorted by usefulness descending.
 * Only returns top N to keep context load bounded.
 */
export function getActiveSkillNotes(limit = 10) {
  return db.prepare(`
    SELECT * FROM self_improve_notes 
    WHERE is_active = 1 
    ORDER BY usefulness DESC, use_count DESC 
    LIMIT ?
  `).all(limit);
}

// ── Skills — progressive disclosure ───────────────────────────────────────────

/**
 * Get skill stubs only (name + description + method_prompt summary).
 * Used for system prompt injection — keeps token cost flat.
 * Full content only loaded when agent explicitly requests a skill.
 */
export function getSkillStubs(): { id: number; name: string; description: string; method_prompt: string; tags: string }[] {
  return db.prepare(`
    SELECT id, name, description, 
           SUBSTR(method_prompt, 1, 120) as method_prompt,
           tags
    FROM skills 
    WHERE is_active = 1 
    ORDER BY use_count DESC, success_count DESC
  `).all() as any[];
}

/**
 * Get full skill content for a specific skill (loaded on demand).
 */
export function getSkillFull(id: number) {
  return db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
}

export function incrementSkillUseCount(id: number, succeeded: boolean) {
  return db.prepare(`
    UPDATE skills 
    SET use_count = use_count + 1,
        success_count = success_count + ?,
        last_used = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(succeeded ? 1 : 0, id);
}

/**
 * Patch a skill's method_prompt (targeted edit, not full rewrite).
 * Hermes uses patch-over-edit for correctness and token efficiency.
 */
export function patchSkill(id: number, oldStr: string, newStr: string): boolean {
  const skill = db.prepare('SELECT method_prompt FROM skills WHERE id = ?').get(id) as any;
  if (!skill) return false;
  if (!skill.method_prompt.includes(oldStr)) return false;
  const patched = skill.method_prompt.replace(oldStr, newStr);
  db.prepare('UPDATE skills SET method_prompt=?, version=version+1, last_used=CURRENT_TIMESTAMP WHERE id=?')
    .run(patched, id);
  return true;
}

// ── Enhanced createSkill with tags support ─────────────────────────────────────

export function createSkill(skill: { name: string; description?: string; applies_to?: string; method_prompt: string; expected_result?: string; created_by?: string }) {
  return db.prepare('INSERT INTO skills (name,description,applies_to,method_prompt,expected_result,created_by) VALUES (?,?,?,?,?,?)')
    .run(skill.name, skill.description ?? '', skill.applies_to ?? 'all', skill.method_prompt, skill.expected_result ?? '', skill.created_by ?? 'user');
}

// ── Session facts (episodic memory layer) ─────────────────────────────────────

export function saveSessionFact(sessionId: string, fact: string, tags = '', importance = 0.5) {
  return db.prepare(
    'INSERT INTO session_facts (session_id, fact, tags, importance) VALUES (?, ?, ?, ?)'
  ).run(sessionId, fact, tags, Math.max(0, Math.min(1, importance)));
}

/**
 * Search session facts by keyword (poor-man's FTS — no FTS5 extension needed).
 * Returns top results by importance for injection into context.
 */
export function searchSessionFacts(query: string, limit = 5): any[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  // Check tags and fact text for any term
  const all = db.prepare(
    'SELECT * FROM session_facts ORDER BY importance DESC, created_at DESC LIMIT 200'
  ).all() as any[];
  return all
    .filter(f =>
      terms.some(t => f.fact.toLowerCase().includes(t) || f.tags.toLowerCase().includes(t))
    )
    .slice(0, limit);
}

export function getRecentSessionFacts(sessionId: string, limit = 10): any[] {
  return db.prepare(
    'SELECT * FROM session_facts WHERE session_id=? ORDER BY importance DESC LIMIT ?'
  ).all(sessionId, limit) as any[];
}

// ── Memory audit trail ────────────────────────────────────────────────────────

export function logMemoryAudit(layer: string, action: string, keyRef: string, reason: string) {
  try {
    db.prepare(
      'INSERT INTO memory_audit (layer, action, key_ref, reason) VALUES (?, ?, ?, ?)'
    ).run(layer, action, keyRef, reason);
  } catch {}
}

// ── Skill events audit trail ──────────────────────────────────────────────────

export function logSkillEvent(skillId: number | null, eventType: string, detail: string) {
  try {
    db.prepare(
      'INSERT INTO skill_events (skill_id, event_type, detail) VALUES (?, ?, ?)'
    ).run(skillId, eventType, detail);
  } catch {}
}

export function saveSessionHistory(sessionId: string, history: { role: string; content: string }[]): void {
  try {
    db.prepare(`
      INSERT INTO session_history (session_id, history_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        history_json = excluded.history_json,
        updated_at   = excluded.updated_at
    `).run(sessionId, JSON.stringify(history), new Date().toISOString());
  } catch (e) {
    console.warn('[files] saveSessionHistory failed:', e);
  }
}