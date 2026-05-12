import fs from 'fs';
import path from 'path';

interface FilesDeps {
  config: { stacks?: { baseDir?: string } };
  parseJsonBody: (req: unknown) => Promise<Record<string, unknown>>;
  sendJson: (res: unknown, code: number, data: unknown) => void;
  sendError: (res: unknown, code: number, message: string, details?: Record<string, unknown>) => void;
  logger: { info: (obj: Record<string, unknown>, msg: string) => void; error: (obj: Record<string, unknown>, msg: string) => void };
}

interface App {
  registerRoute(opts: { match: (ctx: { pathname: string; method: string }) => boolean; handle: (ctx: { req: unknown; res: unknown }) => Promise<void> }): void;
}

function normalize(filePath: string): string {
  return filePath.startsWith('/') ? filePath.slice(1) : filePath;
}

export function registerFilesRoutes(app: App, deps: FilesDeps): void {
  const { config, parseJsonBody, sendJson, sendError, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/files/read' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { file_path, start_line = 1, max_lines = 200 } = body;
        if (!file_path) { sendError(res, 400, 'file_path is required'); return; }
        const projectRoot = config.stacks?.baseDir || '/opt/stacks';
        const fullPath = path.join(projectRoot, normalize(file_path as string));
        if (!fs.existsSync(fullPath)) { sendError(res, 404, 'File not found', { file_path, fullPath }); return; }
        const content = fs.readFileSync(fullPath, 'utf-8');
        const allLines = content.split('\n');
        const startIdx = Math.max(0, (start_line as number) - 1);
        const endIdx = Math.min(allLines.length, startIdx + (max_lines as number));
        sendJson(res, 200, { file_path, content: allLines.slice(startIdx, endIdx).join('\n'), start_line: startIdx + 1, end_line: endIdx, total_lines: allLines.length, full_path: fullPath });
      } catch (error) {
        logger.error({ err: error }, 'Failed to read file');
        sendError(res, 500, 'Failed to read file', { error: (error as Error).message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/files/edit' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { file_path, start_line, end_line, new_content } = body;
        if (!file_path) { sendError(res, 400, 'file_path is required'); return; }
        if (start_line === undefined || end_line === undefined) { sendError(res, 400, 'start_line and end_line are required'); return; }
        if (new_content === undefined) { sendError(res, 400, 'new_content is required'); return; }
        const projectRoot = config.stacks?.baseDir || '/opt/stacks';
        const fullPath = path.join(projectRoot, normalize(file_path as string));
        if (!fs.existsSync(fullPath)) { sendError(res, 404, 'File not found', { file_path, fullPath }); return; }
        const content = fs.readFileSync(fullPath, 'utf-8');
        const allLines = content.split('\n');
        let nc = (new_content as string);
        if (nc && !nc.endsWith('\n')) nc += '\n';
        const newLines = nc.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
        const startIdx = Math.max(0, (start_line as number) - 1);
        const endIdx = Math.min(allLines.length, end_line as number);
        allLines.splice(startIdx, endIdx - startIdx, ...newLines);
        fs.writeFileSync(fullPath, allLines.join('\n'), 'utf-8');
        logger.info({ file_path, start_line, end_line, lines_added: newLines.length }, 'File edited via API');
        sendJson(res, 200, { success: true, file_path, lines_removed: endIdx - startIdx, lines_added: newLines.length, new_total_lines: allLines.length, message: `Replaced lines ${start_line}-${end_line} with ${newLines.length} new line(s).` });
      } catch (error) {
        logger.error({ err: error }, 'Failed to edit file');
        sendError(res, 500, 'Failed to edit file', { error: (error as Error).message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/files/info' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { file_path } = body;
        if (!file_path) { sendError(res, 400, 'file_path is required'); return; }
        const projectRoot = config.stacks?.baseDir || '/opt/stacks';
        const fullPath = path.join(projectRoot, normalize(file_path as string));
        if (!fs.existsSync(fullPath)) { sendJson(res, 200, { file_path, exists: false }); return; }
        const stats = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        sendJson(res, 200, { file_path, exists: true, size_bytes: stats.size, modified: stats.mtime.toISOString(), created: stats.ctime.toISOString(), total_lines: content.split('\n').length, extension: path.extname(normalize(file_path as string)).toLowerCase() });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get file info');
        sendError(res, 500, 'Failed to get file info', { error: (error as Error).message });
      }
    },
  });
}
