// src/core/scheduler.ts
import { Orchestrator } from '../orchestrator';
import {
  getScheduledTasks,
  markTaskDone,
  deleteScheduledTask,
  getScheduledTaskById,
  saveChatMessage,
} from '../files';
import { agentEventEmitter } from '../events';
import { sessionHistories } from '../orchestrator';

// ── Cron session pool ───────────────────────────────────────────
//const cronSessionPool: { sessionId: string; msgCount: number }[] = [];
//const MAX_CRON_SESSION_MESSAGES = 40;

/*function getCronSession(): string {
  const active = cronSessionPool[cronSessionPool.length - 1];
  if (active && active.msgCount < MAX_CRON_SESSION_MESSAGES) {
    return active.sessionId;
  }
  const newId = `cron_pool_${cronSessionPool.length + 1}`;
  cronSessionPool.push({ sessionId: newId, msgCount: 0 });
  sessionHistories.set(newId, []);
  return newId;
}

function incrementCronSessionMsgCount() {
  const active = cronSessionPool[cronSessionPool.length - 1];
  if (active) active.msgCount++;
}*/

// ── Scheduler ────────────────────────────────────────────────────
export class Scheduler {
  private orchestrator: Orchestrator;
  private notify?: (chatId: number, text: string) => Promise<void>;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    orchestrator: Orchestrator,
    notify?: (chatId: number, text: string) => Promise<void>
  ) {
    this.orchestrator = orchestrator;
    this.notify = notify;
    this.start();
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 5000);
    console.log('⏰ Scheduler started (5s interval)');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('⏰ Scheduler stopped');
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const tasks = getScheduledTasks() as any[];
      if (tasks.length === 0) return;
      console.log(`[Scheduler] ${tasks.length} task(s) due`);

      for (const t of tasks) {
        console.log(`[Scheduler] Running task #${t.id}: "${t.prompt}"`);

        // Use the shared cron session (pooled)
const execSessionId = `cron_${t.id}_${Date.now()}`;
        const userSessionId = String(t.chat_id || 'default');
        const cronGoal = t.prompt;

        try {
          const result = await this.orchestrator.process(cronGoal, execSessionId);

          // After successful run, increment the shared session's message count
         // incrementCronSessionMsgCount();

          markTaskDone(t.id);

          // Deliver result to user's chat
          const taggedResult = `[CRON_RESULT|task_id:${t.id}|prompt:${t.prompt.slice(0, 60)}]\n${result}`;
          saveChatMessage(userSessionId, 'assistant', taggedResult);
//sessionHistories.push(userSessionId, { role: 'assistant', content: taggedResult });

          agentEventEmitter.emit('cron_result', {
            type: 'cron_result',
            session_id: userSessionId,
            task_id: t.id,
            prompt: t.prompt,
            output: result,
          });

          agentEventEmitter.emit('task', {
            type: 'task',
            task: {
              id: `cron_done_${t.id}`,
              description: `✅ Cron #${t.id} complete`,
              status: 'done',
              timestamp: new Date().toISOString(),
            },
          });

          // Check max_runs and delete if needed
          const updated = getScheduledTaskById(t.id) as any;
          if (updated && updated.max_runs !== null && updated.run_count >= updated.max_runs) {
            deleteScheduledTask(t.id);
            console.log(`[Scheduler] Task #${t.id} reached max_runs (${updated.max_runs}) — deleted`);
            agentEventEmitter.emit('task', {
              type: 'task',
              task: {
                id: `cron_deleted_${t.id}`,
                description: `🗑️ Cron #${t.id} auto-deleted after ${updated.max_runs} run(s)`,
                status: 'done',
                timestamp: new Date().toISOString(),
              },
            });
          }
        } catch (err: any) {
          if (err.message?.includes('rate') || err.message?.includes('429')) {
            console.warn(`[Scheduler] Task #${t.id} rate-limited, will retry`);
          } else {
            markTaskDone(t.id);
            console.error(`[Scheduler] Task #${t.id} failed:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] tick error:', err);
    } finally {
      this.running = false;
    }
  }
}