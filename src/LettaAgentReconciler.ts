import { fetchWithPool } from './http.js';
import { logger as rootLogger } from './logger.js';
import type { ProjectRow } from './types/db.js';

type ReconcilerProject = Pick<ProjectRow, 'identifier' | 'name' | 'letta_agent_id' | 'status'>;

interface ReconcilerDb {
  getAllProjects: () => ReconcilerProject[];
  setProjectLettaAgent: (identifier: string, info: { agentId: string }) => void;
}

interface ReconcilerLetta {
  apiURL: string;
  password: string;
  saveAgentId?: (projectIdentifier: string, agentId: string) => void;
}

interface LettaAgent {
  id: string;
  name?: string;
  created_at?: string;
}

interface ReconcileOptions {
  concurrency?: number;
  timeoutMs?: number;
}

interface ReconcileSummary {
  checked: number;
  ok: number;
  repaired: number;
  cleared: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

const log = rootLogger.child({ module: 'letta-reconciler' });

async function fetchAgent(apiURL: string, password: string, agentId: string, timeoutMs: number): Promise<'ok' | 'missing' | 'error'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchWithPool(`${apiURL}/agents/${encodeURIComponent(agentId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${password}` },
      signal: controller.signal,
    });
    if (res.ok) return 'ok';
    if (res.status === 404) return 'missing';
    return 'error';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

async function findAgentByName(apiURL: string, password: string, projectIdentifier: string, projectName: string, timeoutMs: number): Promise<string | null> {
  const sanitizedName = projectName.replace(/[/\\:*?"<>|]/g, '-');
  const agentName = `PM - ${sanitizedName}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const qp = new URLSearchParams({ name: agentName, limit: '20' });
    qp.append('tags', 'vibesync');
    qp.append('tags', `project:${projectIdentifier}`);
    qp.append('match_all_tags', 'true');
    const tagged = await fetchWithPool(`${apiURL}/agents?${qp}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${password}` },
      signal: controller.signal,
    });
    if (tagged.ok) {
      const rows = (await tagged.json()) as LettaAgent[];
      const exact = rows.filter((a) => a.name === agentName);
      if (exact.length > 0) return pickMostRecent(exact);
    }

    const nameOnly = new URLSearchParams({ name: agentName, limit: '50' });
    const fallback = await fetchWithPool(`${apiURL}/agents?${nameOnly}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${password}` },
      signal: controller.signal,
    });
    if (!fallback.ok) return null;
    const rows = (await fallback.json()) as LettaAgent[];
    const exact = rows.filter((a) => a.name === agentName);
    if (exact.length === 0) return null;
    return pickMostRecent(exact);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickMostRecent(rows: LettaAgent[]): string {
  const sorted = [...rows].sort((a, b) => {
    const at = new Date(a.created_at || 0).getTime();
    const bt = new Date(b.created_at || 0).getTime();
    return bt - at;
  });
  return sorted[0]!.id;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function reconcileLettaAgents(
  db: ReconcilerDb,
  letta: ReconcilerLetta,
  opts: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const start = Date.now();
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const timeoutMs = Math.max(500, opts.timeoutMs ?? 5000);

  const summary: ReconcileSummary = {
    checked: 0, ok: 0, repaired: 0, cleared: 0, skipped: 0, errors: 0, durationMs: 0,
  };

  const allProjects = db.getAllProjects();
  const candidates = allProjects.filter(p => p.status !== 'archived');

  log.info({ total: candidates.length, concurrency, timeoutMs }, 'Starting Letta agent reconciliation');

  await runWithConcurrency(candidates, concurrency, async (project) => {
    summary.checked++;
    const projectLog = log.child({ project: project.identifier });
    const current = project.letta_agent_id || null;

    try {
      if (current) {
        const state = await fetchAgent(letta.apiURL, letta.password, current, timeoutMs);
        if (state === 'ok') { summary.ok++; return; }
        if (state === 'error') { summary.errors++; projectLog.warn({ agentId: current }, 'Letta check errored, leaving row untouched'); return; }
        projectLog.warn({ staleAgentId: current }, 'letta_agent_id is stale (404), searching for replacement by name');
      } else {
        projectLog.debug('No letta_agent_id set, attempting name-based lookup');
      }

      const replacement = await findAgentByName(letta.apiURL, letta.password, project.identifier, project.name, timeoutMs);
      if (replacement) {
        db.setProjectLettaAgent(project.identifier, { agentId: replacement });
        letta.saveAgentId?.(project.identifier, replacement);
        summary.repaired++;
        projectLog.info({ previous: current, agentId: replacement }, 'Repaired letta_agent_id from name lookup');
        return;
      }

      if (current) {
        summary.cleared++;
        projectLog.warn({ previous: current }, 'No replacement agent found; leaving stale id in place (no auto-clear)');
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.errors++;
      projectLog.error({ err }, 'Reconciliation failed for project');
    }
  });

  summary.durationMs = Date.now() - start;
  log.info(summary, 'Letta agent reconciliation complete');
  return summary;
}
