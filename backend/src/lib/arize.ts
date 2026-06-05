// src/lib/arize.ts
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';

let initialized = false;

function init(): boolean {
  if (initialized) return true;

  const apiKey  = process.env.ARIZE_API_KEY;
  const spaceId = process.env.ARIZE_SPACE_ID;

  if (!apiKey || !spaceId) {
    console.log('[Arize] Not configured – skipping tracing.');
    return false;
  }

  const exporter = new OTLPTraceExporter({
    url: 'https://otlp.arize.com/v1/traces',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'space_id':      spaceId,
      'Connection':    'close',
    },
  });

  const provider = new NodeTracerProvider({
    resource: new Resource({
      'service.name':       'kasra-agent',
      'model_id':           'kasra',
      'arize.project.name': 'kasra-agent',
    }),
  });

  // Use type assertion to bypass the missing method error in some TS versions
  (provider as any).addSpanProcessor(new BatchSpanProcessor(exporter));
  (provider as any).register();

  initialized = true;
  console.log('[Arize] Tracing enabled.');
  return true;
}

export function traceAgentStep(data: {
  turn: number; sessionId: string; goal: string; reason: string;
  commands: string[]; output: string; status: string;
}): void {
  const apiKey  = process.env.ARIZE_API_KEY;
  const spaceId = process.env.ARIZE_SPACE_ID;
  if (!apiKey || !spaceId) return;

  const payload = {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'kasra-agent' } },
          { key: 'model_id', value: { stringValue: 'kasra' } },
          { key: 'arize.project.name', value: { stringValue: 'kasra-agent' } },
        ],
      },
      scopeSpans: [{
        scope: { name: 'agent-step' },
        spans: [{
          traceId: Math.random().toString(16).padStart(32, '0'),
          spanId:  Math.random().toString(16).padStart(16, '0'),
          name:    'agent-step',
          kind:    1,
          startTimeUnixNano: String(Date.now() * 1_000_000),
          endTimeUnixNano:   String(Date.now() * 1_000_000 + 1_000_000_000),
          attributes: [
            { key: 'turn',        value: { intValue: data.turn } },
            { key: 'session_id',  value: { stringValue: data.sessionId } },
            { key: 'goal',        value: { stringValue: data.goal.slice(0, 200) } },
            { key: 'reason',      value: { stringValue: data.reason } },
            { key: 'commands',    value: { stringValue: data.commands.join(', ') || 'none' } },
            { key: 'output',      value: { stringValue: data.output.slice(0, 200) } },
            { key: 'status',      value: { stringValue: data.status } },
          ],
        }],
      }],
    }],
  };

  fetch('https://otlp.arize.com/v1/traces', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'space_id':      spaceId,
      'Connection':    'close',
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function traceSessionOutcome(data: {
  sessionId: string;
  goal: string;
  toolsUsed: string[];
  turnCount: number;
  outcome: string;
}): void {
  if (!init()) return;
  const tracer = trace.getTracer('kasra-agent');
  const span = tracer.startSpan('session-outcome');
  span.setAttributes({
    'session_id':  data.sessionId,
    'goal':        data.goal.slice(0, 200),
    'tools_used':  data.toolsUsed.join(', '),
    'turn_count':  data.turnCount,
    'outcome':     data.outcome,
  });
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
  const provider = (trace.getTracerProvider() as any)?._delegate;
if (provider) {
  provider.forceFlush?.();
}
}