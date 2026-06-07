// v2.0 – Kasra Local Agent
const BACKEND = 'https://kasra-agent.onrender.com';
const AGENT_ID = 'local-' + Math.random().toString(36).substr(2, 8);
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
        if (entry.name.toLowerCase() === fileName.toLowerCase()) return path.join(dir, entry.name);
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

async function poll() {
  try {
    const res = await fetch(`${BACKEND}/api/local-agent/pending?agentId=${AGENT_ID}`);
    const cmd = await res.json();
    if (!cmd || !cmd.id) return;

    console.log(`📥 Received: ${cmd.command.slice(0, 100)}`);
    let result = '';

    // ⚡ FIRST check if the command is JSON (search_and_read)
    if (cmd.command.charAt(0) === '{') {
      try {
        const parsed = JSON.parse(cmd.command);
        if (parsed.action === 'search_and_read') {
          const filePath = findFile(parsed.fileName);
          if (!filePath) {
            result = `❌ Could not find ${parsed.fileName} on this PC.`;
          } else {
            const fileBuffer = fs.readFileSync(filePath);
            const base64 = fileBuffer.toString('base64');
            const ocrRes = await fetch(`${BACKEND}/api/ocr-base64`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: path.basename(filePath), content: base64 }),
            });
            const ocrData = await ocrRes.json();
            result = ocrData.success ? ocrData.extractedText : `❌ OCR failed: ${ocrData.error}`;
          }
        } else {
          result = `❌ Unknown JSON action: ${parsed.action}`;
        }
      } catch { /* fall through to shell execution */ }
    }

    // If not JSON or JSON parsing failed, run as shell command
    if (!result) {
      try {
        result = execSync(cmd.command, { timeout: 15000, encoding: 'utf-8', shell: 'cmd.exe' }).trim();
      } catch (e) {
        result = `ERROR: ${e.message}`;
      }
    }

    // Send result back with a few retries
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const res = await fetch(`${BACKEND}/api/local-agent/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cmd.id, agentId: AGENT_ID, result }),
    });
    if (res.ok) break;
  } catch {}
  if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
}
    console.log(`📤 Result sent (${result.length} chars)`);
  } catch {}
}

console.log(`🚀 Kasra Local Agent v2.0 (ID: ${AGENT_ID})`);
setInterval(poll, 2000);