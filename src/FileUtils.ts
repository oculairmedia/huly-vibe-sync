import path from 'path';
import crypto from 'crypto';

interface FsAdapter {
  readFile(filePath: string, encoding?: string): string | Buffer;
  readdir(dir: string, opts?: { withFileTypes?: boolean }): { name: string; isDirectory: () => boolean }[];
}

export function computeFileHash(fs: FsAdapter, filePath: string): string | null {
  try {
    const content = fs.readFile(filePath);
    return crypto.createHash('md5').update(content as string).digest('hex');
  } catch { return null; }
}

export async function extractFileSummary(fs: FsAdapter, log: { warn: (obj: Record<string, unknown>, msg: string) => void }, filePath: string): Promise<string> {
  try {
    const content = fs.readFile(filePath, 'utf-8') as string;
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);
    const language = detectLanguage(ext);
    const lines = content.split('\n');
    const previewLines: string[] = [];
    let foundCode = false;

    for (const line of lines) {
      if (previewLines.length >= 10) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#!')) continue;
      if (!foundCode) {
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('"""') || trimmed.startsWith("'''")) continue;
        foundCode = true;
      }
      previewLines.push(trimmed);
    }

    const preview = previewLines.join(' ').slice(0, 500);
    const lineCount = lines.length;
    const sizeKb = Math.round(content.length / 1024);
    return `${language} file "${basename}" (${lineCount} lines, ${sizeKb}KB). Preview: ${preview}`;
  } catch (e) {
    log.warn({ err: e, file: filePath }, 'Failed to extract summary');
    return `File: ${path.basename(filePath)}`;
  }
}

export function detectLanguage(ext: string): string {
  const languages: Record<string, string> = {
    '.js': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript React', '.jsx': 'JavaScript React',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.rb': 'Ruby', '.php': 'PHP',
    '.md': 'Markdown', '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
    '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.sql': 'SQL', '.graphql': 'GraphQL',
    '.sh': 'Shell', '.bash': 'Bash', '.vue': 'Vue', '.svelte': 'Svelte',
  };
  return languages[ext] || 'Unknown';
}

export async function getActiveProjectFiles(fs: FsAdapter, projectPath: string, allowedExtensions: Set<string>): Promise<string[]> {
  const files: string[] = [];
  const walk = (dir: string): void => {
    try {
      const entries = fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (shouldIgnoreDir(entry.name)) continue;
          walk(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (allowedExtensions.has(ext)) files.push(path.relative(projectPath, fullPath));
        }
      }
    } catch { /* ignore permission errors */ }
  };
  walk(projectPath);
  return files;
}

export function shouldIgnoreDir(name: string): boolean {
  const ignoreDirs = new Set(['node_modules', '.git', 'target', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next', '.nuxt', 'coverage', 'vendor', '.cache', '.tmp']);
  return ignoreDirs.has(name) || name.startsWith('.');
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  let source = '^';
  for (let index = 0; index < normalizedPattern.length; index++) {
    const char = normalizedPattern[index]!;
    const nextChar = normalizedPattern[index + 1];
    const followingChar = normalizedPattern[index + 2];
    if (char === '*' && nextChar === '*') {
      source += followingChar === '/' ? '(?:.*/)?' : '.*';
      index += followingChar === '/' ? 2 : 1;
      continue;
    }
    if (char === '*') { source += '[^/]*'; continue; }
    if (char === '?') { source += '[^/]'; continue; }
    source += escapeRegExp(char);
  }
  return new RegExp(`${source}$`);
}

function matchesIgnorePattern(filePath: string, pattern: string): boolean {
  return globPatternToRegExp(pattern).test(filePath);
}

export function shouldIgnorePath(
  filePath: string,
  ignorePatterns: string[] = [],
  sourceRoots: string[] = [],
  allowlistMode = false,
  projectPath: string | null = null,
): boolean {
  if (!filePath) return false;
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathSegments = normalizedPath.split('/').filter(Boolean);

  if (allowlistMode && sourceRoots.length > 0) {
    const normalizedProjectPath = projectPath ? projectPath.replace(/\\/g, '/').replace(/\/+$/, '') : null;
    let relativePath = normalizedPath;
    if (normalizedProjectPath) {
      if (normalizedPath === normalizedProjectPath) relativePath = '';
      else if (normalizedPath.startsWith(`${normalizedProjectPath}/`)) relativePath = normalizedPath.slice(normalizedProjectPath.length + 1);
    }
    if (!relativePath || relativePath === '.') return false;
    const inAllowedRoot = sourceRoots.some(root => {
      const normalizedRoot = root.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!normalizedRoot) return true;
      return relativePath === normalizedRoot || relativePath.startsWith(`${normalizedRoot}/`) || normalizedRoot.startsWith(`${relativePath}/`);
    });
    if (!inAllowedRoot) return true;
  }

  if (pathSegments.some(shouldIgnoreDir)) return true;

  for (const pattern of ignorePatterns) {
    try { if (matchesIgnorePattern(normalizedPath, pattern)) return true; } catch { /* ignore malformed patterns */ }
  }
  return false;
}
