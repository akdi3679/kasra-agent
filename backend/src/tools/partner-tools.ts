// src/tools/partner-tools.ts
// Real API implementations for hackathon partners

import { agentEventEmitter } from '../events';

const emit = (data: any) => {
  try { (agentEventEmitter as any).emitStep?.(data); } catch {}
};

// ─── GITLAB ──────────────────────────────────────────────────────

export async function gitlabCreateIssue(summary: string, description: string): Promise<string> {
  const token = process.env.GITLAB_TOKEN;
  const projectId = process.env.GITLAB_PROJECT_ID;

  if (!token || !projectId) {
    // Fallback mock for demo when keys aren't set
    const mockUrl = `https://gitlab.com/amazan-agent/issues/1`;
    console.log(`[GitLab] Mock issue created: ${summary}`);
    emit({ step: 0, thought: '', action: 'gitlab_create_issue', observation: mockUrl });
    return JSON.stringify({ success: true, issue_url: mockUrl, summary, note: 'MOCK – set GITLAB_TOKEN and GITLAB_PROJECT_ID in .env for real API' });
  }

  try {
    const res = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(projectId)}/issues`, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: summary, description }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitLab API error ${res.status}: ${JSON.stringify(err)}`);
    }

    const data = await res.json() as any;
    const issueUrl = data.web_url || `https://gitlab.com/${projectId}/-/issues/${data.iid}`;
    console.log(`[GitLab] Issue created: ${issueUrl}`);
    emit({ step: 0, thought: '', action: 'gitlab_create_issue', observation: issueUrl });
    return JSON.stringify({ success: true, issue_url: issueUrl, iid: data.iid, title: summary });
  } catch (err: any) {
    console.error('[GitLab] Error:', err.message);
    return JSON.stringify({ success: false, error: err.message });
  }
}

export async function gitlabSearchMergeRequests(query: string): Promise<string> {
  const token = process.env.GITLAB_TOKEN;
  const projectId = process.env.GITLAB_PROJECT_ID;

  if (!token || !projectId) {
    return JSON.stringify([
      { title: 'Fix inventory calculation bug', iid: 101, state: 'opened' },
      { title: 'Add new revenue report', iid: 102, state: 'merged' },
    ].filter(mr => mr.title.includes(query)));
  }

  try {
    const res = await fetch(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests?search=${encodeURIComponent(query)}`,
      { headers: { 'PRIVATE-TOKEN': token } }
    );

    if (!res.ok) throw new Error(`GitLab API error ${res.status}`);
    const data = await res.json() as any[];
    const simplified = data.map(mr => ({ title: mr.title, iid: mr.iid, state: mr.state, web_url: mr.web_url }));
    return JSON.stringify(simplified);
  } catch (err: any) {
    console.error('[GitLab] MR search error:', err.message);
    return JSON.stringify({ error: err.message });
  }
}

// ─── FIVETRAN ────────────────────────────────────────────────────

export async function fivetranSyncDataSource(source: string): Promise<string> {
  const apiKey = process.env.FIVETRAN_API_KEY;
  const apiSecret = process.env.FIVETRAN_API_SECRET;
  const connectorId = process.env.FIVETRAN_CONNECTOR_ID;

  if (!apiKey || !apiSecret || !connectorId) {
    return JSON.stringify({
      source,
      status: 'synced',
      records: Math.floor(Math.random() * 1000) + 100,
      last_sync: new Date().toISOString(),
      note: 'MOCK – set FIVETRAN_API_KEY, FIVETRAN_API_SECRET, and FIVETRAN_CONNECTOR_ID in .env for real API'
    });
  }

  try {
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const res = await fetch(`https://api.fivetran.com/v1/connectors/${connectorId}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ force: true }),
    });

    if (!res.ok) throw new Error(`Fivetran API error ${res.status}`);
    const data = await res.json() as any;
    return JSON.stringify({
      source,
      status: data.code === 'Success' ? 'synced' : 'pending',
      connector_id: connectorId,
      message: data.message || 'Sync initiated',
    });
  } catch (err: any) {
    console.error('[Fivetran] Error:', err.message);
    return JSON.stringify({ error: err.message, note: 'Falling back to simulated result', source, status: 'simulated' });
  }
}

// ─── ELASTICSEARCH ───────────────────────────────────────────────

export async function elasticSearchLogs(query: string): Promise<string> {
  const esUrl = process.env.ELASTICSEARCH_URL;
  const esApiKey = process.env.ELASTICSEARCH_API_KEY;
  const esIndex = process.env.ELASTICSEARCH_INDEX || 'logs-*';

  if (!esUrl) {
    return JSON.stringify([
      { timestamp: new Date().toISOString(), level: 'error', message: 'Database connection timeout' },
      { timestamp: new Date().toISOString(), level: 'info', message: 'Inventory sync completed' },
    ].filter(log => log.message.includes(query) || log.level === query));
  }

  try {
    const res = await fetch(`${esUrl}/${esIndex}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(esApiKey ? { 'Authorization': `ApiKey ${esApiKey}` } : {}),
      },
      body: JSON.stringify({
        query: { match: { message: query } },
        size: 10,
        sort: [{ '@timestamp': { order: 'desc' } }],
      }),
    });

    if (!res.ok) throw new Error(`Elasticsearch error ${res.status}`);
    const data = await res.json() as any;
    const hits = data.hits?.hits?.map((h: any) => ({
      timestamp: h._source['@timestamp'] || h._source.timestamp,
      level: h._source.level || 'info',
      message: h._source.message || JSON.stringify(h._source),
    })) || [];
    return JSON.stringify(hits);
  } catch (err: any) {
    console.error('[Elastic] Error:', err.message);
    return JSON.stringify([{ timestamp: new Date().toISOString(), level: 'error', message: `Search failed: ${err.message}` }]);
  }
}

// ─── DYNATRACE ──────────────────────────────────────────────────

export async function dynatraceGetMetrics(metric: string): Promise<string> {
  const dtUrl = process.env.DYNATRACE_URL;
  const dtToken = process.env.DYNATRACE_API_TOKEN;

  if (!dtUrl || !dtToken) {
    return JSON.stringify({
      metric,
      value: Math.random() * 100,
      unit: 'ms',
      timestamp: new Date().toISOString(),
      note: 'MOCK – set DYNATRACE_URL and DYNATRACE_API_TOKEN in .env for real API'
    });
  }

  try {
    // Use API v1 with DataExport scope
    const now = new Date().getTime();
    const oneHourAgo = now - 3600000;

    const res = await fetch(
      `${dtUrl}/api/v1/timeseries/${encodeURIComponent(metric)}?from=${oneHourAgo}&to=${now}&resolution=1h`,
      {
        headers: {
          'Authorization': `Api-Token ${dtToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) {
      // Fallback: try the v2 endpoint with same token (might work with newer tokens)
      const v2Res = await fetch(
        `${dtUrl}/api/v2/metrics/query?metricSelector=${encodeURIComponent(metric)}&from=now-1h`,
        {
          headers: {
            'Authorization': `Api-Token ${dtToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (v2Res.ok) {
        const v2Data = await v2Res.json() as any;
        const points = v2Data.result?.[0]?.data || [];
        const avg = points.length > 0 ? points.reduce((s: number, p: any) => s + (p.values?.[0] || 0), 0) / points.length : 0;
        return JSON.stringify({
          metric,
          value: Math.round(avg * 100) / 100,
          unit: v2Data.result?.[0]?.unit || 'unknown',
          data_points: points.length,
          timestamp: new Date().toISOString(),
        });
      }

      throw new Error(`Dynatrace API error ${res.status} / ${v2Res.status}`);
    }

    const data = await res.json() as any;
    const points = data.result?.points || data.dataPoints || [];
    const avg = points.length > 0 ? points.reduce((s: number, p: any) => s + (p[1] || 0), 0) / points.length : 0;

    return JSON.stringify({
      metric,
      value: Math.round(avg * 100) / 100,
      unit: data.result?.unit || 'percent',
      data_points: points.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[Dynatrace] Error:', err.message);
    return JSON.stringify({
      metric,
      error: err.message,
      note: 'Returning simulated value for demonstration',
      value: Math.round(Math.random() * 100 * 100) / 100,
      unit: 'percent',
      timestamp: new Date().toISOString(),
      simulated: true,
    });
  }
}