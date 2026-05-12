import { spawn, execFile } from 'child_process';
import path from 'path';
import { logger } from '../src/logger';
import { promisify } from 'util';
import { resolveFromAppRoot } from '../src/runtimePaths';

const execFileAsync = promisify(execFile);

export interface FunctionInfo {
  name: string;
  signature: string;
  parameters: string;
  return_type: string | null;
  docstring: string | null;
  decorators: string[];
  start_line: number;
  end_line: number;
  is_async: boolean;
}

export interface ImportInfo {
  module: string;
  source: string;
  names: string[] | null;
  specifiers: string[] | null;
  default: string | null;
  is_from: boolean;
  line: number;
}

export interface ClassInfo {
  name: string;
  superclass: string | null;
  decorators: string[];
  methods: Record<string, unknown>[];
  start_line: number;
  end_line: number;
}

export interface ExportInfo {
  name: string;
  type: string;
  is_default: boolean;
  line: number;
}

export interface ParseResult {
  file: string;
  language: string | null;
  functions: FunctionInfo[];
  imports: ImportInfo[];
  classes: ClassInfo[];
  exports: ExportInfo[];
  error: string | null;
}

const PYTHON_SCRIPT = resolveFromAppRoot('python', 'ast_parser.py');

const SUPPORTED_EXTENSIONS = new Set<string>([
  '.py', '.pyw', '.js', '.mjs', '.cjs', '.jsx',
  '.ts', '.mts', '.cts', '.tsx',
]);

export function isSupported(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function parseFile(filePath: string, options: { timeout?: number } = {}): Promise<ParseResult> {
  const { timeout = 30000 } = options;
  const log = logger.child({ service: 'ASTParser', file: path.basename(filePath) });

  if (!isSupported(filePath)) {
    return { file: filePath, language: null, functions: [], imports: [], classes: [], exports: [], error: `Unsupported file type: ${path.extname(filePath)}` };
  }

  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync('python3', [PYTHON_SCRIPT, filePath], { timeout, maxBuffer: 10 * 1024 * 1024 });

    const elapsed = Date.now() - startTime;
    if (stderr) log.warn({ stderr, elapsed }, 'AST parser wrote to stderr');

    try {
      const result = JSON.parse(stdout) as ParseResult;
      log.debug({ functions: result.functions?.length || 0, elapsed }, 'Parsed file successfully');
      return result;
    } catch (parseError) {
      log.error({ parseError, stdout }, 'Failed to parse JSON output');
      return { file: filePath, language: null, functions: [], imports: [], classes: [], exports: [], error: `Invalid JSON output: ${(parseError as Error).message}` };
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    log.warn({ err, elapsed }, 'AST parser failed');
    const e = err as { stderr?: string; message?: string };
    return { file: filePath, language: null, functions: [], imports: [], classes: [], exports: [], error: e.stderr || e.message || 'Process failed' };
  }
}

export async function parseFiles(filePaths: string[], options: { timeout?: number } = {}): Promise<ParseResult[]> {
  const { timeout = 60000 } = options;
  const log = logger.child({ service: 'ASTParser', batch: true });
  const supportedFiles = filePaths.filter(isSupported);

  if (supportedFiles.length === 0) return [];

  log.info({ total: supportedFiles.length }, 'Starting batch parse');
  const startTime = Date.now();

  return new Promise(resolve => {
    const proc = spawn('python3', [PYTHON_SCRIPT, '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId = setTimeout(() => { timedOut = true; proc.kill('SIGTERM'); }, timeout);

    if (proc.stdin) { proc.stdin.write(JSON.stringify(supportedFiles)); proc.stdin.end(); }
    if (proc.stdout) { proc.stdout.on('data', (data: string) => { stdout += data.toString(); }); }
    if (proc.stderr) { proc.stderr.on('data', (data: string) => { stderr += data.toString(); }); }

    proc.on('close', code => {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      if (timedOut) {
        log.warn({ elapsed }, 'Batch AST parser timed out');
        resolve(supportedFiles.map(file => ({ file, language: null, functions: [], imports: [], classes: [], exports: [], error: 'Parser timed out' })));
        return;
      }
      if (code !== 0) {
        log.warn({ code, stderr, elapsed }, 'Batch AST parser exited with error');
        resolve(supportedFiles.map(file => ({ file, language: null, functions: [], imports: [], classes: [], exports: [], error: stderr || `Process exited with code ${code}` })));
        return;
      }

      try {
        const results = JSON.parse(stdout) as ParseResult[];
        const totalFunctions = results.reduce((sum, r) => sum + (r.functions?.length || 0), 0);
        log.info({ files: results.length, totalFunctions, elapsed }, 'Batch parse completed');
        resolve(results);
      } catch (parseError) {
        log.error({ parseError }, 'Failed to parse batch JSON output');
        resolve(supportedFiles.map(file => ({ file, language: null, functions: [], imports: [], classes: [], exports: [], error: `Invalid JSON output: ${(parseError as Error).message}` })));
      }
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timeoutId);
      log.error({ err }, 'Failed to spawn batch AST parser');
      resolve(supportedFiles.map(file => ({ file, language: null, functions: [], imports: [], classes: [], exports: [], error: `Failed to spawn parser: ${err.message}` })));
    });
  });
}

export async function isAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn('python3', ['-c', 'import tree_sitter; print("ok")'], { timeout: 5000 });
    let stdout = '';
    proc.stdout?.on('data', (data: string) => { stdout += data.toString(); });
    proc.on('close', (code: number | null) => { resolve(code === 0 && stdout.trim() === 'ok'); });
    proc.on('error', () => { resolve(false); });
  });
}

export default { parseFile, parseFiles, isSupported, isAvailable };
