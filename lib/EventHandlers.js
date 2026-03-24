import { logger } from './logger.js';

export function createEventHandlers(deps) {
  const { db, runSyncWithTimeout, bookstackService } = deps;

  const handleBeadsChange = async changeData => {
    logger.info(
      {
        project: changeData.projectIdentifier,
        fileCount: changeData.changedFiles.length,
      },
      'Processing Beads file changes'
    );

    logger.debug({ project: changeData.projectIdentifier }, 'Running sync for Beads changes');
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
    handleBeadsChange,
    handleBookStackChange,
  };
}
