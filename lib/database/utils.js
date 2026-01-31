import crypto from 'crypto';

export function computeDescriptionHash(description) {
  if (!description) return null;
  return crypto.createHash('sha256').update(description).digest('hex').substring(0, 16);
}

export function computeIssueContentHash(issue) {
  if (!issue) return null;

  const content = [
    issue.title || '',
    issue.description || '',
    issue.status || '',
    issue.priority || '',
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

export function hasIssueContentChanged(newIssue, storedHash) {
  if (!storedHash) return true;
  const newHash = computeIssueContentHash(newIssue);
  return newHash !== storedHash;
}
