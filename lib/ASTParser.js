/**
 * ASTParser - Node.js wrapper for Python Tree-sitter AST parsing
 *
 * Extracts function definitions from source code files by calling
 * the Python ast_parser.py script via subprocess.
 *
 * @module ASTParser
 */

import { spawn, execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {Object} FunctionInfo
 * @property {string} name - Function name
 * @property {string} signature - Full function signature
 * @property {string} parameters - Parameter list
 * @property {string|null} return_type - Return type annotation
 * @property {string|null} docstring - Docstring/JSDoc
 * @property {string[]} decorators - Decorators (Python)
 * @property {number} start_line - Starting line number (1-indexed)
 * @property {number} end_line - Ending line number (1-indexed)
 * @property {boolean} is_async - Whether function is async
 */

/**
 * @typedef {Object} ImportInfo
 * @property {string} module - Module path (Python only)
 * @property {string} source - Module source (JS/TS only)
 * @property {string[]|null} names - Named imports (Python)
 * @property {string[]|null} specifiers - Named imports (JS)
 * @property {string|null} default - Default import name (JS)
 * @property {boolean} is_from - Python from-import
 * @property {number} line - Line number
 */

/**
 * @typedef {Object} ClassInfo
 * @property {string} name - Class name
 * @property {string|null} superclass - Parent class
 * @property {string[]} decorators - Decorators
 * @property {Object[]} methods - Method definitions
 * @property {number} start_line - Start line
 * @property {number} end_line - End line
 */

/**
 * @typedef {Object} ExportInfo
 * @property {string} name - Exported name
 * @property {string} type - function|class|variable
 * @property {boolean} is_default - Default export
 * @property {number} line - Line number
 */

/**
 * @typedef {Object} ParseResult
 * @property {string} file - File path
 * @property {string|null} language - Detected language
 * @property {FunctionInfo[]} functions - Extracted functions
 * @property {ImportInfo[]} imports - Extracted imports
 * @property {ClassInfo[]} classes - Extracted classes
 * @property {ExportInfo[]} exports - Extracted exports
 * @property {string|null} error - Error message if parsing failed
 */

const PYTHON_SCRIPT = path.join(__dirname, '..', 'python', 'ast_parser.py');

// Supported file extensions
const SUPPORTED_EXTENSIONS = new Set([
  '.py',
  '.pyw',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
]);

/**
 * Check if a file is supported for AST parsing
 *
 * @param {string} filePath - File path to check
 * @returns {boolean} True if supported
 */
export function isSupported(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Parse a single file and extract functions
 *
 * @param {string} filePath - Absolute path to file
 * @param {Object} [options] - Options
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @returns {Promise<ParseResult>} Parse result
 */
export async function parseFile(filePath, options = {}) {
  const { timeout = 30000 } = options;
  const log = logger.child({ service: 'ASTParser', file: path.basename(filePath) });

  if (!isSupported(filePath)) {
    return {
      file: filePath,
      language: null,
      functions: [],
      imports: [],
      classes: [],
      exports: [],
      error: `Unsupported file type: ${path.extname(filePath)}`,
    };
  }

  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync('python3', [PYTHON_SCRIPT, filePath], {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

    const elapsed = Date.now() - startTime;

    if (stderr) {
      log.warn({ stderr, elapsed }, 'AST parser wrote to stderr');
    }

    try {
      const result = JSON.parse(stdout);
      log.debug({ functions: result.functions?.length || 0, elapsed }, 'Parsed file successfully');
      return result;
    } catch (parseError) {
      log.error({ parseError, stdout }, 'Failed to parse JSON output');
      return {
        file: filePath,
        language: null,
        functions: [],
        imports: [],
        classes: [],
        exports: [],
        error: `Invalid JSON output: ${parseError.message}`,
      };
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    log.warn({ err, elapsed }, 'AST parser failed');
    return {
      file: filePath,
      language: null,
      functions: [],
      imports: [],
      classes: [],
      exports: [],
      error: err.stderr || err.message || `Process failed`,
    };
  }
}

/**
 * Parse multiple files in batch
 *
 * @param {string[]} filePaths - Array of absolute file paths
 * @param {Object} [options] - Options
 * @param {number} [options.timeout=60000] - Timeout in ms
 * @param {number} [options.concurrency=10] - Max concurrent parses
 * @returns {Promise<ParseResult[]>} Array of parse results
 */
export async function parseFiles(filePaths, options = {}) {
  const { timeout = 60000 } = options;
  const log = logger.child({ service: 'ASTParser', batch: true });

  // Filter to supported files only
  const supportedFiles = filePaths.filter(isSupported);

  if (supportedFiles.length === 0) {
    return [];
  }

  log.info({ total: supportedFiles.length }, 'Starting batch parse');
  const startTime = Date.now();

  // Use batch mode for efficiency via spawn with stdio pipe
  return new Promise(resolve => {
    const proc = spawn('python3', [PYTHON_SCRIPT, '--batch'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeout);

    // Send file list as JSON to stdin
    if (proc.stdin) {
      proc.stdin.write(JSON.stringify(supportedFiles));
      proc.stdin.end();
    }

    if (proc.stdout) {
      proc.stdout.on('data', data => {
        stdout += data.toString();
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', data => {
        stderr += data.toString();
      });
    }

    proc.on('close', code => {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      if (timedOut) {
        log.warn({ elapsed }, 'Batch AST parser timed out');
        resolve(
          supportedFiles.map(file => ({
            file,
            language: null,
            functions: [],
            imports: [],
            classes: [],
            exports: [],
            error: 'Parser timed out',
          }))
        );
        return;
      }

      if (code !== 0) {
        log.warn({ code, stderr, elapsed }, 'Batch AST parser exited with error');
        resolve(
          supportedFiles.map(file => ({
            file,
            language: null,
            functions: [],
            imports: [],
            classes: [],
            exports: [],
            error: stderr || `Process exited with code ${code}`,
          }))
        );
        return;
      }

      try {
        const results = JSON.parse(stdout);
        const totalFunctions = results.reduce((sum, r) => sum + (r.functions?.length || 0), 0);
        log.info({ files: results.length, totalFunctions, elapsed }, 'Batch parse completed');
        resolve(results);
      } catch (parseError) {
        log.error({ parseError }, 'Failed to parse batch JSON output');
        resolve(
          supportedFiles.map(file => ({
            file,
            language: null,
            functions: [],
            imports: [],
            classes: [],
            exports: [],
            error: `Invalid JSON output: ${parseError.message}`,
          }))
        );
      }
    });

    proc.on('error', err => {
      clearTimeout(timeoutId);
      log.error({ err }, 'Failed to spawn batch AST parser');
      resolve(
        supportedFiles.map(file => ({
          file,
          language: null,
          functions: [],
          imports: [],
          classes: [],
          exports: [],
          error: `Failed to spawn parser: ${err.message}`,
        }))
      );
    });
  });
}

/**
 * Check if the Python AST parser is available
 *
 * @returns {Promise<boolean>} True if parser is available
 */
export async function isAvailable() {
  return new Promise(resolve => {
    const proc = spawn('python3', ['-c', 'import tree_sitter; print("ok")'], {
      timeout: 5000,
    });

    let stdout = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    proc.on('close', code => {
      resolve(code === 0 && stdout.trim() === 'ok');
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

export default {
  parseFile,
  parseFiles,
  isSupported,
  isAvailable,
};
