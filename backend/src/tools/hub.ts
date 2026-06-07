// src/tools/hub.ts
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { agentEventEmitter } from '../events';
import {
  getInventory, updateInventoryQuantity,
  addScheduledTask, getAllScheduledTasks,
  updateTaskStatus, updateScheduledTask, deleteScheduledTask,
  updateMemoire, syncCPMFromTools, searchSessionFacts 
} from '../files';
import { isCircuitOpen, recordToolSuccess, recordToolFailure, withTimeout } from './circuit-breaker';
import { callMCPTool } from './mcp-client';
import { gitlabCreateIssue, gitlabSearchMergeRequests, fivetranSyncDataSource, elasticSearchLogs, dynatraceGetMetrics } from './partner-tools';
// ── Helpers ───────────────────────────────────────────────────
const memoryStore: { embedding: number[]; text: string; timestamp: string }[] = [];
let memoryLoaded = false;
function emitTask(desc: string, status: 'done' | 'failed' | 'running' = 'done') {
  agentEventEmitter.emit('task', {
    type: 'task',
    task: { id: `t_${Date.now()}_${Math.random().toString(36).substr(2,5)}`, description: desc, status, timestamp: new Date().toISOString() },
  }); 
}
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function parseCron(expr: string) {
  const m = require('cron-parser');
  const fn = m.parseExpression ?? m.default?.parseExpression ?? m;
  if (typeof fn !== 'function') throw new Error(`cron-parser not callable`);
  return fn(expr);
}


function loadMemoryStore() {
  if (memoryLoaded) return;
  const memoryFile = path.join(process.cwd(), 'vector_memory.json');
  try {
    if (fs.existsSync(memoryFile)) {
      const data = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
      memoryStore.push(...data);
    }
    memoryLoaded = true;
  } catch {}
}

function saveMemoryStore() {
  const memoryFile = path.join(process.cwd(), 'vector_memory.json');
  fs.writeFileSync(memoryFile, JSON.stringify(memoryStore, null, 2));
}
// ── ToolsHub ──────────────────────────────────────────────────

export class ToolsHub {
  private tools = new Map<string, (args?: any) => Promise<string>>();

  constructor() {

    // ── Inventory ───────────────────────────────────────────
    this.register('get_inventory', async () => JSON.stringify(getInventory()));

    this.register('get_sales_data', async () => {
      const inv = getInventory() as any[];
      return JSON.stringify(inv.map(i => ({
        product_name: i.product_name,
        current_stock: i.quantity,
        min_quantity: i.min_quantity,
        unit_price: i.unit_price,
        avg_daily_sales: +(i.quantity / 7).toFixed(1),
        est_days_to_stockout: i.quantity > 0 ? Math.floor(i.quantity / Math.max(i.quantity / 7, 0.1)) : 0,
      })));
    });

    this.register('db_update', async (args: any) => {
      if (args?.id === undefined || args?.quantity === undefined)
        return '❌ db_update requires: { id, quantity }';
      updateInventoryQuantity(Number(args.id), Number(args.quantity));
      emitTask(`db_update → product #${args.id} → ${args.quantity} units`);
      return `✅ Inventory updated: product #${args.id} → ${args.quantity} units`;
    });

    // ── Web Search ──────────────────────────────────────────
  this.register('web_search', async (args: any) => {
  if (!args?.query) return '❌ requires: { query }';
  const query = encodeURIComponent(args.query);

  // Use Google's search page directly – always returns results
  try {
    const res = await fetch(`https://www.google.com/search?q=${query}&hl=en`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Extract result links from Google's search page
    const links: { title: string; url: string; snippet: string }[] = [];
    const linkRegex = /<a[^>]*href="\/url\?q=([^"&]*)[^"]*"[^>]*>(.*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const url = decodeURIComponent(match[1]);
      const title = match[2].replace(/<[^>]*>/g, '').trim();
      if (title && url.startsWith('http') && !url.includes('google.com')) {
        links.push({ title, url, snippet: '' });
      }
    }

    if (links.length > 0) {
      return JSON.stringify({ query: args.query, results: links.slice(0, 5), source: 'google' });
    }
  } catch (e: any) {
    // Google failed – try DuckDuckGo lite
    try {
      const ddgRes = await fetch(`https://lite.duckduckgo.com/lite/?q=${query}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Amazan/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      const ddgHtml = await ddgRes.text();
      const links: { title: string; url: string; snippet: string }[] = [];
      const re = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ddgHtml)) !== null) {
        links.push({ title: m[2].trim(), url: m[1], snippet: '' });
      }
      if (links.length > 0) {
        return JSON.stringify({ query: args.query, results: links.slice(0, 5), source: 'duckduckgo' });
      }
    } catch {}
  }

  return JSON.stringify({ query: args.query, results: [], note: 'No results found.' });
});

    // ── Browse Web — fetch and read a full URL ──────────────
   // ── Browse Web — 3-layer free fallback ──────────────────
this.register('browse_web', async (args: any) => {
  if (!args?.url) return '❌ browse_web requires: { url }';
  const url = args.url.startsWith('http') ? args.url : `https://${args.url}`;

  emitTask(`browse_web → ${url}`, 'running');

  // ═══ LAYER 1: Jina Reader API (free, no key) ═══
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/markdown, application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Amazan/1.0)',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50 && !text.startsWith('Error')) {
        emitTask(`browse_web → ${url} (Jina)`, 'done');
        return JSON.stringify({
          url,
          method: 'jina_reader',
          content: text.slice(0, 12000),
          length: text.length,
        });
      }
    }
  } catch (err) {
    console.log('[Browse] Jina Reader failed, trying local fetch...');
  }

  // ═══ LAYER 2: Direct fetch + Cheerio HTML cleaning ═══
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Extract readable text with Cheerio
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, footer, header, iframe, noscript, [aria-hidden="true"]').remove();

    // Get the main content, preferring <article> or <main>
    const mainEl = $('article, main, [role="main"], .post-content, .article-content, #content').first();
    const contentEl = mainEl.length ? mainEl : $('body');

    // Extract text and collapse whitespace
    let text = contentEl.text()
      .replace(/[\t\r]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Fallback: if Cheerio gave us too little, use regex-based extraction
    if (text.length < 200) {
      text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    emitTask(`browse_web → ${url} (cheerio)`, 'done');
    return JSON.stringify({
      url,
      method: 'cheerio',
      content: text.slice(0, 12000),
      length: text.length,
    });
  } catch (err: any) {
    console.log('[Browse] Cheerio failed, trying raw fetch...');
  }

  // ═══ LAYER 3: Raw fetch + regex stripping (fallback) ═══
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Amazan/1.0)',
        'Accept': 'text/html,*/*',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return `❌ browse_web: HTTP ${res.status} for ${url}`;
    const html = await res.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 8000);

    emitTask(`browse_web → ${url} (raw)`, 'done');
    return JSON.stringify({
      url,
      method: 'raw_fetch',
      content: text,
      length: text.length,
    });
  } catch (err: any) {
    emitTask(`browse_web → FAILED: ${err.message}`, 'failed');
    return `❌ browse_web error: ${err.message}`;
  }
});


// ── Read a local text file ───────────────────────────────
this.register('read_local_file', async (args: any) => {
  if (!args?.path) return '❌ requires: { path }';
  const resolved = path.isAbsolute(args.path)
    ? args.path
    : path.join(process.cwd(), args.path);
  try {
    if (!fs.existsSync(resolved)) return `❌ File not found: ${resolved}`;
    const content = fs.readFileSync(resolved, 'utf-8');
    const trimmed = content.slice(0, 20_000);
    emitTask(`read_local_file → ${path.basename(resolved)}`);

    // Inject the extracted text as a hidden pill into the frontend input
    agentEventEmitter.emit('file_inject', {
      type: 'file_inject',
      fileName: path.basename(resolved),
      filePath: resolved,
      extractedText: trimmed,
    });

    return JSON.stringify({
      path: resolved,
      content: trimmed,
      size: content.length,
      truncated: content.length > 20_000,
    });
  } catch (err: any) {
    return `❌ read_local_file error: ${err.message}`;
  }
});
this.register('desktop_control', async (args: any) => {
  const action = args?.action;
  const target = args?.target || '';
  if (!action) return '❌ requires: { action, target? }';

  try {
    const { exec } = require('child_process');
    const runCmd = (command: string): Promise<void> =>
      new Promise((resolve) => {
        exec(command, { shell: 'cmd.exe' }, () => resolve());
      });

    switch (action) {
      case 'open':
case 'open_url':
case 'browse': {
  const { exec } = require('child_process');
  const openCmd = process.platform === 'win32'   ? `start "" "${target}"`
                : process.platform === 'darwin'  ? `open "${target}"`
                : `xdg-open "${target}"`;
  await new Promise<void>((resolve) => exec(openCmd, () => resolve()));
  return `✅ Opened: ${target}`;
}


      case 'open_folder':
case 'explorer': {
  const { exec } = require('child_process');
  const folderCmd = process.platform === 'win32'  ? `explorer "${target || '.'}"`
                  : process.platform === 'darwin' ? `open "${target || '.'}"`
                  : `xdg-open "${target || '.'}"`;
  await new Promise<void>((resolve) => exec(folderCmd, () => resolve()));
  return `✅ Opened folder: ${target || 'current directory'}`;
}

      case 'close_window':
      case 'close': {
        const cmd = `taskkill /FI "WINDOWTITLE eq ${target}*" /F`;
        await runCmd(cmd);
        return `✅ Closed windows matching: ${target}`;
      }

      case 'type': {
        const escaped = (args.text || '').replace(/'/g, "''");
        const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')"`;
        await runCmd(psCmd);
        return `✅ Typed text`;
      }

      case 'press':
      case 'hotkey': {
        const keys = (args.keys || []).join('').replace(/ctrl/gi, '^').replace(/alt/gi, '%').replace(/shift/gi, '+').replace(/win/gi, '#');
        const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')"`;
        await runCmd(psCmd);
        return `✅ Pressed keys: ${args.keys?.join('+')}`;
      }

      default:
        return `❌ Unknown action: "${action}"`;
    }
  } catch (err: any) {
    return `❌ error: ${err.message}`;
  }
});
// ── List files in a directory ────────────────────────────
this.register('list_local_directory', async (args: any) => {
  const dir = args?.path || process.cwd();
  const resolved = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  try {
    if (!fs.existsSync(resolved)) return `❌ Directory not found: ${resolved}`;
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const list = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
    }));
    emitTask(`list_local_directory → ${resolved}`);
    return JSON.stringify({ path: resolved, entries: list });
  } catch (err: any) {
    return `❌ list_local_directory error: ${err.message}`;
  }
});



    // ── Export Excel ────────────────────────────────────────
   this.register('export_excel', async (args: any) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');
  ws.columns = [
    { header: 'Product', key: 'name', width: 30 },
    { header: 'Qty', key: 'qty', width: 12 },
    { header: 'Min Qty', key: 'min', width: 12 },
    { header: 'Price', key: 'price', width: 14 },
  ];
  (getInventory() as any[]).forEach(i =>
    ws.addRow({ name: i.product_name, qty: i.quantity, min: i.min_quantity, price: i.unit_price })
  );
  const dir = path.join(process.cwd(), 'public', 'files');
  fs.mkdirSync(dir, { recursive: true });
  const filename = args?.filename || `inventory_${Date.now()}.xlsx`;
  await wb.xlsx.writeFile(path.join(dir, filename));
  const url = `http://kasra-agent.onrender.com/files/${filename}`;
  emitTask(`export_excel → ${filename}`);
  // Return ONLY the URL so the orchestrator can build an attachment card
  return url;
});

    // ── iCal Event ──────────────────────────────────────────
    this.register('create_ical_event', async (args: any) => {
      if (!args?.summary || !args?.start) return '❌ create_ical_event requires: { summary, start }';
      const fmt = (s: string) => s.replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15) + 'Z';
      const ical = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Amazan//OS//EN',
        'BEGIN:VEVENT',
        `UID:${Date.now()}@amazan`,
        `DTSTART:${fmt(args.start)}`,
        `DTEND:${fmt(args.end || args.start)}`,
        `SUMMARY:${args.summary}`,
        `DESCRIPTION:${args.description || ''}`,
        'END:VEVENT', 'END:VCALENDAR',
      ].join('\r\n');
      const dir = path.join(process.cwd(), 'public', 'files');
      fs.mkdirSync(dir, { recursive: true });
      const filename = `event_${Date.now()}.ics`;
      fs.writeFileSync(path.join(dir, filename), ical, 'utf-8');
      emitTask(`create_ical_event → "${args.summary}"`);
      return `✅ Calendar event created: http://kasra-agent.onrender.com/files/${filename}`;
    });

    // ── Partner Tools ───────────────────────────────────────
    this.register('gitlab_create_issue', async (args: any) => {
      if (!args?.summary) return '❌ requires: { summary }';
      const r = await gitlabCreateIssue(args.summary, args.description || '');
      emitTask(`gitlab_create_issue → "${args.summary}"`);
      return r;
    });
    this.register('gitlab_search_merge_requests', async (args: any) => gitlabSearchMergeRequests(args?.query || ''));
this.register('fivetran_sync_data', async (args: any) => {
  const source = args?.source || 'default';

  // Path 1: MCP server
  if (process.env.FIVETRAN_MCP === 'true') {
    try {
      const { callMCPTool } = require('./mcp-client');
      const result = await callMCPTool('fivetran', 'sync_connector', {
        connector_id: process.env.FIVETRAN_CONNECTOR_ID || source,
        force: true,
      });
      emitTask(`fivetran_sync_data (MCP) → "${source}"`);
      console.log('[MCP] fivetran_sync_data succeeded via MCP');
      return result;
    } catch (e: any) {
      console.warn('[MCP] Fivetran MCP failed, falling back to REST:', e.message);
    }
  }

  // Path 2: REST API (existing logic preserved)
  const { fivetranSyncDataSource } = require('./partner-tools');
  const result = await fivetranSyncDataSource(source);
  emitTask(`fivetran_sync_data (REST) → "${source}"`);
  return result;
});
this.register('elastic_search_logs', async (args: any) => {
  const query = args?.query || 'error';

  // Path 1: MCP server (set ELASTIC_MCP=true in .env to enable)
  if (process.env.ELASTIC_MCP === 'true') {
    try {
      const { callMCPTool } = require('./mcp-client');
      const result = await callMCPTool('elastic', 'search', {
        index: process.env.ELASTICSEARCH_INDEX || 'logs-*',
        query: { match: { message: query } },
        size: 10,
      });
      emitTask(`elastic_search_logs (MCP) → "${query}"`);
      console.log('[MCP] elastic_search_logs succeeded via MCP');
      return result;
    } catch (e: any) {
      console.warn('[MCP] Elastic MCP failed, falling back to REST:', e.message);
    }
  }

  // Path 2: REST API (existing logic preserved)
  const { elasticSearchLogs } = require('./partner-tools');
  const result = await elasticSearchLogs(query);
  emitTask(`elastic_search_logs (REST) → "${query}"`);
  return result;
});
    this.register('dynatrace_get_metrics', async (args: any) => dynatraceGetMetrics(args?.metric || 'cpu_usage'));

    // ── Analyze Project ─────────────────────────────────────
    this.register('analyze_project', async (args?: any) => {
  const targetPath = args?.path || process.env.PROJECT_ROOT || path.join(process.cwd(), 'src');
  const customPatterns: { name: string; regex: string }[] = args?.patterns || [];
  const maxFileSize = args?.max_file_size || 200_000;    // skip files larger than ~200KB
  const includeGlob = args?.include || '**/*';          // e.g., "src/**/*.ts"
  const excludeDirs = args?.exclude || ['node_modules', 'dist', '.git', '.next', 'public/files', 'public/uploads'];

  const summary: any = {
    analyzedAt: new Date().toISOString(),
    path: targetPath,
    fileCount: 0,
    totalLines: 0,
    languages: new Set<string>(),
    frameworks: new Set<string>(),
    endpoints: [] as any[],
    databaseTables: [] as string[],
    imports: [] as { from: string; source: string }[],
    exports: [] as { type: string; names: string[] }[],
    classes: [] as string[],
    functions: [] as string[],
    customSearches: {} as Record<string, string[]>,
  };

  // Helper: recursively walk directory, respecting exclude dirs
  const walk = (dir: string): string[] => {
    let files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.'))
            files = files.concat(walk(full));
        } else if (entry.isFile()) {
          // Simple glob: if includeGlob is set, we'd need a proper glob matcher. For now, we just take all files.
          // But we filter by extension patterns if includeGlob looks like "*.ts" (later).
          files.push(full);
        }
      }
    } catch {}
    return files;
  };

  const allFiles = walk(targetPath);
  const fileSamples: string[] = [];

  for (const filePath of allFiles) {
    // skip binary/common non-text
    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.html', '.css', '.scss', '.py', '.java', '.xml', '.yml', '.yaml', '.env', '.cfg', '.ini', '.cs', '.c', '.h', '.cpp', '.hpp', '.rb', '.go', '.rs', '.swift', '.kt'];
    if (!textExtensions.includes(ext)) continue;

    // Check file size
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > maxFileSize) continue;
    } catch { continue; }

    summary.fileCount++;
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch { continue; }

    const lines = content.split('\n');
    summary.totalLines += lines.length;
    summary.languages.add(ext.replace('.', ''));

    // Framework detection via config files
    const baseName = path.basename(filePath);
    if (baseName === 'package.json') {
      try {
        const pkg = JSON.parse(content);
        if (pkg.dependencies) {
          Object.keys(pkg.dependencies).forEach(d => {
            if (d.startsWith('next') || d.startsWith('react') || d === 'express' || d === 'fastify' || d.startsWith('@nestjs')) summary.frameworks.add(d);
          });
        }
      } catch {}
    }
    if (baseName === 'tsconfig.json') summary.frameworks.add('TypeScript');
    if (baseName === 'requirements.txt') summary.frameworks.add('Python');
    if (baseName === 'pom.xml') summary.frameworks.add('Java/Maven');

    // API Endpoints (general HTTP method patterns)
    const routeRegex = /(?:app\.|router\.|this\.(?:get|post|put|delete|patch))\s*\(\s*['"]([^'"]+)['"]/gi;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      summary.endpoints.push({ method: match[0].split('.')[1]?.toUpperCase(), path: match[1], file: path.relative(targetPath, filePath) });
    }

    // SQL tables
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)/gi;
    while ((match = tableRegex.exec(content)) !== null) {
      if (!summary.databaseTables.includes(match[1])) summary.databaseTables.push(match[1]);
    }

    // Imports (ES6/TypeScript): import ... from '...' or require('...')
    const importRegex = /import\s.*?\sfrom\s+['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(content)) !== null) {
      summary.imports.push({ from: match[0].split('from')[0]?.replace('import', '').trim(), source: match[1] });
    }
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      summary.imports.push({ from: match[0], source: match[1] });
    }

    // Exports
    const exportRegex = /export\s+(default\s+)?(class|function|const|let|var)\s+(\w+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      summary.exports.push({ type: match[2], names: [match[3]] });
    }

    // Classes
    const classRegex = /class\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
      summary.classes.push(match[1]);
    }

    // Functions (top-level function declarations)
    const funcRegex = /(?:async\s+)?function\s+(\w+)/g;
    while ((match = funcRegex.exec(content)) !== null) {
      summary.functions.push(match[1]);
    }

    // Custom pattern searches
    for (const pat of customPatterns) {
      try {
        const re = new RegExp(pat.regex, 'g');
        while ((match = re.exec(content)) !== null) {
          if (!summary.customSearches[pat.name]) summary.customSearches[pat.name] = [];
          summary.customSearches[pat.name].push(match[0]);
        }
      } catch {}
    }

    // Keep a few file names for reporting
    if (fileSamples.length < 10) fileSamples.push(path.relative(targetPath, filePath));
  }

  // Convert Sets to arrays for JSON
  summary.languages = [...summary.languages];
  summary.frameworks = [...summary.frameworks];

  // Save to memoire
const compact = {
  analyzedAt: summary.analyzedAt,
  fileCount: summary.fileCount,
  totalLines: summary.totalLines,
  languages: summary.languages,
  frameworks: summary.frameworks,
  endpointCount: summary.endpoints.length,
  tableCount: summary.databaseTables.length,
  tables: summary.databaseTables,
  topFiles: fileSamples,
};
updateMemoire('analyze', JSON.stringify(compact, null, 2), 'replace');
  emitTask(`analyze_project → ${summary.fileCount} files, ${summary.endpoints.length} endpoints, ${summary.databaseTables.length} tables`);

  return JSON.stringify(summary, null, 2);
});
this.register('to_table', async (args: any) => {
  // Accept columns + rows or raw data
  const columns: string[] = args?.columns || [];
  let rows: any[][] = args?.rows || [];

  if (rows.length === 0 && args?.data) {
    const data = Array.isArray(args.data) ? args.data : JSON.parse(args.data);
    if (data.length > 0) {
      const keys = columns.length > 0 ? columns : Object.keys(data[0]);
      columns.length = 0;
      columns.push(...keys);
      rows = data.map((obj: any) => columns.map(c => String(obj[c] ?? '')));
    }
  }

  if (rows.length === 0) return '❌ to_table requires columns + rows, or a data array';

  const title = args?.title || '';

  // Build professional HTML card
  const headerHTML = columns.map(c => `<th class="az-th">${c}</th>`).join('');
  const bodyHTML = rows.map((row, i) => {
    const cells = row.map(cell => `<td class="az-td">${cell}</td>`).join('');
    return `<tr class="${i % 2 === 0 ? 'az-tr-even' : 'az-tr-odd'}">${cells}</tr>`;
  }).join('');
  const titleHTML = title ? `<div class="az-title">${title}</div>` : '';

  return `<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: transparent; color: #e2e8f0; justify-content: center; padding: 8px; }
.az-card { width: 100%; max-height: scrollbar-gutter: stable; 70vh; overflow-y: auto;    max-width: 800px; background: rgba(15,23,42,0.9); backdrop-filter: blur(16px); border: 1px solid rgba(148,163,184,0.2); border-radius: 20px;  } 
   .az-title { background: linear-gradient(135deg, #2563eb, #7c3aed); color: white; font-size: 15px; font-weight: 700; padding: 14px 20px; letter-spacing: 0.5px; }
    .az-table-wrap { overflow-x: auto;  padding: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .az-th { background: #0f172a; color: #93c5fd; font-weight: 600; text-align: left; padding: 12px 16px; border-bottom: 2px solid #334155; white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; }
    .az-td { padding: 10px 16px; border-bottom: 1px solid #1e293b; color: #cbd5e1;  }
    .az-tr-even { background: rgba(30,41,59,0.4); }
    .az-tr-odd  { background: rgba(15,23,42,0.3); }
    tr:hover td { background: rgba(37,99,235,0.2); color: white; }
    .az-footer { padding: 10px 16px; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; text-align: right; }
  </style>
</head>
<body>
  <div class="az-card">
    ${titleHTML}
    <div class="az-table-wrap"><table><thead><tr>${headerHTML}</tr></thead><tbody>${bodyHTML}</tbody></table>
    <div class="az-footer">${rows.length} rows</div>

    </div>
  </div>
    <script>
    function sendHeight() {
      window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
    }
    window.onload = sendHeight;
    new ResizeObserver(sendHeight).observe(document.body);
  </script>
</body>
</html>`;
});
// ── Live HTML Render ──────────────────────────────────
this.register('to_html', async (args: any) => {
  const rawHTML = args?.html || args?.content || args?.data || '';
  if (!rawHTML) return '❌ requires: { html: "..." }';

  // If the AI already provided a complete <!DOCTYPE html> page, return it as‑is.
  // This prevents double‑wrapping and broken iframes.
  if (rawHTML.trim().startsWith('<!DOCTYPE html>')) {
    return rawHTML;
  }

  const wrapped = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body style="margin:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px;">
${rawHTML}
</body>
</html>`;
  return wrapped;
});

// ── PDF Generation ────────────────────────────────────
this.register('generate_pdf', async (args: any) => {
  if (!args?.content) return '❌ requires: { content: "markdown or text" }';
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const lines = args.content.split('\n');
    doc.fontSize(12);
    for (const line of lines) {
      doc.text(line, { continued: false });
    }
    doc.end();

    const pdfBuffer = await done;
    const dir = path.join(process.cwd(), 'public', 'files');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `report_${Date.now()}.pdf`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, pdfBuffer);
    const url = `http://kasra-agent.onrender.com/files/${filename}`;
    emitTask(`generate_pdf → ${filename}`);
    return url;   // <-- ONLY the URL, no JSON wrapper
  } catch (err: any) {
    return `❌ generate_pdf error: ${err.message}`;
  }
});

// ── Email Sender ─────────────────────────────────────
// ── Email Sender (auto‑generates Ethereal test account) ──
this.register('send_email', async (args: any) => {
  if (!args?.to || !args?.subject || !args?.body) return '❌ requires: { to, subject, body }';
  try {
    const nodemailer = require('nodemailer');

    // 1. If no real credentials are provided, create a disposable Ethereal account automatically
    let transporter: any;
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    } else {
      // Generate a free Ethereal test account on the fly
      const testAccount = await nodemailer.createTestAccount();
      console.log('[Email] Using Ethereal test account:', testAccount.user);
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }

    const info = await transporter.sendMail({
      from: `"Amazan OS" <amazan@ethereal.email>`,
      to: args.to,
      subject: args.subject,
      text: args.body,
    });

    // Ethereal provides a web URL to view the mail
    const previewUrl = nodemailer.getTestMessageUrl(info);
    const result = previewUrl
      ? `✅ Email sent. Preview: ${previewUrl}`
      : `✅ Email sent: ${info.messageId}`;

    emitTask(`send_email → ${args.subject}`);
    return result;
  } catch (err: any) {
    return `❌ send_email error: ${err.message}`;
  }
});

// ── Plugin Scanner (called at startup) ───────────────
// This is NOT a tool; it's called by syncCPMFromTools after all tools are registered.
// But we can also expose a tool to reload plugins:
this.register('reload_plugins', async () => {
  const pluginDir = path.join(process.cwd(), 'plugins');
  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'example.js'), `// Drop plugin files here\nmodule.exports = { name: 'example', description: 'Example plugin', execute: async (args) => "Hello" };\n`);
    return '✅ Plugins folder created. Drop .js files and call reload_plugins again.';
  }
  const files = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js'));
  let loaded = 0;
  for (const file of files) {
    try {
      const plugin = require(path.join(pluginDir, file));
      if (plugin.name && plugin.execute) {
        this.register(plugin.name, plugin.execute);
        loaded++;
      }
    } catch (err: any) { console.error(`Plugin ${file} error:`, err.message); }
  }
  syncCPMFromTools(Array.from(this.tools.keys()));
  return `✅ Loaded ${loaded} plugins`;
});



this.register('manage_skill', async (args: any) => {
  if (!args?.action || !args?.id) return '❌ requires: { action, id }';
  const { patchSkill, toggleSkill, getSkillFull } = require('../files');

  switch (args.action) {
    case 'patch': {
      if (!args.old_str || !args.new_str) return '❌ patch requires: { id, old_str, new_str }';
      const ok = patchSkill(Number(args.id), args.old_str, args.new_str);
      return ok ? `✅ Skill #${args.id} patched` : `❌ old_str not found in skill #${args.id}`;
    }
    case 'disable': {
      toggleSkill(Number(args.id), false);
      return `⏸️ Skill #${args.id} disabled`;
    }
    case 'enable': {
      toggleSkill(Number(args.id), true);
      return `▶️ Skill #${args.id} enabled`;
    }
    case 'get': {
      const skill = getSkillFull(Number(args.id));
      return skill ? JSON.stringify(skill) : `❌ Skill #${args.id} not found`;
    }
    default:
      return `❌ Unknown action: ${args.action}. Use: patch|disable|enable|get`;
  } 
}); 
const memTools = buildMemoryTools(memoryStore, saveMemoryStore);
this.register('save_to_memory', memTools.save_to_memory);
this.register('search_memory', memTools.search_memory);
// ── Pixel‑perfect text table (cli‑table3) ─────────────────
this.register('to_text_table', async (args: any) => {
  if (!args?.data) return '❌ requires: { data: [...] }';
  let rows: any[];
  try {
    rows = typeof args.data === 'string' ? JSON.parse(args.data) : args.data;
    if (!Array.isArray(rows) || rows.length === 0) return '❌ data must be a non-empty array';
  } catch {
    return '❌ data is not valid JSON';
  }

  const columns = args.columns || Object.keys(rows[0]);

  // Manually build a perfectly aligned plain‑text table (no dependencies)
  // 1. Calculate column widths
const widths = columns.map((col: string) =>
  Math.max(
    col.length,
    ...rows.map((r: any) => String(r[col] ?? '').length)
  )
);

  // 2. Draw helpers
const pad = (text: string, w: number) => {
  const diff = w - text.length;
  return text + ' '.repeat(diff > 0 ? diff : 0);
};
  const sepLine = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
  const topLine = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
  const botLine = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

  // 3. Build rows
  const header = '│ ' + columns.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │';
  const dataRows = rows.map(row =>
    '│ ' + columns.map((c, i) => pad(String(row[c] ?? ''), widths[i])).join(' │ ') + ' │'
  );

  const table = [topLine, header, sepLine, ...dataRows, botLine].join('\n');
  return table;
});
    // ── OCR Extract ─────────────────────────────────────────
 this.register('ocr_extract', async (args: any) => {
  if (!args?.file_path) return '❌ requires: { file_path }';
  const resolved = path.isAbsolute(args.file_path)
    ? args.file_path
    : path.join(process.cwd(), 'public', 'uploads', args.file_path);
  if (!fs.existsSync(resolved)) return `❌ File not found: ${resolved}`;

  const ext = path.extname(resolved).toLowerCase();

  // ── Text files – direct read ────────────────────────────
  if (['.txt', '.md', '.csv', '.json', '.html', '.xml'].includes(ext)) {
    const text = fs.readFileSync(resolved, 'utf-8');
    return JSON.stringify({
      file: path.basename(resolved),
      text: text.slice(0, 8000),
      method: 'direct_read',
    });
  }

  // ── Images – Tesseract.js (works, no native deps) ───────
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff'].includes(ext)) {
    try {
      const Tesseract = require('tesseract.js');
      const { data: { text } } = await Tesseract.recognize(resolved, args.lang || 'eng+ara');
      return JSON.stringify({
        file: path.basename(resolved),
        text: text.slice(0, 8000),
        method: 'tesseract_ocr',
      });
    } catch (e: any) {
      return JSON.stringify({ error: e.message, method: 'ocr_failed' });
    }
  }
  
  // ── PDFs – pdf-parse only (no scanned PDF support) ─────
  if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(resolved);
      const data = await pdfParse(buffer);
      if (data.text?.trim().length > 50) {
        return JSON.stringify({
          file: path.basename(resolved),
          text: data.text.slice(0, 8000),
          method: 'pdf_text',
        });
      }
      // No usable text – it’s likely a scanned PDF
      return JSON.stringify({
        file: path.basename(resolved),
        error: 'Scanned PDF – no text layer found. Please upload a text-based PDF or convert pages to images.',
        method: 'pdf_no_text',
      });
    } catch {
      return JSON.stringify({ error: 'Could not read PDF', method: 'pdf_error' });
    }
  }

  // ── Unsupported ──────────────────────────────────────────
  return JSON.stringify({
    file: path.basename(resolved),
    error: 'Unsupported file type',
    method: 'none',
  });
});

this.register('execute_python', async (args: any) => {
  if (!args?.code) return '❌ requires: { code }';
  if (args.code.length > 2000) return '❌ Code too long (max 2000 chars). Please simplify.';

  const tmpFile = path.join(require('os').tmpdir(), `amazan_${Date.now()}.py`);
  try {
    fs.writeFileSync(tmpFile, args.code, 'utf-8');

    const { execSync } = require('child_process');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    // execSync returns the stdout as a Buffer (or string with encoding)
    const raw = execSync(`"${pythonCmd}" "${tmpFile}"`, {
      timeout: 20000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdout → pipe, stderr → pipe
    });

     const output = (raw ?? '').trim();
    if (output) {
      // Return raw output — orchestrator wraps in HTML and emits SSE (single source of truth)
      return output;
    }
    return '(Python executed successfully, but produced no output)';
  } catch (e: any) {
    // stderr is attached to the error object
    const errMsg = e.stderr ? e.stderr.trim().split('\n').slice(-3).join('\n') : e.message;
    return `❌ Python error: ${errMsg}`;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
});
// Inside ToolsHub constructor, after all other tool registrations

this.register('find_file', async (args: any) => {
  if (!args?.name) return '❌ requires: { name, search_path? }';

  const searchRoot = args.search_path || process.env.USERPROFILE || process.env.HOME || 'C:\\Users';
  const pattern    = String(args.name).toLowerCase();
  const maxDepth   = args.max_depth ?? 5;
  const extract    = args.extract   ?? true;

  emitTask(`find_file → searching for "${args.name}"`, 'running');

  const matches: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || matches.length >= 10) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= 10) return;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const skip = ['node_modules', '$Recycle.Bin', 'System Volume Information',
                        'Windows', 'Program Files', 'ProgramData', '.git'];
          if (!skip.includes(entry.name) && !entry.name.startsWith('.')) {
            walk(fullPath, depth + 1);
          }
        } else if (entry.name.toLowerCase().includes(pattern)) {
          matches.push(fullPath);
        }
      }
    } catch {}
  };

  walk(searchRoot, 0);

  if (matches.length === 0) {
    emitTask(`find_file → "${args.name}" not found`, 'failed');
    return JSON.stringify({ found: false, name: args.name, searched: searchRoot });
  }

  emitTask(`find_file → found ${matches.length} match(es)`);

  // Auto‑extract content if only one match
  if (extract && matches.length === 1) {
    const filePath = matches[0];
    const ext      = path.extname(filePath).toLowerCase();
    let   text     = '';
    let   method   = '';

    try {
      if (['.txt','.md','.csv','.json','.html','.xml','.ts','.js','.py'].includes(ext)) {
        text   = fs.readFileSync(filePath, 'utf-8').slice(0, 8000);
        method = 'direct_read';
      } else if (['.png','.jpg','.jpeg','.webp','.bmp','.tiff'].includes(ext)) {
        const Tesseract = require('tesseract.js');
        const { data: { text: t } } = await Tesseract.recognize(filePath, 'eng+ara');
        text   = t.slice(0, 8000);
        method = 'tesseract_ocr';
      } else if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const buffer   = fs.readFileSync(filePath);
        const data     = await pdfParse(buffer);
        text   = (data.text || '').slice(0, 8000);
        method = 'pdf_text';
      }
    } catch (e: any) {
      text   = '';
      method = `extraction_failed: ${e.message}`;
    }

    // Emit file_inject so the frontend shows a pill
    agentEventEmitter.emit('file_inject', {
      type: 'file_inject',
      fileName: path.basename(filePath),
      filePath,
      extractedText: text,
    });

    return JSON.stringify({
      found:     true,
      path:      filePath,
      name:      path.basename(filePath),
      content:   text,
      method,
      char_count: text.length,
    });
  }

  // Multiple matches
  return JSON.stringify({
    found:   true,
    matches: matches.map(m => ({ path: m, name: path.basename(m) })),
    note: 'Multiple files found. Call find_file again with a more specific name, or call ocr_extract with the exact path.',
  });
});

this.register('request_local_file', async (args: any) => {
  if (!args?.name) return '❌ requires: { name }';

  const requestId = `lfr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // Emit SSE event to the frontend
  agentEventEmitter.emit('request_local_file', {
    type: 'request_local_file',
    requestId,
    fileName: args.name,
    searchPath: args.search_path || '',
  });

  // Wait for the frontend to respond (with a timeout)
  const result = await new Promise<string>((resolve) => {
    const timeout = setTimeout(() => resolve(JSON.stringify({ error: 'timeout' })), 120000);
    const handler = (data: { requestId: string; content: string; fileName: string }) => {
      if (data.requestId === requestId) {
        clearTimeout(timeout);
        agentEventEmitter.off('local_file_result', handler);
        resolve(JSON.stringify({ fileName: data.fileName, content: data.content }));
      }
    };
    agentEventEmitter.on('local_file_result', handler);
  });

  // Return the content to the agent
  try {
    const parsed = JSON.parse(result);
    if (parsed.error) return `❌ Could not find the file. The user may have cancelled or the file wasn't found.`;
    return result;
  } catch {
    return result;
  }
});
    // ── Cowork: Live Screen ─────────────────────────────────
    // Shows AI what user currently sees. Real: screenshot via Playwright/robotjs.
   // ── Live Screen (real screenshot) ─────────────────────────
this.register('live_screen', async () => {
  try {
    const screenshot = require('screenshot-desktop');
    const img: Buffer = await screenshot({ format: 'png' });
    const dir = path.join(process.cwd(), 'public', 'files');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, img);
    const url = `http://kasra-agent.onrender.com/files/${filename}`;
    emitTask(`live_screen → ${filename}`);
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      url,
      format: 'png',
      size_bytes: img.length,
    });
  } catch (err: any) {
    return `❌ live_screen error: ${err.message}`;
  }
});

    // ── Cowork: Browser Control ─────────────────────────────
    // AI controls user's browser: navigate, click, type, scroll.
    // Real: Playwright. Simulated for hackathon.
   let _browser: any = null;
let _page: any = null;

async function getBrowser() {
  if (_browser) return { browser: _browser, page: _page };
  const { chromium } = require('playwright');
  _browser = await chromium.launch({ headless: false });
  _page = await _browser.newPage();
  await _page.setViewportSize({ width: 1280, height: 800 });
  return { browser: _browser, page: _page };
}

this.register('browser_control', async (args: any) => {
  const action  = args?.action || 'navigate';
  const target  = args?.url || args?.selector || args?.target || '';
  const text    = args?.text || '';
  const timeout = args?.timeout ?? 10000;

  emitTask(`browser_control → ${action}: ${String(target).slice(0, 60)}`, 'running');

  try {
    const { page } = await getBrowser();

    switch (action) {
      case 'navigate':
      case 'goto': {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout });
        const title = await page.title();
        const url   = page.url();
        emitTask(`browser_control → navigated to "${title}"`);
        return JSON.stringify({ action, url, title, status: 'navigated' });
      }
      case 'click': {
        await page.click(target, { timeout });
        emitTask(`browser_control → clicked ${target}`);
        return JSON.stringify({ action, selector: target, status: 'clicked' });
      }
      case 'type':
      case 'fill': {
        await page.fill(target, text, { timeout });
        emitTask(`browser_control → typed into ${target}`);
        return JSON.stringify({ action, selector: target, text, status: 'typed' });
      }
      case 'screenshot': {
        const dir = path.join(process.cwd(), 'public', 'files');
        fs.mkdirSync(dir, { recursive: true });
        const filename = `browser_${Date.now()}.png`;
        await page.screenshot({ path: path.join(dir, filename), fullPage: false });
        const url = `http://kasra-agent.onrender.com/files/${filename}`;
        emitTask(`browser_control → screenshot saved`);
        return JSON.stringify({ action, url, status: 'screenshot_taken' });
      }
      case 'get_text': {
        const el = await page.locator(target).first();
        const content = await el.textContent({ timeout });
        return JSON.stringify({ action, selector: target, text: content?.slice(0, 2000), status: 'extracted' });
      }
      case 'get_page_text': {
        const content = await page.evaluate(() => document.body.innerText);
        return JSON.stringify({ action, text: content?.slice(0, 8000), url: page.url(), status: 'extracted' });
      }
      case 'wait': {
        await page.waitForSelector(target, { timeout });
        return JSON.stringify({ action, selector: target, status: 'found' });
      }
      case 'scroll': {
        await page.evaluate((sel: string) => {
          const el = sel ? document.querySelector(sel) : window;
          (el as any)?.scrollBy(0, 500);
        }, target);
        return JSON.stringify({ action, status: 'scrolled' });
      }
      case 'close': {
        if (_browser) { await _browser.close(); _browser = null; _page = null; }
        return JSON.stringify({ action, status: 'browser_closed' });
      }
      default:
        return `❌ Unknown browser action: "${action}". Available: navigate, click, type, screenshot, get_text, get_page_text, wait, scroll, close`;
    }
  } catch (e: any) {
    const isPlaywright = e.message?.includes('playwright');
    return `❌ browser_control error: ${e.message}${isPlaywright ? '. Install with: npm install playwright && npx playwright install chromium' : ''}`;
  }
});

    // ── Cron: schedule_task ─────────────────────────────────
    this.register('schedule_task', async (args: any) => {
  if (!args?.prompt || !args?.cron_expression) return '❌ requires: { prompt, cron_expression }';
  try {
    const maxRuns = args?.max_runs ?? null;
    const interval = parseCron(args.cron_expression);
    const nextRun = interval.next().toISOString();
    const result = addScheduledTask(Number(args.chat_id) || 0, args.prompt, args.cron_expression, maxRuns);
    emitTask(`schedule_task → "${String(args.prompt).slice(0, 50)}" | ${args.cron_expression}`);
    return `✅ Task scheduled. ID: ${result.lastInsertRowid}. Max runs: ${maxRuns ?? '∞'}. Next run: ${nextRun}`;
  } catch (e: any) { return `❌ Invalid cron "${args.cron_expression}": ${e.message}`; }
});

    // ── Cron: list_crons ────────────────────────────────────
 this.register('list_crons', async () => {
  try {
    return JSON.stringify((getAllScheduledTasks() as any[]).map(t => ({
      id: t.id, prompt: t.prompt, cron_expression: t.cron_expression,
      next_run: t.next_run, status: t.status || 'active', chat_id: t.chat_id,
      max_runs: t.max_runs, run_count: t.run_count,
    })));
  } catch (e: any) { return `❌ list_crons error: ${e.message}`; }
});

    this.register('pause_cron',  async (a: any) => { if (!a?.id) return '❌ requires: {id}'; updateTaskStatus(Number(a.id), 'paused');  emitTask(`pause_cron → #${a.id}`);  return `⏸️ Task #${a.id} paused`; });
    this.register('resume_cron', async (a: any) => { if (!a?.id) return '❌ requires: {id}'; updateTaskStatus(Number(a.id), 'active');  emitTask(`resume_cron → #${a.id}`); return `▶️ Task #${a.id} resumed`; });
    this.register('stop_cron',   async (a: any) => { if (!a?.id) return '❌ requires: {id}'; updateTaskStatus(Number(a.id), 'stopped'); emitTask(`stop_cron → #${a.id}`);   return `⏹️ Task #${a.id} stopped`; });
    this.register('delete_cron', async (a: any) => { if (!a?.id) return '❌ requires: {id}'; deleteScheduledTask(Number(a.id));         emitTask(`delete_cron → #${a.id}`);  return `🗑️ Task #${a.id} deleted`; });

    this.register('update_cron', async (args: any) => {
      if (!args?.id) return '❌ requires: { id }';
      updateScheduledTask(Number(args.id), { prompt: args.prompt, cron_expression: args.cron_expression });
      emitTask(`update_cron → #${args.id}`);
      return `✏️ Task #${args.id} updated`;
    });

// ── Load MCP tools at startup ──────────────────────────────
   // ── Sync CPM now that all tools are registered ──────────
    syncCPMFromTools(Array.from(this.tools.keys()));
  }

  register(name: string, fn: (args?: any) => Promise<string>) { this.tools.set(name, fn); }
  listToolsSync(): string[] { return Array.from(this.tools.keys()); }
  async listTools(): Promise<string[]> { return this.listToolsSync(); }
getToolsMetadata(): { name: string; friendly: string }[] {
  const friendlyMap: Record<string, string> = {
    get_inventory: 'Inventory',
    get_sales_data: 'Sales',
    db_update: 'Update Stock',
    web_search: 'Web Search',
    browse_web: 'Browse',
    read_local_file: 'Read File',
    list_local_directory: 'List Files',
    export_excel: 'Excel',
    generate_pdf: 'PDF',
    create_ical_event: 'Calendar',
    to_table: 'Table',
    to_html: 'Chart',
    execute_python: 'Python',
    send_email: 'Email',
    schedule_task: 'Schedule',
    list_crons: 'Cron List',
    pause_cron: 'Pause',
    resume_cron: 'Resume',
    stop_cron: 'Stop',
    delete_cron: 'Delete',
    update_cron: 'Edit Cron',
    manage_skill: 'Manage Skill',
    save_to_memory: 'Save to Memory',
    search_memory: 'Search Memory',
    to_text_table: 'Text Table',
    ocr_extract: 'OCR',
    find_file: 'Find File',
    live_screen: 'Screenshot',
    browser_control: 'Browser',
    desktop_control: 'Desktop',
    analyze_project: 'Analyze Project',
    gitlab_create_issue: 'GitLab Issue',
    gitlab_search_merge_requests: 'GitLab MR',
    fivetran_sync_data: 'Fivetran Sync',
    elastic_search_logs: 'Elastic Logs',
    dynatrace_get_metrics: 'Dynatrace Metrics',
    reload_plugins: 'Reload Plugins',
  };
  return Array.from(this.tools.keys()).map(name => ({
    name,
    friendly: friendlyMap[name] || name.replace(/_/g, ' '),
  }));
}
  async call(toolName: string, args?: any): Promise<string> {
  const fn = this.tools.get(toolName);
  if (!fn) return `❌ Unknown tool: "${toolName}". Available: ${this.listToolsSync().join(', ')}`;

  // ── Circuit breaker check ──────────────────────────────
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
}}
export function buildMemoryTools(
  memoryStore: { embedding: number[]; text: string; timestamp: string }[],
  saveMemoryStoreFn: () => void,
) {
  return {
    // ── save_to_memory ────────────────────────────────────────────────────────
    save_to_memory: async (args: any): Promise<string> => {
      if (!args?.text) return '❌ requires: { text }';
 
      const { embed: embedFn } = await import('./embedder');
      const embedding = await embedFn(args.text);
 
      // Dedup: reject if cosine similarity > 0.92 with any existing memory
      const { cosineSimilarity: cos } = await import('./embedder');
      for (const m of memoryStore) {
        if (m.embedding.length === embedding.length && cos(m.embedding, embedding) > 0.92) {
          return `✅ Already in memory (duplicate). Total: ${memoryStore.length}`;
        }
      }
 
      memoryStore.push({ embedding, text: args.text, timestamp: new Date().toISOString() });
      saveMemoryStoreFn();
      return `✅ Saved to memory. Total memories: ${memoryStore.length}`;
    },
 
    // ── search_memory ─────────────────────────────────────────────────────────
    search_memory: async (args: any): Promise<string> => {
      if (!args?.query) return '❌ requires: { query }';
      if (memoryStore.length === 0) return JSON.stringify([]);
 
      const { embed: embedFn, cosineSimilarity: cos } = await import('./embedder');
      const queryVec = await embedFn(args.query);
 
      const scored = memoryStore
        .filter(m => m.embedding.length === queryVec.length)
        .map(m => ({ text: m.text, timestamp: m.timestamp, score: cos(m.embedding, queryVec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .filter(m => m.score > 0.25); // only return actually relevant results
 
      return JSON.stringify(scored.map(s => ({
        text: s.text,
        score: Math.round(s.score * 1000) / 1000,
        timestamp: s.timestamp,
      })));
    },
  };
}
 