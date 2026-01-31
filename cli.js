import 'dotenv/config';

import { execSync } from 'child_process';
import fs from 'fs';
import process from 'process';

const HULY_API_URL = process.env.HULY_API_URL || 'http://192.168.50.90:3458';
const VIBE_API_URL = process.env.VIBE_API_URL || 'http://192.168.50.90:3105/api';
const EXPECTED_OWNER = 'mcp-user:mcp-user';
const TIMEOUT_MS = 5000;
const VALIDATE_TIMEOUT_MS = 30000;

const SYMBOLS = {
  ok: '✓',
  fail: '✗',
  warn: '⚠',
};

const HELP_TEXT = `vibesync - Huly-Vibe Sync verification tool

Commands:
  status              Health check all systems
  validate <project>  Validate project sync integrity
  help                Show this help

Examples:
  node cli.js status
  node cli.js validate HVSYN
`;

const PATH_PATTERNS = [
  /Filesystem:\s*([^\n]+)/i,
  /Path:\s*([^\n]+)/i,
  /Directory:\s*([^\n]+)/i,
  /Location:\s*([^\n]+)/i,
];

function addPath(base, subpath) {
  return `${base.replace(/\/+$/, '')}/${subpath.replace(/^\/+/, '')}`;
}

function formatError(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'AbortError') return 'Timeout';
  return err.message || String(err);
}

function printHeader(title, line) {
  process.stdout.write(`${title}\n${line}\n\n`);
}

function printStatusLine(name, ok, message, details = []) {
  const label = name.padEnd(12, ' ');
  const symbol = ok ? SYMBOLS.ok : SYMBOLS.fail;
  process.stdout.write(`${label} ${symbol} ${message}\n`);
  details.forEach(detail => {
    process.stdout.write(`${' '.repeat(13)}${detail}\n`);
  });
  process.stdout.write('\n');
}

async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHulyStatus() {
  const url = addPath(HULY_API_URL, 'health');
  try {
    const result = await fetchJson(url);
    if (!result.ok) {
      return {
        ok: false,
        message: `unhealthy (HTTP ${result.status})`,
        details: [`URL: ${HULY_API_URL}`],
      };
    }
    const { status, connected, transactorPool } = result.data || {};
    if (status !== 'ok' || connected !== true) {
      return { ok: false, message: 'unhealthy (bad status)', details: [`URL: ${HULY_API_URL}`] };
    }
    const active = transactorPool?.active ?? 'unknown';
    const expected = transactorPool?.expected ?? 'unknown';
    return {
      ok: true,
      message: `healthy (${active}/${expected} transactors)`,
      details: [`URL: ${HULY_API_URL}`],
    };
  } catch (err) {
    return {
      ok: false,
      message: `unreachable (${formatError(err)})`,
      details: [`URL: ${HULY_API_URL}`],
    };
  }
}

async function checkVibeStatus() {
  const url = addPath(VIBE_API_URL, 'projects');
  try {
    const result = await fetchJson(url);
    if (!result.ok) {
      return {
        ok: false,
        message: `unhealthy (HTTP ${result.status})`,
        details: [`URL: ${VIBE_API_URL}`],
      };
    }
    const projects = result.data?.data || [];
    const count = Array.isArray(projects) ? projects.length : 0;
    return {
      ok: true,
      message: `healthy (${count} projects)`,
      details: [`URL: ${VIBE_API_URL}`],
    };
  } catch (err) {
    return {
      ok: false,
      message: `unreachable (${formatError(err)})`,
      details: [`URL: ${VIBE_API_URL}`],
    };
  }
}

function countWorkflows(output) {
  const lines = output.split('\n');
  const dataLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^(workflow|workflowid|id|type|status|time)/i.test(trimmed)) return false;
    return true;
  });
  return dataLines.length;
}

function checkTemporalStatus() {
  const command =
    'docker exec letta-temporal-admin-tools-1 tctl --address temporal:7233 workflow list --open --print_raw_time 2>&1';
  try {
    const output = execSync(command, { encoding: 'utf8' });
    const count = countWorkflows(output);
    return { ok: true, message: `running (${count} open workflows)` };
  } catch (err) {
    return { ok: false, message: `unreachable (${formatError(err)})` };
  }
}

function countIssuesByStatus(issues) {
  const counts = { open: 0, closed: 0 };
  issues.forEach(issue => {
    const status = String(issue?.status || '').toLowerCase();
    if (status in counts) {
      counts[status] += 1;
    }
  });
  return counts;
}

function checkBeadsStatus() {
  const command = 'bd list --json --no-daemon 2>&1';
  try {
    const output = execSync(command, { encoding: 'utf8' });
    const issues = JSON.parse(output);
    const counts = countIssuesByStatus(Array.isArray(issues) ? issues : []);
    const total = Array.isArray(issues) ? issues.length : 0;
    return {
      ok: true,
      message: `${total} issues (${counts.open} open, ${counts.closed} closed)`,
    };
  } catch (err) {
    return { ok: false, message: `unreachable (${formatError(err)})` };
  }
}

function extractGitRepoPath(description) {
  if (!description) return null;
  for (const pattern of PATH_PATTERNS) {
    const match = description.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function hasGitRepo(repoPath) {
  if (!repoPath) return false;
  if (fs.existsSync(`${repoPath}/.git`)) return true;
  try {
    execSync(`git -C "${repoPath.replace(/"/g, '\\"')}" rev-parse --git-dir`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function getOwner(repoPath) {
  try {
    const safePath = repoPath.replace(/"/g, '\\"');
    return execSync(`stat -c "%U:%G" "${safePath}"`, { encoding: 'utf8' }).trim();
  } catch (err) {
    return `unknown (${formatError(err)})`;
  }
}

async function validateCommand(projectIdentifier) {
  let overallOk = true;
  const header = `vibesync validate ${projectIdentifier}`;
  printHeader(header, '═══════════════════════');

  let hulyProject = null;
  let hulyRepoPath = null;
  try {
    const result = await fetchJson(addPath(HULY_API_URL, 'api/projects'), VALIDATE_TIMEOUT_MS);
    const projects = result.data?.projects || [];
    hulyProject = projects.find(
      project => String(project?.identifier || '').toLowerCase() === projectIdentifier.toLowerCase()
    );
    if (hulyProject) {
      hulyRepoPath = extractGitRepoPath(hulyProject.description || '');
    }
  } catch {
    overallOk = false;
  }

  const projectName = hulyProject?.name || 'Unknown project';
  process.stdout.write(`Project: ${projectName} (${projectIdentifier})\n\n`);

  process.stdout.write('Git Repository\n');
  if (!hulyRepoPath) {
    process.stdout.write('  Path: (not found in Huly description)\n');
    process.stdout.write(`  Exists: ${SYMBOLS.fail}\n`);
    process.stdout.write(`  Is git repo: ${SYMBOLS.fail}\n\n`);
    overallOk = false;
  } else {
    const exists = fs.existsSync(hulyRepoPath);
    const isDir = exists && fs.statSync(hulyRepoPath).isDirectory();
    const isGit = isDir && hasGitRepo(hulyRepoPath);
    const owner = exists ? getOwner(hulyRepoPath) : 'unknown';
    process.stdout.write(`  Path: ${hulyRepoPath}\n`);
    process.stdout.write(`  Exists: ${exists ? SYMBOLS.ok : SYMBOLS.fail}\n`);
    process.stdout.write(`  Is git repo: ${isGit ? SYMBOLS.ok : SYMBOLS.fail}\n`);
    process.stdout.write(`  Owner: ${owner}\n\n`);
    if (!exists || !isDir || !isGit) overallOk = false;
  }

  let vibeProject = null;
  let vibeRepos = [];
  try {
    const result = await fetchJson(addPath(VIBE_API_URL, 'projects'), VALIDATE_TIMEOUT_MS);
    const projects = result.data?.data || [];
    vibeProject = projects.find(
      project => String(project?.name || '').toLowerCase() === projectName.toLowerCase()
    );
    if (vibeProject?.id) {
      const repoResult = await fetchJson(
        addPath(VIBE_API_URL, `projects/${vibeProject.id}/repositories`),
        VALIDATE_TIMEOUT_MS
      );
      vibeRepos = repoResult.data?.data || [];
    }
  } catch {
    overallOk = false;
  }

  process.stdout.write('Vibe Kanban\n');
  if (!vibeProject) {
    process.stdout.write('  Project: (not found)\n');
    overallOk = false;
  } else {
    process.stdout.write(`  Project: ${vibeProject.name} (${vibeProject.id})\n`);
  }
  process.stdout.write('  Repositories:\n');
  if (!vibeRepos.length) {
    process.stdout.write('    (none found)\n\n');
    overallOk = false;
  } else {
    vibeRepos.forEach(repo => {
      const repoPath = repo?.path;
      const exists = repoPath ? fs.existsSync(repoPath) : false;
      const isDir = exists && fs.statSync(repoPath).isDirectory();
      const isGit = isDir && hasGitRepo(repoPath);
      const owner = repoPath ? getOwner(repoPath) : 'unknown';
      const ownerWarning =
        owner === EXPECTED_OWNER ? '' : ` ${SYMBOLS.warn} expected ${EXPECTED_OWNER}`;
      process.stdout.write(`    ${repo?.name || 'repo'} (${repoPath || 'unknown path'})\n`);
      process.stdout.write(`      Exists: ${exists ? SYMBOLS.ok : SYMBOLS.fail}\n`);
      process.stdout.write(`      Is git repo: ${isGit ? SYMBOLS.ok : SYMBOLS.fail}\n`);
      process.stdout.write(`      Owner: ${owner}${ownerWarning}\n`);
      if (!exists || !isDir || !isGit) overallOk = false;
    });
    process.stdout.write('\n');
  }

  process.stdout.write('Beads\n');
  let beadsIssues = [];
  if (!hulyRepoPath || !fs.existsSync(hulyRepoPath)) {
    process.stdout.write(`  Initialized: ${SYMBOLS.fail}\n`);
    process.stdout.write('  Issues: 0\n\n');
    overallOk = false;
  } else {
    try {
      const output = execSync('bd list --json --no-daemon 2>&1', {
        encoding: 'utf8',
        cwd: hulyRepoPath,
      });
      beadsIssues = JSON.parse(output);
      const total = Array.isArray(beadsIssues) ? beadsIssues.length : 0;
      process.stdout.write(`  Initialized: ${SYMBOLS.ok}\n`);
      process.stdout.write(`  Issues: ${total}\n\n`);
    } catch (err) {
      process.stdout.write(`  Initialized: ${SYMBOLS.fail}\n`);
      process.stdout.write(`  Issues: 0\n`);
      process.stdout.write(`  Error: ${formatError(err)}\n\n`);
      overallOk = false;
    }
  }

  process.stdout.write('Issue Counts\n');
  let hulyIssueCount = null;
  let vibeTaskCount = null;
  try {
    const hulyIssues = await fetchJson(
      addPath(HULY_API_URL, `api/projects/${projectIdentifier}/issues`),
      VALIDATE_TIMEOUT_MS
    );
    hulyIssueCount = hulyIssues.data?.count ?? hulyIssues.data?.issues?.length ?? null;
  } catch {
    overallOk = false;
  }
  try {
    if (vibeProject?.id) {
      const vibeTasks = await fetchJson(
        `${VIBE_API_URL.replace(/\/+$/, '')}/tasks?project_id=${encodeURIComponent(vibeProject.id)}`
      );
      vibeTaskCount = vibeTasks.data?.data?.length ?? null;
    }
  } catch {
    overallOk = false;
  }
  const beadsCount = Array.isArray(beadsIssues) ? beadsIssues.length : null;
  process.stdout.write(`  Huly:  ${hulyIssueCount ?? 'unknown'} issues\n`);
  process.stdout.write(`  Vibe:  ${vibeTaskCount ?? 'unknown'} tasks\n`);
  process.stdout.write(`  Beads: ${beadsCount ?? 'unknown'} issues\n`);

  let countsOk = true;
  const counts = [hulyIssueCount, vibeTaskCount, beadsCount].filter(count =>
    Number.isFinite(count)
  );
  if (counts.length >= 2) {
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max > 0 && (max - min) / max > 0.1) {
      countsOk = false;
    }
  } else {
    countsOk = false;
  }
  process.stdout.write(
    `  Status: ${countsOk ? SYMBOLS.ok : SYMBOLS.fail} ${countsOk ? 'within tolerance' : 'mismatch (>10%)'}\n`
  );

  if (!countsOk) overallOk = false;

  process.exitCode = overallOk ? 0 : 1;
}

async function statusCommand() {
  printHeader('vibesync status', '═══════════════');

  const [huly, vibe, temporal, beads] = await Promise.all([
    checkHulyStatus(),
    checkVibeStatus(),
    Promise.resolve().then(checkTemporalStatus),
    Promise.resolve().then(checkBeadsStatus),
  ]);

  printStatusLine('Huly API', huly.ok, huly.message, huly.details);
  printStatusLine('Vibe API', vibe.ok, vibe.message, vibe.details);
  printStatusLine('Temporal', temporal.ok, temporal.message);
  printStatusLine('Beads', beads.ok, beads.message);

  const overallOk = [huly, vibe, temporal, beads].every(result => result.ok);
  process.exitCode = overallOk ? 0 : 1;
}

async function main() {
  const [, , command, arg] = process.argv;
  if (!command || command === 'help') {
    process.stdout.write(HELP_TEXT);
    return;
  }

  if (command === 'status') {
    await statusCommand();
    return;
  }

  if (command === 'validate') {
    if (!arg) {
      process.stdout.write('Missing project identifier.\n\n');
      process.stdout.write(HELP_TEXT);
      process.exitCode = 1;
      return;
    }
    await validateCommand(arg);
    return;
  }

  process.stdout.write(`Unknown command: ${command}\n\n`);
  process.stdout.write(HELP_TEXT);
  process.exitCode = 1;
}

await main();
