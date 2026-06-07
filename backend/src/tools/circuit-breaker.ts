// ─────────────────────────────────────────────────────────────────────────────
//  GAP 2 FIX: Tool timeout + circuit breaker
//  Add to: src/tools/hub.ts — wrap the call() method
//  Add to: src/orchestrator.ts — wrap tool calls
//
//  Why it matters for hackathon:
//    browse_web with a slow URL currently hangs the ENTIRE agent loop.
//    A circuit breaker means one bad tool can't kill a 15-turn session.
// ─────────────────────────────────────────────────────────────────────────────

// ── src/tools/circuit-breaker.ts ─────────────────────────────────────────────

interface BreakerState {
  failures:    number;
  lastFailure: number;
  state:       'closed' | 'open' | 'half-open';
}

const BREAKER_THRESHOLD    = 3;        // failures before opening
const BREAKER_TIMEOUT_MS   = 60_000;   // 1 min cooldown before half-open
const TOOL_TIMEOUT_MS: Record<string, number> = {
  // Fast tools — tight leash
  get_inventory:      3_000,
  db_update:          3_000,
  to_table:           3_000,
  to_html:            3_000,
  save_to_memory:     3_000,
  search_memory:      4_000,
  analyze_project:   15_000,
  // Slow tools — generous but bounded
  web_search:        10_000,
  browse_web:        20_000,
  generate_pdf:      15_000,
  export_excel:      10_000,
  request_local_file: 120_000,   // wait up to 2 minutes for the user to select a file
  live_screen:        8_000,
  send_email:        12_000,
  // Default for anything not listed
  _default:           8_000,
};

const breakers = new Map<string, BreakerState>();

function getBreaker(tool: string): BreakerState {
  if (!breakers.has(tool)) breakers.set(tool, { failures: 0, lastFailure: 0, state: 'closed' });
  return breakers.get(tool)!;
}

export function isCircuitOpen(tool: string): boolean {
  const b = getBreaker(tool);
  if (b.state === 'closed') return false;
  if (b.state === 'open') {
    // Try half-open after cooldown
    if (Date.now() - b.lastFailure > BREAKER_TIMEOUT_MS) {
      b.state = 'half-open';
      console.log(`[Circuit] ${tool} → half-open (testing)`);
      return false;
    }
    return true;
  }
  return false; // half-open: allow one through
}

export function recordToolSuccess(tool: string) {
  const b = getBreaker(tool);
  b.failures = 0;
  if (b.state === 'half-open') {
    b.state = 'closed';
    console.log(`[Circuit] ${tool} → closed (recovered)`);
  }
}

export function recordToolFailure(tool: string) {
  const b = getBreaker(tool);
  b.failures++;
  b.lastFailure = Date.now();
  if (b.failures >= BREAKER_THRESHOLD) {
    if (b.state !== 'open') {
      b.state = 'open';
      console.warn(`[Circuit] ${tool} → OPEN after ${b.failures} failures`);
    }
  }
}

export function getCircuitStatus(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tool, b] of breakers) {
    if (b.state !== 'closed') out[tool] = `${b.state} (${b.failures} failures)`;
  }
  return out;
}

// ── Timeout wrapper ───────────────────────────────────────────────────────────

export async function withTimeout<T>(
  fn: () => Promise<T>,
  toolName: string,
  overrideMs?: number,
): Promise<T> {
  const ms = overrideMs ?? TOOL_TIMEOUT_MS[toolName] ?? TOOL_TIMEOUT_MS['_default'];

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool "${toolName}" timed out after ${ms}ms`));
    }, ms);

    fn().then(
      result => { clearTimeout(timer); resolve(result); },
      error  => { clearTimeout(timer); reject(error); },
    );
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  PATCH hub.ts call() method — replace the existing one with this:
// ─────────────────────────────────────────────────────────────────────────────

/*
  async call(toolName: string, args?: any): Promise<string> {
    const fn = this.tools.get(toolName);
    if (!fn) return `❌ Unknown tool: "${toolName}". Available: ${this.listToolsSync().join(', ')}`;

    // ── Circuit breaker check ────────────────────────────────────────────────
    if (isCircuitOpen(toolName)) {
      console.warn(`[Circuit] ${toolName} is OPEN — skipping`);
      return `❌ Tool "${toolName}" is temporarily unavailable (too many recent failures). Retry in ~1 minute.`;
    }

    agentEventEmitter.emit('tool_start', { type: 'tool_start', tool: toolName });
    try {
      const result = await withTimeout(() => fn(args), toolName);
      recordToolSuccess(toolName);
      agentEventEmitter.emit('tool_end', { type: 'tool_end', tool: toolName, status: 'success' });
      return result;
    } catch (e: any) {
      recordToolFailure(toolName);
      agentEventEmitter.emit('tool_end', { type: 'tool_end', tool: toolName, status: 'failed', error: e.message });
      emitTask(`${toolName} → FAILED: ${e.message}`, 'failed');
      const isTimeout = e.message?.includes('timed out');
      return `❌ ${isTimeout ? 'Timeout' : 'Error'} in ${toolName}: ${e.message}`;
    }
  }
*/

export const CIRCUIT_BREAKER_PATCH = `
Replace the call() method in ToolsHub with the version above.
Import { isCircuitOpen, recordToolSuccess, recordToolFailure, withTimeout } from './circuit-breaker'
at the top of hub.ts.
`;