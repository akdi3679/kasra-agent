// src/tools/mcp-client.ts — UPGRADED
// Adds callMCPTool() so hub.ts can call partner MCP servers directly.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema: any;
}

// ── Singleton connected clients ──────────────────────────────
const connectedClients = new Map<string, Client>();

async function getOrConnectClient(serverName: string): Promise<Client | null> {
  if (connectedClients.has(serverName)) return connectedClients.get(serverName)!;

  const serverConfigs: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {
    elastic: {
      command: 'npx',
      args: ['-y', '@elastic/mcp-server-elasticsearch'],
      env: {
        ELASTICSEARCH_URL:     process.env.ELASTICSEARCH_URL     || '',
        ELASTICSEARCH_API_KEY: process.env.ELASTICSEARCH_API_KEY || '',
      },
    },
    fivetran: {
      command: 'npx',
      args: ['-y', 'fivetran-mcp'],
      env: {
        FIVETRAN_API_KEY:    process.env.FIVETRAN_API_KEY    || '',
        FIVETRAN_API_SECRET: process.env.FIVETRAN_API_SECRET || '',
      },
    },
    gitlab: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gitlab'],
      env: {
        GITLAB_TOKEN:      process.env.GITLAB_TOKEN      || '',
        GITLAB_PROJECT_ID: process.env.GITLAB_PROJECT_ID || '',
      },
    },
    dynatrace: {
      command: 'npx',
      args: ['-y', '@dynatrace-oss/dt-mcp-server'],
      env: {
        DYNATRACE_URL:       process.env.DYNATRACE_URL       || '',
        DYNATRACE_API_TOKEN: process.env.DYNATRACE_API_TOKEN || '',
      },
    },
  };

  const config = serverConfigs[serverName];
  if (!config) return null;

  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args:    config.args,
      env:     config.env,
    });
    const client = new Client(
      { name: 'amazan-mcp-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
    connectedClients.set(serverName, client);
    console.log(`[MCP] Connected to ${serverName}`);
    return client;
  } catch (err: any) {
    console.warn(`[MCP] Could not connect to ${serverName}: ${err.message}`);
    return null;
  }
}

/**
 * Call a specific tool on a named MCP server.
 * Throws if the server is unavailable or the tool call fails.
 */
export async function callMCPTool(serverName: string, toolName: string, args: Record<string, any>): Promise<string> {
  const client = await getOrConnectClient(serverName);
  if (!client) throw new Error(`MCP server "${serverName}" not available`);

  const result = await client.callTool({ name: toolName, arguments: args });
  const content = result.content as any[];
  return content.map(c => c.text || JSON.stringify(c)).join('\n');
}

// ── Discovery (preserved from original) ──────────────────────
export async function discoverMCPTools(): Promise<{ serverName: string; tools: MCPToolDef[] }[]> {
  const serverNames = ['elastic', 'fivetran', 'gitlab', 'dynatrace'];
  const results: { serverName: string; tools: MCPToolDef[] }[] = [];

  for (const name of serverNames) {
    try {
      const client = await getOrConnectClient(name);
      if (!client) continue;
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools.map((t: any) => ({
        name:        `${name}_${t.name}`,
        description: t.description || `${name} tool: ${t.name}`,
        inputSchema: t.inputSchema,
      }));
      results.push({ serverName: name, tools });
      console.log(`[MCP] Discovered ${tools.length} tools from ${name}`);
    } catch (err: any) {
      console.warn(`[MCP] Discovery failed for ${name}: ${err.message}`);
    }
  }
  return results;
}