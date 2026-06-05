// src/tools/embedder.ts
// Uses TF‑IDF vectorisation (zero native deps, always works)

export async function embed(text: string): Promise<number[]> {
  return tfidfVector(text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function tfidfVector(text: string): number[] {
  const DIM = 1024;
  const vec = new Float64Array(DIM);
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 1);
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;

  for (const [word, count] of Object.entries(freq)) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const idx = h % DIM;
    vec[idx] += (count / words.length) * Math.log(10 / Math.max(1, word.length - 2));
  }

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return Array.from(vec).map(v => v / norm);
}  