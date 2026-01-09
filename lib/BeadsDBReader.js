import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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

export function openBeadsDB(projectPath) {
  const dbPath = path.join(projectPath, '.beads', 'beads.db');
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  return new Database(dbPath, { readonly: true });
}

export function readIssuesFromDB(projectPath) {
  const db = openBeadsDB(projectPath);
  if (!db) {
    return [];
  }

  try {
    const issuesStmt = db.prepare(`
      SELECT 
        id, title, description, status, priority, issue_type,
        created_at, updated_at, closed_at, close_reason,
        assignee, external_ref, sender
      FROM issues
      WHERE deleted_at IS NULL
      ORDER BY created_at
    `);
    const issues = issuesStmt.all();

    const commentsStmt = db.prepare(`
      SELECT issue_id, text, created_at, author
      FROM comments
      ORDER BY created_at
    `);
    const allComments = commentsStmt.all();

    const commentsByIssue = new Map();
    for (const comment of allComments) {
      if (!commentsByIssue.has(comment.issue_id)) {
        commentsByIssue.set(comment.issue_id, []);
      }
      commentsByIssue.get(comment.issue_id).push({
        text: comment.text,
        created_at: comment.created_at,
        author: comment.author,
      });
    }

    const depsStmt = db.prepare(`
      SELECT issue_id, depends_on_id, type
      FROM dependencies
    `);
    const allDeps = depsStmt.all();

    const depsByIssue = new Map();
    for (const dep of allDeps) {
      if (!depsByIssue.has(dep.issue_id)) {
        depsByIssue.set(dep.issue_id, []);
      }
      depsByIssue.get(dep.issue_id).push({
        depends_on_id: dep.depends_on_id,
        type: dep.type,
      });
    }

    const enrichedIssues = issues.map(issue => ({
      ...issue,
      comments: commentsByIssue.get(issue.id) || [],
      dependencies: depsByIssue.get(issue.id) || [],
    }));

    return enrichedIssues;
  } finally {
    db.close();
  }
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
  const issues = readIssuesFromDB(projectPath);
  const lookups = buildIssueLookups(issues);

  console.log(
    `[BeadsDB] Loaded ${issues.length} issues: ` +
      `${lookups.byHulyId.size} with Huly IDs, ` +
      `${lookups.parentMap.size} parent-child relationships`
  );

  return { issues, lookups };
}

export function getParentIdFromLookup(parentMap, issueId) {
  return parentMap.get(issueId) || null;
}

export { readIssuesFromDB as readIssuesFromJSONL };
