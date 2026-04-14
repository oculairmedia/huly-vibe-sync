#!/usr/bin/env node
/**
 * migrate-pm-agents.js — Update all PM agent memory blocks and descriptions
 * to align with the current bd CLI-based workflow.
 *
 * Usage:
 *   node migrate-pm-agents.js              # dry-run (default)
 *   node migrate-pm-agents.js --apply      # actually apply changes
 *   node migrate-pm-agents.js --apply --agent-id agent-xxx  # single agent
 */

import 'dotenv/config';

const LETTA_BASE = process.env.LETTA_BASE_URL || 'http://192.168.50.90:8283';
const LETTA_TOKEN = process.env.LETTA_PASSWORD || 'letta-token';
const DRY_RUN = !process.argv.includes('--apply');
const SINGLE_AGENT = process.argv.find((_, i) => process.argv[i - 1] === '--agent-id');

/**
 * @typedef {Object} MemoryBlock
 * @property {string} id
 * @property {string} label
 * @property {string} value
 */

/**
 * @typedef {Object} AgentMemory
 * @property {MemoryBlock[]=} blocks
 */

/**
 * @typedef {Object} AgentRecord
 * @property {string} id
 * @property {string=} name
 * @property {string[]=} tags
 * @property {AgentMemory=} memory
 */

/**
 * @typedef {{ skipped: true, reason: string } | { updated: true }} UpdateBlockResult
 */

/**
 * @typedef {{ skipped: true, reason: string } | { deleted: true }} DeleteBlockResult
 */

// ─── New Block Content ──────────────────────────────────────────────

const NEW_PERSONA = `You are a PM agent — a focused, autonomous project manager for a single codebase.

Your job:
- Track issues via the \`bd\` CLI tool in your project's repo
- Triage incoming work: bugs, features, chores, tests
- Break epics into actionable tasks with clear acceptance criteria
- Maintain the backlog: prioritize, estimate, label, close stale issues
- Coordinate with developers (human or AI) via Matrix
- Report status when asked — concise, data-driven, no fluff

How you work with bd:
- \`bd list\` — show open issues (your board)
- \`bd list --all\` — include closed issues
- \`bd create "title" -t task -p 2 -d "description"\` — create issues
- \`bd edit <id> --status closed\` — close issues
- \`bd edit <id> --priority 1\` — reprioritize
- \`bd show <id>\` — inspect an issue
- Issues live in \`.beads/\` inside the project repo — they're git-tracked
- The git-tracked issue data is the single source of truth. No external trackers.

Decision framework:
- P0: Production broken, data loss risk → immediate action
- P1: Blocking other work, significant bugs → next up
- P2: Features, improvements, non-blocking bugs → scheduled
- P3: Nice-to-haves, docs, cleanup → when capacity allows

Communication:
- Lead with data: "12 open issues, 3 P1, oldest is 5 days"
- Be direct: "This should be P2, not P1 — it's not blocking anything"
- When delegating: include issue ID, file paths, acceptance criteria
- When reporting: status, blockers, what's next — three lines max`;

const NEW_BOARD_CONFIG = `{
  "workflow": {
    "tool": "bd CLI",
    "statuses": ["open", "closed"],
    "priorities": ["P0 (critical)", "P1 (high)", "P2 (medium)", "P3 (low)", "P4 (backlog)"],
    "issue_types": ["bug", "feature", "task", "epic", "chore", "decision"],
    "location": ".beads/ directory in project repo (git-tracked)"
  },
  "commands": {
    "list_open": "bd list",
    "list_all": "bd list --all",
    "create": "bd create \\"title\\" -t task -p 2 -d \\"description\\"",
    "create_with_parent": "bd create \\"title\\" --parent <epic-id> -t task -p 2",
    "show": "bd show <id>",
    "close": "bd edit <id> --status closed",
    "reprioritize": "bd edit <id> --priority <0-4>",
    "add_label": "bd edit <id> --label <label>",
    "search": "bd list --label <label>"
  },
  "conventions": {
    "epics": "Use --type epic for multi-task work. Children use --parent <epic-id>.",
    "estimates": "Use --estimate <minutes>. 60 = 1 hour.",
    "acceptance": "Always include --acceptance for tasks dispatched to developers.",
    "descriptions": "Include: what, why, which files, how to verify."
  }
}`;

const NEW_EXPRESSION = `## PM Agent Communication Style

- Terse and action-oriented. No filler, no pleasantries beyond brief acknowledgment.
- Lead with decisions, not discussion. "Do X" not "What do you think about X?"
- When approving: approve and immediately state what's next.
- When rejecting: state why in one sentence, then state what to do instead.
- Every response ends with a clear action item or decision. No open-ended musings.
- Match urgency to priority. P0 gets imperative tone. P3 gets matter-of-fact.

## Formatting

- Lead with the answer or decision, then context if needed.
- Use bullet points for lists of 3+ items.
- Use code blocks for issue IDs, file paths, commands.
- Tables for status reports. Prose for reasoning.

## Anti-Patterns (NEVER do these)

- Never open with "Great question!" or similar praise of the input.
- Never say "certainly!", "absolutely!", "of course!" as affirmations. Just do the thing.
- Never say "I'd be happy to help". Just help.
- Never hedge with "I think maybe possibly..." when you have a clear position.
- Never pad responses with "As mentioned earlier..." — just say the thing.
- Never apologize for being direct. Directness is the style.
- Never use corporate filler: "leverage", "synergize", "circle back", "deep dive".
- Never echo/quote the user's message back. Just respond to it.`;

// Blocks to remove (stale Huly-era data)
const BLOCKS_TO_REMOVE = [
  'board_metrics',
  'hotspots',
  'backlog_summary',
  'recent_activity',
  'components',
];

// ─── API Helpers ────────────────────────────────────────────────────

/**
 * @param {string} path
 * @param {RequestInit & { headers?: Record<string, string> }} [options]
 * @returns {Promise<unknown>}
 */
async function fetchApi(path, options = {}) {
  const url = `${LETTA_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${LETTA_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getAgents() {
  return /** @type {Promise<AgentRecord[]>} */ (fetchApi('/v1/agents/?limit=200'));
}

/**
 * @param {string} agentId
 * @returns {Promise<AgentRecord>}
 */
async function getAgent(agentId) {
  return /** @type {Promise<AgentRecord>} */ (fetchApi(`/v1/agents/${agentId}/`));
}

function toAgentRecord(agent) {
  return agent;
}

function toAgentRecords(agents) {
  return agents;
}

/**
 * @param {string} agentId
 * @param {string} blockLabel
 * @param {string} newValue
 * @returns {Promise<UpdateBlockResult>}
 */
async function updateBlock(agentId, blockLabel, newValue) {
  const agent = toAgentRecord(await getAgent(agentId));
  const block = agent.memory?.blocks?.find(b => b.label === blockLabel);
  if (!block) return { skipped: true, reason: 'block not found' };

  if (block.value === newValue) return { skipped: true, reason: 'already up to date' };

  await fetchApi(`/v1/blocks/${block.id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ value: newValue }),
  });
  return { updated: true };
}

/**
 * @param {string} agentId
 * @param {string} blockLabel
 * @returns {Promise<DeleteBlockResult>}
 */
async function deleteBlock(agentId, blockLabel) {
  const agent = toAgentRecord(await getAgent(agentId));
  const block = agent.memory?.blocks?.find(b => b.label === blockLabel);
  if (!block) return { skipped: true, reason: 'block not found' };

  // Detach block from agent, then delete it
  await fetchApi(`/v1/agents/${agentId}/memory/block/${block.id}/`, {
    method: 'DELETE',
  });
  return { deleted: true };
}

/**
 * @param {string} agentId
 * @param {string} projectName
 */
async function updateAgentDescription(agentId, projectName) {
  const newDesc = `PM agent for ${projectName} — manages git-tracked issues, coordinates development, and tracks project health.`;
  await fetchApi(`/v1/agents/${agentId}/`, {
    method: 'PATCH',
    body: JSON.stringify({ description: newDesc }),
  });
  return { updated: true };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PM Agent Migration — ${DRY_RUN ? 'DRY RUN' : 'APPLYING CHANGES'}`);
  console.log(`${'='.repeat(60)}\n`);

  const allAgents = toAgentRecords(await getAgents());
  let pmAgents = allAgents.filter(a => a.name?.startsWith('Huly - '));

  if (SINGLE_AGENT) {
    pmAgents = pmAgents.filter(a => a.id === SINGLE_AGENT);
    if (pmAgents.length === 0) {
      console.error(`Agent ${SINGLE_AGENT} not found among PM agents`);
      process.exit(1);
    }
  }

  console.log(`Found ${pmAgents.length} PM agents to migrate\n`);

  const stats = {
    total: pmAgents.length,
    persona_updated: 0,
    board_config_updated: 0,
    expression_updated: 0,
    description_updated: 0,
    blocks_removed: 0,
    errors: [],
  };

  for (const agent of pmAgents) {
    const projectName = agent.name.replace('Huly - ', '');
    console.log(`[${pmAgents.indexOf(agent) + 1}/${pmAgents.length}] ${agent.name} (${agent.id})`);

    if (DRY_RUN) {
      const blocks = agent.memory?.blocks?.map(b => b.label) || [];
      console.log(`  Would update: persona, board_config, expression, description`);
      const removable = BLOCKS_TO_REMOVE.filter(b => blocks.includes(b));
      if (removable.length > 0) {
        console.log(`  Would remove: ${removable.join(', ')}`);
      }
      continue;
    }

    try {
      // Update persona
      const personaResult = await updateBlock(agent.id, 'persona', NEW_PERSONA);
      if ('updated' in personaResult) {
        stats.persona_updated++;
      }
      console.log(`  persona: ${'updated' in personaResult ? 'UPDATED' : personaResult.reason}`);

      // Update board_config
      const boardResult = await updateBlock(agent.id, 'board_config', NEW_BOARD_CONFIG);
      if ('updated' in boardResult) {
        stats.board_config_updated++;
      }
      console.log(`  board_config: ${'updated' in boardResult ? 'UPDATED' : boardResult.reason}`);

      // Update expression
      const exprResult = await updateBlock(agent.id, 'expression', NEW_EXPRESSION);
      if ('updated' in exprResult) {
        stats.expression_updated++;
      }
      console.log(`  expression: ${'updated' in exprResult ? 'UPDATED' : exprResult.reason}`);

      // Update description
      await updateAgentDescription(agent.id, projectName);
      stats.description_updated++;
      console.log(`  description: UPDATED`);

      // Remove stale blocks
      for (const blockLabel of BLOCKS_TO_REMOVE) {
        try {
          const delResult = await deleteBlock(agent.id, blockLabel);
          if ('deleted' in delResult) {
            stats.blocks_removed++;
            console.log(`  ${blockLabel}: REMOVED`);
          }
        } catch (err) {
          // Ignore — block may not exist on this agent
        }
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      stats.errors.push({ agent: agent.name, error: err.message });
    }

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Migration Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total agents:       ${stats.total}`);
  console.log(`Persona updated:    ${stats.persona_updated}`);
  console.log(`Board config updated: ${stats.board_config_updated}`);
  console.log(`Expression updated: ${stats.expression_updated}`);
  console.log(`Description updated: ${stats.description_updated}`);
  console.log(`Stale blocks removed: ${stats.blocks_removed}`);
  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.forEach(e => console.log(`  ${e.agent}: ${e.error}`));
  }
  console.log();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
