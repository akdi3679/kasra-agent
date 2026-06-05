// src/lib/llm.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

// ── Types ──────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class RateLimitError extends Error {
  constructor() { super('rate_limit'); }
}

// ── Helpers ───────────────────────────────────────────────────────
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Provider: Cerebras ────────────────────────────────────────────
async function tryCerebras(prompt: string): Promise<string> {
  const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CEREBRAS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama3.1-8b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(`[Cerebras] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Cerebras HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  if (!raw.trim()) throw new Error('Cerebras: empty response');
  console.log('[LLM] Cerebras succeeded');
  return stripThinkTags(raw);
}


// ── Provider: Groq ────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

async function tryGroq(prompt: string, retries = 2): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const completion = await groq.chat.completions.create({
        model: 'qwen/qwen3-32b',
        messages: [{ role: 'user', content: prompt }] as any,
        temperature: 0.5,
        max_tokens: 4096,
      });
      const raw = completion.choices[0]?.message?.content ?? '';
      if (!raw.trim()) throw new Error('Groq: empty response');
      console.log('[LLM] Groq succeeded');
      return stripThinkTags(raw);
    } catch (err: any) {
      if (err.status === 429) {
        console.warn(`[Groq] Rate limited — attempt ${i + 1}/${retries}. Waiting ${2000 * (i + 1)}ms...`);
        await sleep(2000 * (i + 1));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Groq: failed after retries');
}

// ── Provider: Gemini ──────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

async function tryGemini(prompt: string, retries = 2): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      } as any);
      const raw = result.response.text();
      if (!raw.trim()) throw new Error('Gemini: empty response');
      console.log('[LLM] Gemini succeeded');
      return stripThinkTags(raw);
    } catch (err: any) {
      console.error('[Gemini] Error:', JSON.stringify(err)?.slice(0, 200));
      if (err?.status === 429) {
        console.warn('[Gemini] Rate limited — waiting 10s...');
        await sleep(10000);
        continue;
      }
      break;
    }
  }
  throw new Error('Gemini: failed');
}

// ── Provider: OpenRouter ──────────────────────────────────────────
async function tryOpenRouter(prompt: string): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OpenRouter: no API key');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.2-3b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      temperature: 0.6,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(`[OpenRouter] HTTP ${response.status}: ${errText.slice(0, 200)}`);
    throw new Error(`OpenRouter HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  if (!raw.trim()) throw new Error('OpenRouter: empty response');
  console.log('[LLM] OpenRouter succeeded');
  return stripThinkTags(raw);
}

// ── Utility: merge system prompt into first user message ──────────
function mergeSysIntoUser(messages: ChatMessage[]): { role: string; content: string }[] {
  const systemMsg = messages.find(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');
  if (!systemMsg) return rest;

  const firstUser = rest.findIndex(m => m.role === 'user');
  if (firstUser === -1) {
    return [{ role: 'user', content: `${systemMsg.content}\n\n---\n\n(no user message)` }];
  }
  const merged = [...rest];
  merged[firstUser] = {
    role: 'user',
    content: `${systemMsg.content}\n\n---\n\n${merged[firstUser].content}`,
  };
  return merged;
}

// ── Provider: Hugging Face Inference (free, no card) ─────────────
async function tryHuggingFace(prompt: string): Promise<string> {
  if (!process.env.HUGGINGFACE_TOKEN) throw new Error('HF: no token');

  const res = await fetch(
    'https://api-inference.huggingface.co/models/Qwen/Qwen2.5-1.5B-Instruct/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen2.5-1.5B-Instruct',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[HF] HTTP ${res.status}: ${errText.slice(0, 200)}`);
    throw new Error(`HF HTTP ${res.status}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  if (!raw.trim()) throw new Error('HF: empty response');
  console.log('[LLM] HuggingFace succeeded');
  return stripThinkTags(raw);
}

// ── Provider: Cloudflare Workers AI (free, 100K req/day) ────────
async function tryCloudflare(prompt: string): Promise<string> {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare: missing credentials');
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[Cloudflare] HTTP ${res.status}: ${errText.slice(0, 200)}`);
    throw new Error(`Cloudflare HTTP ${res.status}`);
  }

  const data = await res.json();

  // Cloudflare returns: { result: { response: { output, reason, notes, commands } } }
  const inner = data.result?.response;

  if (typeof inner === 'string') {
    // Sometimes the response is a JSON string
    console.log('[LLM] Cloudflare succeeded (string response)');
    return stripThinkTags(inner);
  }

  if (inner && typeof inner === 'object') {
    // The AI response is already the object we need – stringify it for the orchestrator
    console.log('[LLM] Cloudflare succeeded (object response)');
    return JSON.stringify(inner);
  }

  console.error('[Cloudflare] Could not extract response. Full data:', JSON.stringify(data).slice(0, 500));
  throw new Error('Cloudflare: unexpected response format');
}


// ── Model Registry (single source of truth) ──────────────────────

export interface ModelEntry {
  id: string;                // unique key used by frontend & fallback
  name: string;              // human‑readable name
  provider: string;          // provider name (shown in UI)
  available: boolean;        // automatically true if the required env var exists
  fn: (prompt: string) => Promise<string>;  // the actual call function
}

export const MODEL_REGISTRY: ModelEntry[] = [
  {
    id: 'openrouter',
    name: 'Llama 3.2 3B (Free)',
    provider: 'OpenRouter',
    available: !!process.env.OPENROUTER_API_KEY,
    fn: tryOpenRouter,
  },
  {
    id: 'cloudflare',
    name: 'Llama 3.3 70B',
    provider: 'Cloudflare Workers AI',
    available: !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
    fn: tryCloudflare,
  },
  {
    id: 'huggingface',
    name: 'Qwen 2.5 1.5B',
    provider: 'HuggingFace Inference',
    available: !!process.env.HUGGINGFACE_TOKEN,
    fn: tryHuggingFace,
  },
  {
    id: 'cerebras',
    name: 'Llama 3.1 8B',
    provider: 'Cerebras',
    available: !!process.env.CEREBRAS_API_KEY,
    fn: tryCerebras,
  },
  {
    id: 'groq',
    name: 'Qwen 3 32B',
    provider: 'Groq',
    available: !!process.env.GROQ_API_KEY,
    fn: tryGroq,
  },
  {
    id: 'gemini',
    name: 'Gemini Flash',
    provider: 'Google',
    available: !!process.env.GEMINI_API_KEY,
    fn: tryGemini,
  },
];
// ── Main export ───────────────────────────────────────────────────
export async function generateWithFallback(
  promptOrMessages: string | ChatMessage[],
  preferredModel?: string,
): Promise<string> {
  const messages: ChatMessage[] = typeof promptOrMessages === 'string'
    ? [{ role: 'user', content: promptOrMessages }]
    : promptOrMessages;

  const promptStr = mergeSysIntoUser(messages)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  // Build an ordered list of available providers
  let ordered = MODEL_REGISTRY.filter(m => m.available);

  // Move the preferred model to the front, if specified and available
  if (preferredModel) {
    const idx = ordered.findIndex(m => m.id === preferredModel);
    if (idx !== -1) {
      const [pref] = ordered.splice(idx, 1);
      ordered.unshift(pref);
    } else {
      console.warn(`[LLM] Preferred model "${preferredModel}" not available – falling back.`);
    }
  }

  const retryDelays = [10000, 25000, 60000];

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    for (const model of ordered) {
      try {
        const raw = await model.fn(promptStr);
        if (raw?.trim()) return stripThinkTags(raw);
      } catch (err: any) {
        console.warn(`[LLM] ${model.name} failed: ${err.message?.slice(0, 100)}`);
      }
    }

    if (attempt < retryDelays.length - 1) {
      console.log(`[LLM] All providers failed — retrying in ${retryDelays[attempt] / 1000}s...`);
      await sleep(retryDelays[attempt]);
    }
  }

  throw new RateLimitError();
}