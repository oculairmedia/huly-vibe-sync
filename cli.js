#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import fetch from 'node-fetch';

// ── Helpers ────────────────────────────────────────────────────────

function getGlobalOpts() {
  const opts = program.opts();
  return {
    apiUrl: (opts.apiUrl || 'http://localhost:3099').replace(/\/+$/, ''),
    json: !!opts.json,
    timeout: Number(opts.timeout) || 5000,
  };
}

async function fetchJson(path, options = {}) {
  const { apiUrl, timeout } = getGlobalOpts();
  const url = path.startsWith('http') ? path : `${apiUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${body || res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Timeout after ${timeout}ms: ${url}`);
    if (err.code === 'ECONNREFUSED') throw new Error(`Connection refused: ${url}`);
    throw err;
  }
}

async function probe(url, timeoutMs) {
  const saved = getGlobalOpts().timeout;
  const controller = new AbortController();
  const ms = timeoutMs ?? saved;
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err.message };
  }
}

function formatTable(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map(r => String(r[i] ?? '').length)));
  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const fmt = (row, color) =>
    row.map((c, i) => ` ${color(String(c ?? '').padEnd(widths[i]))} `).join('│');

  const lines = [fmt(headers, chalk.bold), sep];
  for (const row of rows) lines.push(fmt(row, s => s));
  return lines.join('\n');
}

function die(msg) {
  console.error(chalk.red(msg));
  process.exit(1);
}

function toRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

// ── Program ────────────────────────────────────────────────────────

program
  .name('vibesync')
  .description('Huly-Vibe Sync CLI')
  .version('2.0.0')
  .option('--api-url <url>', 'API server base URL', 'http://localhost:3099')
  .option('--json', 'Force JSON output')
  .option('--timeout <ms>', 'Request timeout in ms', '5000');

// ── status ─────────────────────────────────────────────────────────

program
  .command('status')
  .description('System health check')
  .action(async () => {
    const { apiUrl, json } = getGlobalOpts();
    const checks = [];

    // API server
    try {
      await fetchJson('/health');
      checks.push(['API Server', chalk.green('OK'), apiUrl]);
    } catch (err) {
      checks.push(['API Server', chalk.red('FAIL'), err.message]);
    }

    // Registry projects
    try {
      const data = toRecord(await fetchJson('/api/registry/projects'));
      checks.push(['Registry', chalk.green('OK'), `${data.total ?? 0} projects`]);
    } catch (err) {
      checks.push(['Registry', chalk.red('FAIL'), err.message]);
    }

    // Temporal
    try {
      const data = toRecord(await fetchJson('/api/temporal/schedule'));
      const detail = data.available
        ? data.active
          ? 'Schedule active'
          : 'Available, no active schedule'
        : 'Not configured';
      checks.push(['Temporal', chalk.green('OK'), detail]);
    } catch (err) {
      checks.push(['Temporal', chalk.red('FAIL'), err.message]);
    }

    // UI proxy
    try {
      const r = await probe('http://localhost:3110');
      checks.push([
        'UI Proxy',
        r.ok ? chalk.green('OK') : chalk.red('FAIL'),
        r.ok ? 'http://localhost:3110' : r.error || `HTTP ${r.status}`,
      ]);
    } catch (err) {
      checks.push(['UI Proxy', chalk.red('FAIL'), err.message]);
    }

    // External URL
    try {
      const r = await probe('https://vibesync.oculair.ca/api/health');
      checks.push([
        'External URL',
        r.ok ? chalk.green('OK') : chalk.red('FAIL'),
        r.ok ? 'vibesync.oculair.ca' : r.error || `HTTP ${r.status}`,
      ]);
    } catch (err) {
      checks.push(['External URL', chalk.red('FAIL'), err.message]);
    }

    if (json) {
      const result = checks.map(([component, , details]) => ({
        component,
        status: details,
      }));
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold('\nSystem Health\n'));
      console.log(formatTable(['Component', 'Status', 'Details'], checks));
      console.log();
    }

    const hasFail = checks.some(([, s]) => s.includes('FAIL'));
    process.exit(hasFail ? 1 : 0);
  });

// ── projects ───────────────────────────────────────────────────────

program
  .command('projects')
  .description('List projects')
  .option('--filter <key=value>', 'Filter query param (e.g. status=active)')
  .action(async opts => {
    const { json: jsonOut } = getGlobalOpts();
    let path = '/api/registry/projects';
    if (opts.filter) {
      const [key, val] = opts.filter.split('=');
      if (key && val) path += `?${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
    }

    try {
      const data = toRecord(await fetchJson(path));
      const projects = toArray(data.projects);

      if (jsonOut) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (!projects.length) {
        console.log(chalk.yellow('No projects found.'));
        return;
      }

      const rows = projects.map(p => [
        p.identifier || '',
        p.name || '',
        p.tech_stack || '',
        p.letta_agent_id ? chalk.green('✓') : chalk.red('✗'),
        String(p.issue_count ?? ''),
      ]);
      console.log(formatTable(['Identifier', 'Name', 'Tech Stack', 'Agent', 'Issues'], rows));
    } catch (err) {
      die(err.message);
    }
  });

// ── project <identifier> ──────────────────────────────────────────

program
  .command('project <identifier>')
  .description('Show project detail')
  .action(async identifier => {
    const { json: jsonOut } = getGlobalOpts();
    try {
      const project = toRecord(
        await fetchJson(`/api/registry/projects/${encodeURIComponent(identifier)}`)
      );
      const issueData = toRecord(
        await fetchJson(`/api/registry/projects/${encodeURIComponent(identifier)}/issues`).catch(
          () => null
        )
      );

      if (jsonOut) {
        console.log(JSON.stringify({ project, issues: issueData }, null, 2));
        return;
      }

      console.log(chalk.bold(`\nProject: ${project.identifier || identifier}\n`));

      const meta = [
        ['Name', project.name],
        ['Identifier', project.identifier],
        ['Tech Stack', project.tech_stack],
        ['Status', project.status],
        ['Filesystem Path', project.filesystem_path],
        ['Letta Agent ID', project.letta_agent_id || chalk.yellow('none')],
        ['Issues', project.issue_count],
        ['Git URL', project.git_url],
      ];
      for (const [k, v] of meta) {
        if (v !== undefined && v !== null) {
          console.log(`  ${chalk.bold(k + ':')} ${v}`);
        }
      }

      if (issueData.issues) {
        const byStatus = {};
        for (const issue of toArray(issueData.issues)) {
          const safeIssue = toRecord(issue);
          const s = safeIssue.status || 'unknown';
          byStatus[s] = (byStatus[s] || 0) + 1;
        }
        console.log(chalk.bold(`\n  Issues (${issueData.total}):`));
        for (const [status, count] of Object.entries(byStatus)) {
          console.log(`    ${status}: ${count}`);
        }
      }
      console.log();
    } catch (err) {
      die(err.message);
    }
  });

program
  .command('project-register <filesystemPath>')
  .description('Register a project from an absolute filesystem path')
  .option('--name <name>', 'Override project display name')
  .option('--git-url <url>', 'Set git URL after registration')
  .action(async (filesystemPath, opts) => {
    const { json: jsonOut } = getGlobalOpts();
    try {
      const data = toRecord(
        await fetchJson('/api/registry/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filesystem_path: filesystemPath,
            name: opts.name,
            git_url: opts.gitUrl,
          }),
        })
      );
      const project = toRecord(data.project);

      if (jsonOut) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.green(`Project registered: ${project.identifier}`));
      console.log(`  Path: ${project.filesystem_path}`);
      if (project.git_url) {
        console.log(`  Git URL: ${project.git_url}`);
      }
    } catch (err) {
      die(err.message);
    }
  });

program
  .command('project-update <identifier>')
  .description('Update a registered project path or git URL')
  .option('--filesystem-path <path>', 'New absolute filesystem path')
  .option('--git-url <url>', 'New git URL')
  .action(async (identifier, opts) => {
    const { json: jsonOut } = getGlobalOpts();
    const updates = {};

    if (opts.filesystemPath !== undefined) {
      updates.filesystem_path = opts.filesystemPath;
    }
    if (opts.gitUrl !== undefined) {
      updates.git_url = opts.gitUrl;
    }

    if (!Object.keys(updates).length) {
      die('Provide --filesystem-path and/or --git-url');
    }

    try {
      const data = toRecord(
        await fetchJson(`/api/registry/projects/${encodeURIComponent(identifier)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
      );
      const project = toRecord(data.project);

      if (jsonOut) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.green(`Project updated: ${project.identifier}`));
      console.log(`  Path: ${project.filesystem_path || chalk.yellow('none')}`);
      console.log(`  Git URL: ${project.git_url || chalk.yellow('none')}`);
    } catch (err) {
      die(err.message);
    }
  });

// ── scan [identifier] ─────────────────────────────────────────────

program
  .command('scan [identifier]')
  .description('Trigger project scan')
  .action(async identifier => {
    const { json: jsonOut } = getGlobalOpts();
    try {
      let data;
      if (identifier) {
        data = toRecord(
          await fetchJson(`/api/registry/projects/${encodeURIComponent(identifier)}/scan`, {
            method: 'POST',
          })
        );
      } else {
        data = toRecord(
          await fetchJson('/api/registry/projects/ALL/scan', { method: 'POST' }).catch(() => null)
        );
        if (!data) {
          die('No identifier given and full scan endpoint not available.');
          return;
        }
      }

      if (jsonOut) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.bold('\nScan complete\n'));
      if (data.scan) {
        const s = toRecord(data.scan);
        console.log(`  Discovered: ${s.discovered ?? s.total ?? '—'}`);
        console.log(`  Updated:    ${s.updated ?? '—'}`);
        console.log(`  Errors:     ${s.errors ?? 0}`);
      }
      if (data.project) {
        const project = toRecord(data.project);
        console.log(`  Project:    ${project.identifier}`);
      }
      console.log();
    } catch (err) {
      die(err.message);
    }
  });

// ── agents ─────────────────────────────────────────────────────────

program
  .command('agents')
  .description('List PM agents')
  .option('--orphaned', 'Show only agents with no project')
  .action(async opts => {
    const { json: jsonOut } = getGlobalOpts();
    try {
      const data = toRecord(await fetchJson('/api/agents'));
      let agents = toArray(data.agents);

      if (opts.orphaned) {
        agents = agents.filter(agent => {
          const a = toRecord(agent);
          return !a.identifier && !a.project_identifier;
        });
      }

      if (jsonOut) {
        console.log(JSON.stringify({ total: agents.length, agents }, null, 2));
        return;
      }

      if (!agents.length) {
        console.log(chalk.yellow('No agents found.'));
        return;
      }

      const rows = agents.map(agent => {
        const a = toRecord(agent);
        return [
          a.letta_agent_name || a.name || '',
          a.letta_agent_id || a.agent_id || '',
          a.identifier || a.project_identifier || chalk.yellow('—'),
        ];
      });
      console.log(formatTable(['Agent Name', 'Agent ID', 'Project'], rows));
    } catch (err) {
      die(err.message);
    }
  });

// ── sync ───────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Trigger sync with live output')
  .option('--project <id>', 'Scope to a single project')
  .action(async opts => {
    const { apiUrl, json: jsonOut } = getGlobalOpts();
    try {
      const body = opts.project ? { projectId: opts.project } : {};
      const trigger = toRecord(
        await fetchJson('/api/sync/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );

      if (jsonOut) {
        console.log(JSON.stringify(trigger, null, 2));
        return;
      }

      console.log(chalk.green(`Sync triggered: ${trigger.message || 'accepted'}`));
      if (trigger.eventId) console.log(`  Event ID: ${trigger.eventId}`);

      // Connect to SSE stream
      console.log(chalk.gray('\nListening for events (Ctrl+C to stop)...\n'));

      const controller = new AbortController();
      const cleanup = () => {
        controller.abort();
        console.log(chalk.gray('\nDisconnected.'));
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      try {
        const sseRes = await fetch(`${apiUrl}/api/events/stream`, {
          signal: controller.signal,
        });

        for await (const chunk of sseRes.body) {
          const text = chunk.toString();
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const payload = line.slice(5).trim();
              try {
                const evt = JSON.parse(payload);
                const ts = new Date().toISOString().slice(11, 19);
                const evtType = evt.type || evt.event || 'event';
                console.log(
                  `${chalk.gray(ts)} ${chalk.cyan(evtType)} ${JSON.stringify(evt.data || evt)}`
                );
              } catch {
                console.log(chalk.gray(payload));
              }
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') throw err;
      }
    } catch (err) {
      die(err.message);
    }
  });

// ── validate ───────────────────────────────────────────────────────

program
  .command('validate')
  .description('End-to-end validation suite')
  .action(async () => {
    const { json: jsonOut } = getGlobalOpts();
    const results = [];
    let allPass = true;

    async function check(name, fn) {
      const start = Date.now();
      try {
        const detail = await fn();
        const ms = Date.now() - start;
        results.push({ name, pass: true, detail, ms });
      } catch (err) {
        const ms = Date.now() - start;
        results.push({ name, pass: false, detail: err.message, ms });
        allPass = false;
      }
    }

    // 1. API health
    await check('API health', async () => {
      await fetchJson('/health');
      return 'Healthy';
    });

    // 2. Registry populated
    await check('Registry populated', async () => {
      const data = toRecord(await fetchJson('/api/registry/projects'));
      if (!data.total || data.total === 0) throw new Error('No projects in registry');
      return `${data.total} projects`;
    });

    // 3. Sample project has agent
    await check('Sample project has agent', async () => {
      const data = toRecord(await fetchJson('/api/registry/projects'));
      const projects = toArray(data.projects);
      if (!projects.length) throw new Error('No projects available');
      const first = toRecord(projects[0]);
      if (!first.letta_agent_id) throw new Error(`${first.identifier} has no agent`);
      return `${first.identifier} → ${first.letta_agent_id.slice(0, 12)}...`;
    });

    await check('Temporal reachable', async () => {
      const data = toRecord(await fetchJson('/api/temporal/schedule'));
      return data.available ? 'Available' : 'Not configured';
    });

    await check('UI proxy', async () => {
      const r = await probe('http://localhost:3110');
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      return 'Reachable';
    });

    await check('External URL', async () => {
      const r = await probe('https://vibesync.oculair.ca/api/health');
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      return 'Reachable';
    });

    if (jsonOut) {
      console.log(JSON.stringify({ allPass, checks: results }, null, 2));
    } else {
      console.log(chalk.bold('\nValidation Suite\n'));
      for (const r of results) {
        const icon = r.pass ? chalk.green('✓') : chalk.red('✗');
        const timing = chalk.gray(`${r.ms}ms`);
        const detail = r.pass ? r.detail : chalk.red(r.detail);
        console.log(`  ${icon} ${r.name} ${timing} — ${detail}`);
      }
      console.log(
        `\n  ${allPass ? chalk.green('All checks passed') : chalk.red('Some checks failed')}\n`
      );
    }

    process.exit(allPass ? 0 : 1);
  });

// ── temporal ───────────────────────────────────────────────────────

program
  .command('temporal')
  .description('Temporal status and workflows')
  .action(async () => {
    const { json: jsonOut } = getGlobalOpts();
    try {
      const [workflows, schedule] = await Promise.all([
        fetchJson('/api/temporal/workflows').catch(err => ({
          available: false,
          error: err.message,
          workflows: [],
        })),
        fetchJson('/api/temporal/schedule').catch(err => ({
          available: false,
          error: err.message,
        })),
      ]);
      const workflowData = toRecord(workflows);
      const scheduleData = toRecord(schedule);

      if (jsonOut) {
        console.log(JSON.stringify({ workflows: workflowData, schedule: scheduleData }, null, 2));
        return;
      }

      console.log(chalk.bold('\nTemporal Status\n'));

      // Schedule
      console.log(chalk.bold('  Schedule:'));
      if (scheduleData.available) {
        console.log(`    Active: ${scheduleData.active ? chalk.green('yes') : chalk.yellow('no')}`);
        if (scheduleData.schedule) {
          const s = toRecord(scheduleData.schedule);
          if (s.workflowId) console.log(`    Workflow ID: ${s.workflowId}`);
          if (s.intervalMinutes) console.log(`    Interval: ${s.intervalMinutes}m`);
        }
      } else {
        console.log(
          `    ${chalk.yellow(scheduleData.message || scheduleData.error || 'Not available')}`
        );
      }

      // Workflows
      console.log(chalk.bold('\n  Active Workflows:'));
      if (workflowData.available && toArray(workflowData.workflows).length) {
        const rows = toArray(workflowData.workflows).map(workflow => {
          const w = toRecord(workflow);
          return [
            w.workflowId || w.id || '',
            w.type || w.workflowType || '',
            w.status || '',
            w.startTime || '',
          ];
        });
        console.log(
          formatTable(['Workflow ID', 'Type', 'Status', 'Started'], rows)
            .split('\n')
            .map(l => '  ' + l)
            .join('\n')
        );
      } else {
        console.log(`    ${chalk.gray('No active workflows')}`);
      }
      console.log();
    } catch (err) {
      die(err.message);
    }
  });

program.parse();
