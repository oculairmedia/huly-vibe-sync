/**
 * Beads JSONL Reader - Direct file access for full issue data
 * @module BeadsJSONLReader
 */

import fs from 'fs';
import path from 'path';

export function normalizeTitleForComparison(title) {
  if (!title) return '';
  return title
    .trim()
    .toLowerCase()
    .replace(/^\[p[0-4]\]\s*/i, '')
    .replace(/^\[perf[^\]]*\]\s*/i, '')
    .replace(/^\[tier\s*\d+\]\s*/i, '')
    .replace(/^\[action\]\s*/i, '')
    .replace(/^\[bug\]\s*/i, '')
    .replace(/^\[fixed\]\s*/i, '')
    .replace(/^\[epic\]\s*/i, '')
    .replace(/^\[wip\]\s*/i, '')
    .trim();
}

export function readIssuesFromJSONL(projectPath) {
  const jsonlPath = path.join(projectPath, '.beads', 'issues.jsonl');

  if (!fs.existsSync(jsonlPath)) {
    return [];
  }

  const issues = [];
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      issues.push(JSON.parse(line));
    } catch (e) {
      continue;
    }
  }

  return issues;
}

export function findHulyIdentifier(issue) {
  const patterns = [
    /Huly Issue:\s*([A-Z]+-\d+)/i,
    /Synced from Huly:\s*([A-Z]+-\d+)/i,
    /Synced from Beads:.*\n+.*Huly Issue:\s*([A-Z]+-\d+)/i,
  ];

  if (issue.description) {
    for (const pattern of patterns) {
      const match = issue.description.match(pattern);
      if (match) return match[1].toUpperCase();
    }
  }

  if (issue.comments?.length > 0) {
    for (const comment of issue.comments) {
      const text = comment.text || '';
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].toUpperCase();
      }
    }
  }

  return null;
}

export function buildIssueLookups(issues) {
  const byHulyId = new Map();
  const byTitle = new Map();
  const byId = new Map();
  const parentMap = new Map();

  const sortedIssues = [...issues].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (const issue of sortedIssues) {
    byId.set(issue.id, issue);

    const hulyId = findHulyIdentifier(issue);
    if (hulyId && !byHulyId.has(hulyId)) {
      byHulyId.set(hulyId, issue);
    }

    const normalizedTitle = normalizeTitleForComparison(issue.title);
    if (normalizedTitle && !byTitle.has(normalizedTitle)) {
      byTitle.set(normalizedTitle, issue);
    }

    if (issue.dependencies?.length > 0) {
      for (const dep of issue.dependencies) {
        if (dep.type === 'parent-child' && dep.depends_on_id) {
          parentMap.set(issue.id, dep.depends_on_id);
          break;
        }
      }
    }
  }

  return { byHulyId, byTitle, byId, parentMap };
}

export function getBeadsIssuesWithLookups(projectPath) {
  const issues = readIssuesFromJSONL(projectPath);
  const lookups = buildIssueLookups(issues);

  console.log(
    `[BeadsJSONL] Loaded ${issues.length} issues: ` +
      `${lookups.byHulyId.size} with Huly IDs, ` +
      `${lookups.parentMap.size} parent-child relationships`
  );

  return { issues, lookups };
}

export function getParentIdFromLookup(parentMap, issueId) {
  return parentMap.get(issueId) || null;
}
