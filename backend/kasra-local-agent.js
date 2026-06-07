// kasra-local-agent.js
// Run: node kasra-local-agent.js
const BACKEND = 'https://kasra-agent.onrender.com';
const AGENT_ID = 'local-' + Math.random().toString(36).substr(2, 8);
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Search for a file in common folders ────────────────────
function findFile(fileName) {
  const roots = [
    process.env.USERPROFILE || process.env.HOME,
    path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop'),
    path.join(process.env.USERPROFILE || process.env.HOME, 'Documents'),
    path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads'),
    process.cwd(),
  ];
  const maxDepth = 4;

  function walk(dir, depth) {
    if (depth > maxDepth) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.toLowerCase() === fileName.toLowerCase()) {
          return path.join(dir, entry.name);
        }
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const found = walk(path.join(dir, entry.name), depth + 1);
          if (found) return found;
        }
      }
    } catch {}
    return null;
  }

  for (const root of roots) {
    if (!root) continue;
    const found = walk(root, 0);
    if (found) return found;
  }
  return null;
}

// ── Poll for commands ───────────────────────────────────────
async function poll() {
  try {
    const res = await fetch(`${BACKEND}/api/local-agent/pending?agentId=${AGENT_ID}`);
    const cmd = await res.json();
    if (!cmd || !cmd.id) return;

    console.log(`🖥️ Executing: ${cmd.command}`);
    let result = '';

    // Try to parse the command as JSON first
    let parsed;
    try {
      parsed = JSON.parse(cmd.command);
    } catch {
      parsed = null;
    }

    if (parsed && parsed.action === 'search_and_read') {
      // ── JSON command: search and read a file ──────────────
      const filePath = findFile(parsed.fileName);
      if (!filePath) {
        result = `❌ Could not find ${parsed.fileName} on this PC.`;
      } else {
        try {
          const fileBuffer = fs.readFileSync(filePath);
          const base64 = fileBuffer.toString('base64');
          const ocrRes = await fetch(`${BACKEND}/api/ocr-base64`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: path.basename(filePath), content: base64 }),
          });
          const ocrData = await ocrRes.json();
          if (ocrData.success) {
            result = ocrData.extractedText;
          } else {
            result = `❌ OCR failed: ${ocrData.error}`;
          }
        } catch (e) {
          result = `❌ Error reading file: ${e.message}`;
        }
      }
    } else if (parsed && parsed.action) {
      // ── Other JSON actions (future extensions) ────────────
      result = `❌ Unknown JSON action: ${parsed.action}`;
    } else {
      // ── Plain shell command (open_url, type, etc.) ────────
      try {
        result = execSync(cmd.command, {
          timeout: 15000,
          encoding: 'utf-8',
          shell: 'cmd.exe',
        }).trim();
      } catch (e) {
        result = `ERROR: ${e.message}`;
      }
    }

    await fetch(`${BACKEND}/api/local-agent/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cmd.id, agentId: AGENT_ID, result }),
    });
  } catch (err) {
    // network error – ignore and retry
  }
}

console.log(`🤖 Kasra Local Agent started (ID: ${AGENT_ID}). Waiting for commands...`);
setInterval(poll, 2000);