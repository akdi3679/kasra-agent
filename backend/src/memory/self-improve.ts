// src/memory/self-improve.ts
//
// Hermes-grade self-improvement engine for Amazan OS.
//
// Architecture (borrowed from Hermes Agent + research):
//
//  LAYER 1 — Periodic Nudge
//    Every N turns the orchestrator calls nudge(history).
//    The LLM scans recent activity and decides what, if anything,
//    is worth writing to self_improve_notes or memoire.
//    This is agent-curated memory — not a dump, a decision.
//
//  LAYER 2 — Skill Creation from Experience
//    When a workflow used 4+ tools, recovered from an error, or
//    received a correction, evaluateSession() asks the LLM:
//    "Is this worth a reusable skill?"  If yes → createSkill().
//
//  LAYER 3 — Note Quality Gate
//    Every new self-improve note is rated 0–1 for usefulness.
//    Notes below 0.3 are pruned automatically.
//    Notes used repeatedly get their score boosted.
//
//  LAYER 4 — Forecast Self-Improvement (original feature, hardened)
//    Still runs, but now only when avgError > threshold AND
//    there are enough real data points to trust it.
//
// Key design principles from Hermes research:
//  • The agent decides what to remember — not the framework
//  • Patch over rewrite (targeted edits survive better)
//  • Usefulness scores prevent unbounded accumulation
//  • Separate what-happened (episodic) from how-to (procedural)

import { generateWithFallback } from '../lib/llm';
import {
  saveImprovement, getCurrentPrompt,
  getSelfImproveNotes, addSelfImproveNote, updateSelfImproveNote, deleteSelfImproveNote,
  getMemoire, updateMemoire,
  createSkill, getActiveSkills,
  saveSessionFact, logMemoryAudit, logSkillEvent,
  updateSelfImproveUsefulness, incrementSelfImproveUseCount,
  incrementSkillUseCount,
} from '../files';

// ── Constants ──────────────────────────────────────────────────────────────────
const NUDGE_INTERVAL_TURNS  = 8;    // nudge fires every N turns within a session
const NUDGE_COOLDOWN_MS     = 5 * 60 * 1000;  // but no more often than 5 min wall-clock
const FORECAST_COOLDOWN_MS  = 10 * 60 * 1000;
const FORECAST_MIN_SAMPLES  = 5;    // need real data before trusting avg error
const FORECAST_ERR_THRESHOLD = 2.0;
const NOTE_PRUNE_THRESHOLD  = 0.25; // notes below this usefulness get deleted
const NOTE_MAX_ACTIVE       = 20;   // hard cap on active notes
const MEMOIRE_SECTION_BUDGET = 600; // chars per section before compression
const SKILL_MIN_TOOLS       = 4;    // minimum tool calls to consider skill creation
const SKILL_CREATION_COOLDOWN_MS = 2 * 60 * 1000; // don't create skills too fast

// ── Types ──────────────────────────────────────────────────────────────────────
interface SessionSummary {
  sessionId:    string;
  goal:         string;
  toolsUsed:    string[];
  hadError:     boolean;
  hadCorrection: boolean;
  turnCount:    number;
  finalOutput:  string;
}

interface NudgeResult {
  memoriesAdded:   number;
  notesAdded:      number;
  notesPruned:     number;
  factsExtracted:  number;
}

// ── SelfImprover ───────────────────────────────────────────────────────────────
export class SelfImprover {
  private lastForecastEval  = 0;
  private lastNudge         = 0;
  private lastSkillCreation = 0;
  private nudgeTurnCounter  = 0;

  // ── PUBLIC: called by orchestrator every turn ──────────────────────────────
  tickTurn() {
    this.nudgeTurnCounter++;
  }

  shouldNudge(): boolean {
    return (
      this.nudgeTurnCounter >= NUDGE_INTERVAL_TURNS &&
      Date.now() - this.lastNudge > NUDGE_COOLDOWN_MS
    );
  }

  // ── PUBLIC: periodic memory nudge ─────────────────────────────────────────
  // Called mid-session by orchestrator. The LLM reviews recent history and
  // writes anything worth keeping. Agent-curated, not automatic dump.
  async nudge(
    history: { role: string; content: string }[],
    sessionId: string,
  ): Promise<NudgeResult> {
    this.nudgeTurnCounter = 0;
    this.lastNudge = Date.now();

    const result: NudgeResult = { memoriesAdded: 0, notesAdded: 0, notesPruned: 0, factsExtracted: 0 };

    // Only look at recent history (last 10 messages)
    const recentHistory = history.slice(-10);
    if (recentHistory.length < 3) return result;

    const existing = (getSelfImproveNotes() as any[]).slice(0, 10).map(n => `[${n.id}] ${n.note}`).join('\n');
    const memoireClient = (getMemoire()).client ?? '';

    const prompt = `You are the memory curator for Amazan OS. Review this recent conversation excerpt and decide what is worth persisting.

RECENT CONVERSATION:
${recentHistory.map(m => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 300)}`).join('\n')}

EXISTING SELF-IMPROVE NOTES (do not duplicate):
${existing || '(none yet)'}

CURRENT CLIENT CONTEXT (first 200 chars):
${memoireClient.slice(0, 200) || '(empty)'}

Your job: extract what is GENUINELY USEFUL for future sessions.
High value: patterns that recurred, errors and their fixes, user preferences, domain facts about the client.
Low value: one-off tasks, specific data values, procedural steps already obvious from the tools.

Respond ONLY with JSON (no markdown, no prose):
{
  "self_improve": [
    { "action": "add", "note": "...", "category": "pattern|error|preference|domain", "usefulness": 0.0-1.0 },
    { "action": "delete", "id": 5, "reason": "..." }
  ],
  "memoire": [
    { "section": "client|context_notes", "action": "append|replace", "content": "...", "importance": 0.0-1.0 }
  ],
  "session_facts": [
    { "fact": "...", "tags": "keyword1 keyword2", "importance": 0.0-1.0 }
  ]
}

Rules:
- Only include items where usefulness/importance >= 0.4
- Max 3 self_improve items per nudge
- Max 2 memoire items per nudge
- Max 5 session_facts per nudge
- If nothing is worth saving, return {"self_improve":[],"memoire":[],"session_facts":[]}`;

    try {
      const raw = await generateWithFallback(prompt);
      const cleaned = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
      const parsed = JSON.parse(cleaned);

      // Apply self-improve writes
      for (const item of (parsed.self_improve ?? [])) {
        if (item.action === 'add' && item.note && (item.usefulness ?? 0) >= 0.4) {
          await addSelfImproveNote(item.note, item.category ?? 'general', item.usefulness ?? 0.5);
          logMemoryAudit('self_improve', 'add', item.note.slice(0, 50), 'nudge');
          result.notesAdded++;
        } else if (item.action === 'delete' && item.id) {
          await deleteSelfImproveNote(Number(item.id));
          logMemoryAudit('self_improve', 'delete', String(item.id), item.reason ?? 'nudge');
          result.notesPruned++;
        }
      }

      // Apply memoire writes — but respect budget
      for (const item of (parsed.memoire ?? [])) {
        if (!item.section || !item.content || (item.importance ?? 0) < 0.4) continue;
        const existing = getMemoire()[item.section] ?? '';
        // If over budget, compress first
        if (existing.length > MEMOIRE_SECTION_BUDGET) {
          await this.compressMemoireSection(item.section, existing);
        }
        await updateMemoire(item.section, item.content, item.action ?? 'append');
        logMemoryAudit('memoire', item.action ?? 'append', item.section, 'nudge');
        result.memoriesAdded++;
      }

      // Extract session facts (episodic layer)
      for (const item of (parsed.session_facts ?? [])) {
        if (!item.fact || (item.importance ?? 0) < 0.4) continue;
        await saveSessionFact(sessionId, item.fact, item.tags ?? '', item.importance ?? 0.5);
        result.factsExtracted++;
      }

    } catch (e) {
      console.warn('[SelfImprover] nudge parse failed:', e);
    }

    // Auto-prune low-usefulness notes if above cap
    await this.pruneWeakNotes();
    result.notesPruned += 0; // updated inside pruneWeakNotes

    console.log(`[Memory] Nudge complete — +${result.notesAdded} notes, +${result.memoriesAdded} memoire, +${result.factsExtracted} facts`);
    return result;
  }

  // ── PUBLIC: evaluate completed session for skill creation ──────────────────
  // Called by orchestrator after a successful multi-step task.
   async evaluateSession(summary: SessionSummary): Promise<void> {
    const { sessionId, goal, toolsUsed, hadError, hadCorrection, turnCount, finalOutput } = summary;

    const qualifies =
      toolsUsed.length >= SKILL_MIN_TOOLS ||
      hadError ||
      hadCorrection;

    if (!qualifies) return;
    if (Date.now() - this.lastSkillCreation < SKILL_CREATION_COOLDOWN_MS) return;

    const existingSkills = getActiveSkills() as any[];

    // Dedup check
    const goalWords = new Set(goal.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    for (const skill of existingSkills) {
      const skillWords = new Set(
        (skill.name + ' ' + skill.description + ' ' + (skill.tags ?? ''))
          .toLowerCase().split(/\W+/).filter((w: string) => w.length > 3)
      );
      const overlap = [...goalWords].filter(w => skillWords.has(w)).length;
      const similarity = overlap / Math.max(goalWords.size, 1);
      if (similarity > 0.5) {
        console.log(`[Skills] Skipping — too similar to existing: "${skill.name}" (${Math.round(similarity*100)}% overlap)`);
        if (hadError || hadCorrection) {
          await this.maybePatchSkill(skill, goal, toolsUsed, finalOutput);
        }
        return;
      }
    }

    const existingList = existingSkills.map(s => `"${s.name}": ${s.description}`).join('\n');

    const prompt = `You are the skill curator for Amazan OS.

COMPLETED WORKFLOW:
Goal: ${goal}
Tools used in order: ${toolsUsed.join(' → ')}
Had error recovery: ${hadError}
Had user correction: ${hadCorrection}
Turns taken: ${turnCount}
Result preview: ${finalOutput.slice(0, 200)}

EXISTING SKILLS (do not duplicate):
${existingList || '(none)'}

Should this become a reusable skill? Create ONLY if:
1. Multi-step workflow (not just 1-2 tools)
2. Will likely recur (inventory ops, reports, scheduling — yes; one-off queries — no)
3. No existing skill covers it

Respond ONLY with JSON:
{
  "create_skill": true/false,
  "name": "snake_case_under_20_chars",
  "description": "one sentence, 10 words max",
  "applies_to": "agent-inventory|agent-reports|agent-scheduling|agent-general",
  "method_prompt": "numbered steps, tool names explicit, data flow clear, max 300 chars",
  "expected_result": "one phrase",
  "tags": "3-5 relevant keywords",
  "reason": "one sentence"
}`;

    try {
      const raw     = await generateWithFallback(prompt);
      const cleaned = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
      const parsed  = JSON.parse(cleaned);

      if (!parsed.create_skill) {
        console.log(`[Skills] Decided not to create: ${parsed.reason?.slice(0, 80)}`);
        return;
      }

      const nameExists = existingSkills.some(s => s.name === parsed.name);
      if (nameExists) {
        console.log(`[Skills] Skipping — name "${parsed.name}" already exists`);
        return;
      }

      this.lastSkillCreation = Date.now();

      const result = await (createSkill as any)({
  name:            parsed.name,
  description:     parsed.description,
  applies_to:      parsed.applies_to ?? 'agent-general',
  method_prompt:   parsed.method_prompt,
  expected_result: parsed.expected_result ?? '',
  created_by:      'ai',
  tags:            parsed.tags ?? '',
});

      const skillId = (result as any).lastInsertRowid;
      logSkillEvent(skillId, 'created', `Session ${sessionId}. Tools: ${toolsUsed.slice(0,5).join(',')}`);
      console.log(`[Skills] ✨ New skill: "${parsed.name}" — ${parsed.description}`);

    } catch (e) {
      console.warn('[SelfImprover] evaluateSession failed:', e);
    }
  }
 
// ── Patch existing skill instead of creating a new one ───────────────────────
  private async maybePatchSkill(skill: any, goal: string, toolsUsed: string[], output: string): Promise<void> {
    const prompt = `An existing skill ran but needed correction or error recovery.

SKILL: ${skill.name}
CURRENT METHOD:
${skill.method_prompt}

ACTUAL WORKFLOW THAT WORKED:
Goal: ${goal}
Tools: ${toolsUsed.join(' → ')}
Result: ${output.slice(0, 150)}

If the current method is incomplete or wrong, provide a targeted patch.
Respond ONLY with JSON:
{
  "should_patch": true/false,
  "old_str": "exact substring to replace (copy verbatim from CURRENT METHOD)",
  "new_str": "replacement string",
  "reason": "one sentence"
}`;

    try {
      const raw     = await generateWithFallback(prompt);
      const cleaned = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
      const parsed  = JSON.parse(cleaned);

      if (!parsed.should_patch || !parsed.old_str || !parsed.new_str) return;

      const { patchSkill } = require('../files');
      const patched = patchSkill(skill.id, parsed.old_str, parsed.new_str);
      if (patched) {
        logSkillEvent(skill.id, 'patched', parsed.reason ?? '');
        console.log(`[Skills] Patched "${skill.name}": ${parsed.reason}`);
      }
    } catch {}
  }

  // ── PUBLIC: update skill usefulness based on outcome ──────────────────────
  async recordSkillOutcome(skillId: number, succeeded: boolean): Promise<void> {
    incrementSkillUseCount(skillId, succeeded);
    logSkillEvent(skillId, succeeded ? 'used' : 'failed', '');
  }

  // ── PUBLIC: forecast self-improvement (hardened original feature) ──────────
  async evaluate(predictions: any[]): Promise<void> {
    if (Date.now() - this.lastForecastEval < FORECAST_COOLDOWN_MS) return;
    this.lastForecastEval = Date.now();

    const valid = predictions.filter(p => p.actual_days != null && p.predicted_days != null);
    if (valid.length < FORECAST_MIN_SAMPLES) return; // need real data

    const avgError =
      valid.reduce((s: number, p: any) => s + Math.abs(p.predicted_days - p.actual_days), 0) / valid.length;

    console.log(`📊 Forecast avg error: ${avgError.toFixed(2)} days (${valid.length} samples)`);
    if (avgError <= FORECAST_ERR_THRESHOLD) return;

    // Build context-rich prompt with actual examples instead of just the error number
    const examples = valid.slice(0, 5).map((p: any) =>
      `  • ${p.product_name}: predicted ${p.predicted_days}d, actual ${p.actual_days}d`
    ).join('\n');

    const currentPrompt = getCurrentPrompt();
   const improvementPrompt =
  `Average stock forecast error: ${avgError.toFixed(1)} days (${valid.length} samples).\n` +
  `Examples:\n${examples}\n` +
  (currentPrompt ? `Current prompt: ${currentPrompt.slice(0, 200)}\n` : '') +
  `Suggest an improved prompt for forecasting. Answer with a single sentence.`;
  
    const improved = await generateWithFallback(improvementPrompt);
    console.log(`✨ Improved forecast prompt: ${improved.slice(0, 80)}...`);
    saveImprovement(currentPrompt, improved, avgError);
  }

  // ── PUBLIC: mark a self-improve note as "used" — boosts its score ─────────
  async noteUsed(noteId: number): Promise<void> {
    incrementSelfImproveUseCount(noteId);
  }

  // ── PRIVATE: compress a memoire section that's over budget ────────────────
  private async compressMemoireSection(section: string, content: string): Promise<void> {
    const prompt =
      `Summarize the following memory section to under ${MEMOIRE_SECTION_BUDGET} characters. ` +
      `Keep all important facts. Remove timestamps and redundant entries. Plain text only.\n\n${content}`;
    try {
      const compressed = await generateWithFallback(prompt);
      await updateMemoire(section, compressed.slice(0, MEMOIRE_SECTION_BUDGET), 'replace');
      logMemoryAudit('memoire', 'prune', section, 'over budget compression');
      console.log(`[Memory] Compressed memoire.${section}: ${content.length}→${compressed.length} chars`);
    } catch {}
  }

  // ── PRIVATE: prune self-improve notes below quality threshold ─────────────
  private async pruneWeakNotes(): Promise<void> {
    const notes = getSelfImproveNotes() as any[];
    if (notes.length <= 5) return; // never prune below 5

    // Sort by usefulness ascending — prune the weakest first
    const sorted = [...notes].sort((a, b) => (a.usefulness ?? 0.5) - (b.usefulness ?? 0.5));

    let pruned = 0;
    for (const note of sorted) {
      if (notes.length - pruned <= 5) break;          // keep at least 5
      if ((note.usefulness ?? 0.5) < NOTE_PRUNE_THRESHOLD) {
        await deleteSelfImproveNote(note.id);
        logMemoryAudit('self_improve', 'prune', String(note.id), `usefulness=${note.usefulness}`);
        pruned++;
      }
    }

    // Also enforce hard cap
    if (notes.length - pruned > NOTE_MAX_ACTIVE) {
      const toPrune = sorted.slice(0, notes.length - pruned - NOTE_MAX_ACTIVE);
      for (const note of toPrune) {
        await deleteSelfImproveNote(note.id);
        logMemoryAudit('self_improve', 'prune', String(note.id), 'hard cap');
        pruned++;
      }
    }

    if (pruned > 0) console.log(`[Memory] Pruned ${pruned} weak self-improve notes`);
  }
}