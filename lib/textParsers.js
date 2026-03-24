/**
 * Text Parsing Utilities — Facade
 *
 * Re-exports from domain-specific parser modules.
 */

export {
  extractHulyIdentifier,
  extractHulyIdentifierFromDescription,
  extractHulyParentIdentifier,
  extractFullDescription,
} from './parsers/hulyIdentifierParser.js';
export {
  extractFilesystemPath,
  getGitUrl,
  validateGitRepoPath,
  determineGitRepoPath,
  resolveGitUrl,
  cleanGitUrl,
} from './parsers/gitPathResolvers.js';
