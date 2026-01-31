#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import fs from 'fs';
import fetch from 'node-fetch';

const DB_PATH = process.env.DB_PATH || 'logs/sync-state.db';
const HULY_API_URL = process.env.HULY_API_URL || 'http://192.168.50.90:3458';
const VIBE_API_URL = process.env.VIBE_API_URL || 'http://192.168.50.90:3105/api';

const db = new Database(DB_PATH, { readonly: true });

const formatStatus = ok => (ok ? chalk.green('OK') : chalk.red('FAIL'));
const formatError = msg => chalk.red(`FAIL ${msg}`);

const normalizeJson = value => {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
};

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timeout');
    throw err;
  }
}

async function checkStatus() {
  console.log(chalk.bold('\nSystem Health Check\n'));

  try {
    const row = db.prepare('SELECT count(*) as count FROM projects').get();
    console.log(`Database:  ${formatStatus(true)} (Found ${row.count} projects)`);
  } catch (err) {
    console.log(`Database:  ${formatStatus(false)} (${err.message})`);
  }

  try {
    await fetchJson(`${HULY_API_URL}/health`);
    console.log(`Huly API:  ${formatStatus(true)}`);
  } catch (err) {
    console.log(`Huly API:  ${formatStatus(false)} (${err.message})`);
  }

  try {
    await fetchJson(`${VIBE_API_URL}/projects`);
    console.log(`Vibe API:  ${formatStatus(true)}`);
  } catch (err) {
    console.log(`Vibe API:  ${formatStatus(false)} (${err.message})`);
  }

  try {
    execSync('docker exec letta-temporal-admin-tools-1 tctl workflow list --open', {
      stdio: 'ignore',
    });
    console.log(`Temporal:  ${formatStatus(true)}`);
  } catch (err) {
    console.log(`Temporal:  ${formatStatus(false)} (Check docker container)`);
  }

  try {
    execSync('bd --version', { stdio: 'ignore' });
    console.log(`Beads:     ${formatStatus(true)}`);
  } catch (err) {
    console.log(`Beads:     ${formatStatus(false)} (Not found in PATH)`);
  }
}

async function verifyProject(identifier) {
  console.log(chalk.bold(`\nVerifying Project: ${identifier}\n`));

  const project = db.prepare('SELECT * FROM projects WHERE identifier = ?').get(identifier);
  if (!project) {
    console.log(formatError(`Project ${identifier} not found in sync database`));
    return;
  }

  console.log(chalk.blue('Sync State (DB):'));
  console.log(`  Name:      ${project.name}`);
  console.log(`  Huly ID:   ${project.huly_id || chalk.gray('missing')}`);
  console.log(`  Vibe ID:   ${project.vibe_id || chalk.gray('missing')}`);
  console.log(
    `  Last Sync: ${project.last_sync_at ? new Date(project.last_sync_at).toISOString() : 'Never'}`
  );
  console.log(`  Status:    ${project.status}`);

  let hulyCount = 0;
  try {
    const hulyData = normalizeJson(
      await fetchJson(`${HULY_API_URL}/api/projects/${identifier}/issues`, {}, 30000)
    );
    const hulyIssues = Array.isArray(hulyData.issues)
      ? hulyData.issues
      : Array.isArray(hulyData.data)
        ? hulyData.data
        : [];
    hulyCount = typeof hulyData.count === 'number' ? hulyData.count : hulyIssues.length;
    console.log(`\nHuly:   ${chalk.green(hulyCount)} issues found`);
  } catch (err) {
    console.log(`\nHuly:   ${formatError(err.message)}`);
  }

  let vibeCount = 0;
  try {
    if (project.vibe_id) {
      const vibeData = normalizeJson(
        await fetchJson(`${VIBE_API_URL}/tasks?project_id=${project.vibe_id}`)
      );
      const vibeTasks = Array.isArray(vibeData.data)
        ? vibeData.data
        : Array.isArray(vibeData.tasks)
          ? vibeData.tasks
          : [];
      vibeCount = vibeTasks.length;
      console.log(`Vibe:   ${chalk.green(vibeCount)} tasks found`);
    } else {
      console.log(`Vibe:   ${chalk.yellow('Skipped (No Vibe ID linked)')}`);
    }
  } catch (err) {
    console.log(`Vibe:   ${formatError(err.message)}`);
  }

  let beadsCount = 0;
  try {
    if (project.filesystem_path && fs.existsSync(project.filesystem_path)) {
      const beadsOutput = execSync('bd list --all --limit 0 --json --no-daemon', {
        cwd: project.filesystem_path,
        encoding: 'utf8',
      });
      const beadsData = JSON.parse(beadsOutput);
      const beadsIssues = Array.isArray(beadsData) ? beadsData : [];
      beadsCount = beadsIssues.length;
      console.log(`Beads:  ${chalk.green(beadsCount)} issues found`);
    } else {
      console.log(`Beads:  ${chalk.yellow('Skipped (Path not found or invalid)')}`);
    }
  } catch (err) {
    console.log(`Beads:  ${formatError(err.message)}`);
  }

  console.log(chalk.bold('\nConsistency Check:'));
  if (hulyCount === vibeCount && vibeCount === beadsCount) {
    console.log(chalk.green('  All systems perfectly synced'));
  } else {
    console.log(chalk.yellow('  Counts mismatch'));
    console.log(`  Diff Huly-Vibe:  ${Math.abs(hulyCount - vibeCount)}`);
    console.log(`  Diff Vibe-Beads: ${Math.abs(vibeCount - beadsCount)}`);
  }
}

async function verifyTask(taskId) {
  console.log(chalk.bold(`\nTracing Task: ${taskId}\n`));

  const task = db
    .prepare(
      `
    SELECT * FROM issues
    WHERE huly_id = ?
    OR vibe_task_id = ?
    OR beads_issue_id = ?
    OR identifier = ?
  `
    )
    .get(taskId, taskId, taskId, taskId);

  if (!task) {
    console.log(formatError('Task not found in sync database'));
    return;
  }

  console.log(chalk.blue('Sync Metadata:'));
  console.table({
    Title: task.title,
    Project: task.project_identifier,
    'Huly ID': task.huly_id,
    'Vibe ID': task.vibe_task_id,
    'Beads ID': task.beads_issue_id,
    'Sync Status': task.status,
  });

  process.stdout.write(`\nHuly (${task.huly_id}): `);
  console.log(chalk.green('Linked in DB'));

  process.stdout.write(`Vibe (${task.vibe_task_id}): `);
  if (task.vibe_task_id) {
    try {
      const vibeTask = normalizeJson(await fetchJson(`${VIBE_API_URL}/tasks/${task.vibe_task_id}`));
      const vibeStatus = typeof vibeTask.status === 'string' ? vibeTask.status : 'unknown';
      console.log(chalk.green(`Found (Status: ${vibeStatus})`));

      const desc = typeof vibeTask.description === 'string' ? vibeTask.description : '';
      const prefixRaw = String(task.project_identifier || '');
      const prefix = prefixRaw.replace(/[^A-Za-z0-9_-]/g, '');
      const hulyPattern = prefix ? new RegExp(`${prefix}-\\d+`) : /[A-Z]+-\d+/;
      const hulyIdMatch = desc.match(hulyPattern);
      if (hulyIdMatch && hulyIdMatch[0] === task.huly_id) {
        console.log(chalk.green('  Backlink verified in Vibe description'));
      } else {
        console.log(
          chalk.yellow(
            `  Huly ID not found in Vibe description (Found: ${hulyIdMatch ? hulyIdMatch[0] : 'None'})`
          )
        );
      }
    } catch (err) {
      console.log(chalk.red(`Not Found or Error (${err.message})`));
    }
  } else {
    console.log(chalk.yellow('Not linked'));
  }
}

async function triggerSync() {
  console.log(chalk.bold('\nTriggering Manual Sync\n'));
  try {
    console.log(chalk.blue('Sending signal to Temporal workflow...'));
    execSync(
      'docker exec letta-temporal-admin-tools-1 tctl workflow signal --name triggerSync --workflow_id bidirectional-sync-workflow',
      { stdio: 'inherit' }
    );
    console.log(chalk.green('\nSignal sent. Check logs for activity.'));
  } catch (err) {
    console.log(formatError('Failed to trigger sync via Docker/Temporal CLI'));
    console.log(
      chalk.gray('Ensure the workflow ID is "bidirectional-sync-workflow" and is running.')
    );
  }
}

program.name('vibesync').description('Huly-Vibe Sync Management Tool').version('1.0.0');

program.command('status').description('Check health of all sync components').action(checkStatus);

program
  .command('verify-project')
  .argument('<identifier>', 'Project Identifier (e.g. HVSYN)')
  .description('Verify sync consistency for a project')
  .action(verifyProject);

program
  .command('verify-task')
  .argument('<taskId>', 'Task ID (Huly ID, Vibe ID, or Beads ID)')
  .description('Trace a specific task across systems')
  .action(verifyTask);

program.command('trigger').description('Trigger an immediate sync cycle').action(triggerSync);

program.parse();
