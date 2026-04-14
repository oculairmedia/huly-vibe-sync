import { logger } from './logger.js';

export function createEventHandlers(deps) {
  const { bookstackService } = deps;

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
    handleBookStackChange,
  };
}
