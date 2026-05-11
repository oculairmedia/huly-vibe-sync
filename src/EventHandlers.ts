import { logger } from './logger';

interface BookStackService {
  importSingleFile(projectIdentifier: string, filePath: string): Promise<unknown>;
}

interface BookStackChangeData {
  projectIdentifier: string;
  changedFiles: string[];
}

export function createEventHandlers(deps: Record<string, unknown>) {
  const bookstackService = deps.bookstackService as BookStackService;

  const handleBookStackChange = async (changeData: BookStackChangeData): Promise<void> => {
    logger.info(
      {
        project: changeData.projectIdentifier,
        fileCount: changeData.changedFiles.length,
      },
      'Processing BookStack doc file changes',
    );

    for (const filePath of changeData.changedFiles) {
      try {
        await bookstackService.importSingleFile(changeData.projectIdentifier, filePath);
      } catch (err) {
        logger.error(
          { err, file: filePath, project: changeData.projectIdentifier },
          'Failed to import BookStack file',
        );
      }
    }
  };

  return {
    handleBookStackChange,
  };
}
