/**
 * EventHandlers - Webhook and file-change event handlers
 *
 * Handles events from Huly webhooks, Beads file watcher, and BookStack watcher.
 * Extracted from index.js main() closure.
 */

import { createRequire } from 'module';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);

/**
 * Create event handlers.
 *
 * @param {object} deps
 * @param {object} deps.db
 * @param {boolean} deps.temporalEnabled
 * @param {function} deps.triggerSyncFromHuly
 * @param {function} deps.triggerSyncFromBeads
 * @param {function} deps.runSyncWithTimeout
 * @param {object|null} deps.bookstackService
 * @returns {object}
 */
export function createEventHandlers(deps) {
  const {
    db,
    temporalEnabled,
    triggerSyncFromHuly,
    triggerSyncFromBeads,
    runSyncWithTimeout,
    bookstackService,
  } = deps;

  const handleWebhookChanges = async changeData => {
    const projectIds = Array.from(changeData.byProject?.keys() || []);

    logger.info(
      {
        type: changeData.type,
        changeCount: changeData.changes.length,
        projects: projectIds,
        temporalEnabled,
      },
      'Processing changes from webhook'
    );

    if (projectIds.length === 0) {
      logger.debug('No project-scoped changes, skipping targeted sync');
      return { success: true, processed: 0 };
    }

    if (temporalEnabled) {
      let totalSucceeded = 0;
      let totalFailed = 0;

      for (const [projectId, changes] of changeData.byProject || []) {
        const project = db.getProjectByIdentifier(projectId);
        if (!project) {
          logger.warn({ projectId }, 'Project not found in database');
          continue;
        }

        const context = {
          projectIdentifier: projectId,
          gitRepoPath: project.filesystem_path,
        };

        const results = await Promise.allSettled(
          changes.map(change => {
            const identifier = change.data?.identifier;
            if (!identifier) {
              logger.debug({ change }, 'Skipping change without identifier');
              return Promise.resolve();
            }

            return triggerSyncFromHuly(identifier, context).catch(err => {
              logger.error(
                { identifier, err },
                'Failed to trigger Temporal workflow for Huly issue'
              );
              throw err;
            });
          })
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        totalSucceeded += succeeded;
        totalFailed += failed;
      }

      logger.info(
        { succeeded: totalSucceeded, failed: totalFailed, total: changeData.changes.length },
        'Temporal workflows triggered for Huly changes'
      );

      return {
        success: totalFailed === 0,
        processed: changeData.changes.length,
        workflows: totalSucceeded,
      };
    }

    // Fallback: legacy sync
    logger.debug({ projects: projectIds }, 'Falling back to legacy sync for Huly');
    const results = await Promise.allSettled(
      projectIds.map(projectId => runSyncWithTimeout(projectId))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    if (failed > 0) {
      logger.warn({ succeeded, failed, projects: projectIds }, 'Some project syncs failed');
    } else {
      logger.info({ synced: succeeded, projects: projectIds }, 'Targeted sync complete');
    }

    return { success: failed === 0, processed: changeData.changes.length };
  };

  const handleBeadsChange = async changeData => {
    logger.info(
      {
        project: changeData.projectIdentifier,
        fileCount: changeData.changedFiles.length,
        temporalEnabled,
      },
      'Processing Beads file changes'
    );

    if (temporalEnabled) {
      const project = db.getProjectByIdentifier(changeData.projectIdentifier);
      if (!project) {
        logger.warn({ project: changeData.projectIdentifier }, 'Project not found in database');
        return { success: false, project: changeData.projectIdentifier };
      }

      const context = {
        projectIdentifier: changeData.projectIdentifier,
        gitRepoPath: changeData.projectPath || project.filesystem_path,
      };

      try {
        const { BeadsClient } = require('./temporal/dist/lib/BeadsClient.js');
        const beadsClient = new BeadsClient(context.gitRepoPath);
        const issues = await beadsClient.listIssues();

        if (issues.length === 0) {
          logger.debug({ project: changeData.projectIdentifier }, 'No Beads issues found');
          return { success: true, project: changeData.projectIdentifier, workflows: 0 };
        }

        const results = await Promise.allSettled(
          issues.slice(0, 10).map(issue =>
            triggerSyncFromBeads(issue.id, context).catch(err => {
              logger.error(
                { issueId: issue.id, err },
                'Failed to trigger Temporal workflow for Beads issue'
              );
              throw err;
            })
          )
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        logger.info(
          { succeeded, failed, total: issues.length },
          'Temporal workflows triggered for Beads changes'
        );

        return {
          success: failed === 0,
          project: changeData.projectIdentifier,
          workflows: succeeded,
        };
      } catch (err) {
        logger.error(
          { err, project: changeData.projectIdentifier },
          'Failed to process Beads changes with Temporal'
        );
        // Fall through to legacy sync
      }
    }

    // Fallback: legacy sync
    logger.debug(
      { project: changeData.projectIdentifier },
      'Falling back to legacy sync for Beads'
    );
    await runSyncWithTimeout(changeData.projectIdentifier);

    return { success: true, project: changeData.projectIdentifier };
  };

  const handleBookStackChange = async changeData => {
    logger.info(
      {
        project: changeData.projectIdentifier,
        fileCount: changeData.changedFiles.length,
      },
      'Processing BookStack doc file changes'
    );

    for (const filePath of changeData.changedFiles) {
      try {
        await bookstackService.importSingleFile(changeData.projectIdentifier, filePath);
      } catch (err) {
        logger.error(
          { err, file: filePath, project: changeData.projectIdentifier },
          'Failed to import BookStack file'
        );
      }
    }
  };

  return {
    handleWebhookChanges,
    handleBeadsChange,
    handleBookStackChange,
  };
}
