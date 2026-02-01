import fs from 'fs';
import path from 'path';

export function registerFilesRoutes(app, deps) {
  const { config, lettaCodeService, parseJsonBody, sendJson, sendError, logger } = deps;

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/files/read' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { agent_id, file_path, start_line = 1, max_lines = 200 } = body;

        if (!file_path) {
          sendError(res, 400, 'file_path is required');
          return;
        }

        let projectRoot = config.stacks?.baseDir || '/opt/stacks';

        if (lettaCodeService && agent_id) {
          const session = lettaCodeService.getSession(agent_id);
          if (session?.projectDir) {
            projectRoot = session.projectDir;
          }
        }

        let normalizedPath = file_path;
        if (normalizedPath.startsWith('/')) {
          normalizedPath = normalizedPath.slice(1);
        }

        const fullPath = path.join(projectRoot, normalizedPath);

        if (!fs.existsSync(fullPath)) {
          sendError(res, 404, 'File not found', { file_path, fullPath });
          return;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const allLines = content.split('\n');
        const totalLines = allLines.length;

        const startIdx = Math.max(0, start_line - 1);
        const endIdx = Math.min(allLines.length, startIdx + max_lines);
        const selectedContent = allLines.slice(startIdx, endIdx).join('\n');

        sendJson(res, 200, {
          file_path: normalizedPath,
          content: selectedContent,
          start_line: startIdx + 1,
          end_line: endIdx,
          total_lines: totalLines,
          full_path: fullPath,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to read file');
        sendError(res, 500, 'Failed to read file', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/files/edit' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { agent_id, file_path, start_line, end_line, new_content } = body;

        if (!file_path) {
          sendError(res, 400, 'file_path is required');
          return;
        }
        if (start_line === undefined || end_line === undefined) {
          sendError(res, 400, 'start_line and end_line are required');
          return;
        }
        if (new_content === undefined) {
          sendError(res, 400, 'new_content is required');
          return;
        }

        let projectRoot = config.stacks?.baseDir || '/opt/stacks';

        if (lettaCodeService && agent_id) {
          const session = lettaCodeService.getSession(agent_id);
          if (session?.projectDir) {
            projectRoot = session.projectDir;
          }
        }

        let normalizedPath = file_path;
        if (normalizedPath.startsWith('/')) {
          normalizedPath = normalizedPath.slice(1);
        }

        const fullPath = path.join(projectRoot, normalizedPath);

        if (!fs.existsSync(fullPath)) {
          sendError(res, 404, 'File not found', { file_path, fullPath });
          return;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const allLines = content.split('\n');

        let newContentNormalized = new_content;
        if (newContentNormalized && !newContentNormalized.endsWith('\n')) {
          newContentNormalized += '\n';
        }

        const newLines = newContentNormalized.split('\n');
        if (newLines[newLines.length - 1] === '') {
          newLines.pop();
        }

        const startIdx = Math.max(0, start_line - 1);
        const endIdx = Math.min(allLines.length, end_line);

        allLines.splice(startIdx, endIdx - startIdx, ...newLines);

        fs.writeFileSync(fullPath, allLines.join('\n'), 'utf-8');

        logger.info(
          { file_path: normalizedPath, start_line, end_line, lines_added: newLines.length },
          'File edited via API'
        );

        sendJson(res, 200, {
          success: true,
          file_path: normalizedPath,
          lines_removed: endIdx - startIdx,
          lines_added: newLines.length,
          new_total_lines: allLines.length,
          message: `Replaced lines ${start_line}-${end_line} with ${newLines.length} new line(s).`,
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to edit file');
        sendError(res, 500, 'Failed to edit file', { error: error.message });
      }
    },
  });

  app.registerRoute({
    match: ({ pathname, method }) => pathname === '/api/files/info' && method === 'POST',
    handle: async ({ req, res }) => {
      try {
        const body = await parseJsonBody(req);
        const { agent_id, file_path } = body;

        if (!file_path) {
          sendError(res, 400, 'file_path is required');
          return;
        }

        let projectRoot = config.stacks?.baseDir || '/opt/stacks';

        if (lettaCodeService && agent_id) {
          const session = lettaCodeService.getSession(agent_id);
          if (session?.projectDir) {
            projectRoot = session.projectDir;
          }
        }

        let normalizedPath = file_path;
        if (normalizedPath.startsWith('/')) {
          normalizedPath = normalizedPath.slice(1);
        }

        const fullPath = path.join(projectRoot, normalizedPath);

        if (!fs.existsSync(fullPath)) {
          sendJson(res, 200, {
            file_path: normalizedPath,
            exists: false,
          });
          return;
        }

        const stats = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const totalLines = content.split('\n').length;

        sendJson(res, 200, {
          file_path: normalizedPath,
          exists: true,
          size_bytes: stats.size,
          modified: stats.mtime.toISOString(),
          created: stats.ctime.toISOString(),
          total_lines: totalLines,
          extension: path.extname(normalizedPath).toLowerCase(),
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to get file info');
        sendError(res, 500, 'Failed to get file info', { error: error.message });
      }
    },
  });
}
