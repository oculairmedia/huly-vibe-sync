/**
 * File utility functions for CodePerceptionWatcher
 */

import path from 'path';
import crypto from 'crypto';

export function computeFileHash(fs, filePath) {
  try {
    const content = fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (e) {
    return null;
  }
}

export async function extractFileSummary(fs, log, filePath) {
  try {
    const content = fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);

    const language = detectLanguage(ext);

    const lines = content.split('\n');
    const previewLines = [];
    let foundCode = false;

    for (const line of lines) {
      if (previewLines.length >= 10) break;

      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('#!')) continue;

      if (!foundCode) {
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('#') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('"""') ||
          trimmed.startsWith("'''")
        ) {
          continue;
        }
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

export function detectLanguage(ext) {
  const languages = {
    '.js': 'JavaScript',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript React',
    '.jsx': 'JavaScript React',
    '.py': 'Python',
    '.rs': 'Rust',
    '.go': 'Go',
    '.java': 'Java',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.md': 'Markdown',
    '.json': 'JSON',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.toml': 'TOML',
    '.html': 'HTML',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.sql': 'SQL',
    '.graphql': 'GraphQL',
    '.sh': 'Shell',
    '.bash': 'Bash',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
  };
  return languages[ext] || 'Unknown';
}

export async function getActiveProjectFiles(fs, projectPath, allowedExtensions) {
  const files = [];

  const walk = dir => {
    try {
      const entries = fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (shouldIgnoreDir(entry.name)) continue;
          walk(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (allowedExtensions.has(ext)) {
            files.push(path.relative(projectPath, fullPath));
          }
        }
      }
    } catch (e) {
      // Ignore permission errors etc
    }
  };

  walk(projectPath);
  return files;
}

export function shouldIgnoreDir(name) {
  const ignoreDirs = new Set([
    'node_modules',
    '.git',
    'target',
    'dist',
    'build',
    '__pycache__',
    '.venv',
    'venv',
    '.next',
    '.nuxt',
    'coverage',
    'vendor',
    '.cache',
    '.tmp',
  ]);
  return ignoreDirs.has(name) || name.startsWith('.');
}
