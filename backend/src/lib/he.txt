// kasra-local-agent.js
// Download and run: node kasra-local-agent.js
// It connects to the Kasra cloud backend and executes desktop commands.

const BACKEND = 'https://kasra-agent.onrender.com';
const AGENT_ID = 'local-' + Math.random().toString(36).substr(2, 8);
const { execSync } = require('child_process');

async function poll() {
  try {
    const res = await fetch(`${BACKEND}/api/local-agent/pending?agentId=${AGENT_ID}`);
    const cmd = await res.json();
    if (!cmd || !cmd.id) return;

    console.log(`🖥️ Executing: ${cmd.command}`);
    let result = '';
    try {
      result = execSync(cmd.command, {
        timeout: 15000,
        encoding: 'utf-8',
        shell: 'cmd.exe',
      }).trim();
    } catch (e) {
      result = `ERROR: ${e.message}`;
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