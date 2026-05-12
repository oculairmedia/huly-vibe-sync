import crypto from 'node:crypto';

export function computeDescriptionHash(description: string | null | undefined): string | null {
  if (!description) return null;
  return crypto.createHash('sha256').update(description).digest('hex').substring(0, 16);
}

export function computeIssueContentHash(issue: Record<string, unknown> | null | undefined): string | null {
  if (!issue) return null;

  const content = [
    issue.title || '',
    issue.description || '',
    issue.status || '',
    issue.priority || '',
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

export function hasIssueContentChanged(
  newIssue: Record<string, unknown>,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash) return true;
  const newHash = computeIssueContentHash(newIssue);
  return newHash !== storedHash;
}
