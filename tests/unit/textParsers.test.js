/**
 * Unit Tests for Text Parsers
 *
 * Tests parsing of structured text from Huly MCP output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  extractFilesystemPath,
  extractFullDescription,
  extractHulyIdentifier,
  extractHulyParentIdentifier,
  getGitUrl,
  determineGitRepoPath,
  validateGitRepoPath,
  cleanGitUrl,
  resolveGitUrl,
} from '../../lib/textParsers.js';

describe('textParsers', () => {
  describe('extractFilesystemPath', () => {
    it('should extract path with "Filesystem:" prefix', () => {
      const description = 'Project info\n\nFilesystem: /opt/stacks/my-project';
      const path = extractFilesystemPath(description);
      expect(path).toBe('/opt/stacks/my-project');
    });

    it('should extract path with "Path:" prefix', () => {
      const description = 'Path: /home/user/project';
      const path = extractFilesystemPath(description);
      expect(path).toBe('/home/user/project');
    });

    it('should extract path with "Directory:" prefix', () => {
      const description = 'Directory: /var/www/app';
      const path = extractFilesystemPath(description);
      expect(path).toBe('/var/www/app');
    });

    it('should extract path with "Location:" prefix', () => {
      const description = 'Location: /usr/local/bin';
      const path = extractFilesystemPath(description);
      expect(path).toBe('/usr/local/bin');
    });

    it('should be case-insensitive', () => {
      const description = 'FILESYSTEM: /opt/project';
      const path = extractFilesystemPath(description);
      expect(path).toBe('/opt/project');
    });

    it('should clean up trailing punctuation', () => {
      const testCases = [
        { input: 'Path: /opt/project,', expected: '/opt/project' },
        { input: 'Path: /opt/project;', expected: '/opt/project' },
        { input: 'Path: /opt/project.', expected: '/opt/project' },
      ];

      for (const { input, expected } of testCases) {
        expect(extractFilesystemPath(input)).toBe(expected);
      }
    });

    it('should return null for descriptions without paths', () => {
      const description = 'This is just a regular description';
      const path = extractFilesystemPath(description);
      expect(path).toBeNull();
    });

    it('should return null for null/undefined/empty input', () => {
      expect(extractFilesystemPath(null)).toBeNull();
      expect(extractFilesystemPath(undefined)).toBeNull();
      expect(extractFilesystemPath('')).toBeNull();
    });

    it('should extract first path if multiple are present', () => {
      const description = 'Path: /first/path\nFilesystem: /second/path';
      const path = extractFilesystemPath(description);
      expect(path).toBe('/first/path');
    });
  });

  describe('extractFullDescription', () => {
    it('should extract description between ## Description and ## Recent Comments', () => {
      const detailText = `
## Title
Issue title here

## Description
This is the full description
with multiple lines

## Recent Comments
Comment 1
      `.trim();

      const description = extractFullDescription(detailText);
      expect(description).toBe('This is the full description\nwith multiple lines');
    });

    it('should extract description that includes subsections', () => {
      const detailText = `
## Description
Main description text

## Summary
Summary subsection within description

## Details
Details subsection within description

## Recent Comments
Comment 1
      `.trim();

      const description = extractFullDescription(detailText);
      expect(description).toContain('Main description text');
      expect(description).toContain('## Summary');
      expect(description).toContain('## Details');
      expect(description).not.toContain('## Recent Comments');
    });

    it('should stop at ## Sub-issues section', () => {
      const detailText = `
## Description
Description text here

## Sub-issues
- Sub-issue 1
      `.trim();

      const description = extractFullDescription(detailText);
      expect(description).toBe('Description text here');
      expect(description).not.toContain('Sub-issues');
    });

    it('should stop at ## Attachments section', () => {
      const detailText = `
## Description
Description with attachments

## Attachments
file.pdf
      `.trim();

      const description = extractFullDescription(detailText);
      expect(description).toBe('Description with attachments');
      expect(description).not.toContain('Attachments');
    });

    it('should handle missing ## Description header', () => {
      const detailText = `
## Title
Some title

## Recent Comments
Comment 1
      `.trim();

      const description = extractFullDescription(detailText);
      expect(description).toBe('');
    });

    it('should handle empty description content', () => {
      const detailText = `
## Description

## Recent Comments
      `.trim();

      const description = extractFullDescription(detailText);
      expect(description).toBe('');
    });

    it('should preserve whitespace and formatting within description', () => {
      const detailText = `
## Description
Line 1
  Indented line 2
    
Line 4 after blank line

## Recent Comments
      `.trim();

      const description = extractFullDescription(detailText);
      expect(description).toContain('Line 1');
      expect(description).toContain('  Indented line 2');
      expect(description).toContain('Line 4 after blank line');
    });
  });

  describe('extractHulyIdentifier', () => {
    it('should extract Huly identifier from description', () => {
      const description = 'Task from Huly Issue: PROJ-42';
      const identifier = extractHulyIdentifier(description);
      expect(identifier).toBe('PROJ-42');
    });

    it('should extract identifier with different project codes', () => {
      const testCases = [
        { input: 'Huly Issue: A-1', expected: 'A-1' },
        { input: 'Huly Issue: ABC-999', expected: 'ABC-999' },
        { input: 'Huly Issue: MYPROJECT-123', expected: 'MYPROJECT-123' },
      ];

      for (const { input, expected } of testCases) {
        expect(extractHulyIdentifier(input)).toBe(expected);
      }
    });

    it('should return null for descriptions without Huly Issue prefix', () => {
      const description = 'Regular description with PROJECT-123';
      const identifier = extractHulyIdentifier(description);
      expect(identifier).toBeNull();
    });

    it('should return null for null/undefined/empty input', () => {
      expect(extractHulyIdentifier(null)).toBeNull();
      expect(extractHulyIdentifier(undefined)).toBeNull();
      expect(extractHulyIdentifier('')).toBeNull();
    });

    it('should only extract uppercase project codes', () => {
      const description = 'Huly Issue: proj-123'; // lowercase
      const identifier = extractHulyIdentifier(description);
      expect(identifier).toBeNull();
    });

    it('should extract first identifier if multiple are present', () => {
      const description = 'Huly Issue: PROJ-1 and also Huly Issue: PROJ-2';
      const identifier = extractHulyIdentifier(description);
      expect(identifier).toBe('PROJ-1');
    });
  });

  describe('extractHulyParentIdentifier', () => {
    it('should extract explicit parent identifier', () => {
      const description = '...\nHuly Parent: PROJ-42';
      expect(extractHulyParentIdentifier(description)).toBe('PROJ-42');
    });

    it('should return null for explicit top-level markers', () => {
      expect(extractHulyParentIdentifier('Huly Parent: none')).toBeNull();
      expect(extractHulyParentIdentifier('Huly Parent: top-level')).toBeNull();
      expect(extractHulyParentIdentifier('Parent Huly Issue: null')).toBeNull();
    });

    it('should return undefined when metadata is missing', () => {
      expect(extractHulyParentIdentifier('Huly Issue: PROJ-1')).toBeUndefined();
      expect(extractHulyParentIdentifier('')).toBeUndefined();
      expect(extractHulyParentIdentifier(null)).toBeUndefined();
    });
  });

  describe('getGitUrl', () => {
    it('should return null for non-existent repository', () => {
      const url = getGitUrl('/nonexistent/path');
      expect(url).toBeNull();
    });

    it('should return null for directory without .git', () => {
      const url = getGitUrl('/tmp');
      expect(url).toBeNull();
    });

    // Note: Testing with real git repos would require integration tests
    // These are unit tests focusing on error handling
  });

  describe('determineGitRepoPath', () => {
    let existsSyncSpy;

    beforeEach(() => {
      existsSyncSpy = vi.spyOn(fs, 'existsSync');
    });

    afterEach(() => {
      existsSyncSpy.mockRestore();
    });

    it('should use filesystem path from description if it exists', () => {
      existsSyncSpy.mockReturnValue(true);

      const hulyProject = {
        identifier: 'TEST',
        description: 'Project description\nFilesystem: /opt/stacks/huly-vibe-sync',
      };

      const path = determineGitRepoPath(hulyProject);
      expect(path).toBe('/opt/stacks/huly-vibe-sync');
    });

    it('should use placeholder path if filesystem path does not exist', () => {
      existsSyncSpy.mockReturnValue(false);

      const hulyProject = {
        identifier: 'TEST',
        description: 'Project description\nFilesystem: /nonexistent/path',
      };

      const path = determineGitRepoPath(hulyProject);
      expect(path).toBe('/opt/stacks/huly-sync-placeholders/TEST');
    });

    it('should use placeholder path if no filesystem path in description', () => {
      existsSyncSpy.mockReturnValue(false);

      const hulyProject = {
        identifier: 'PROJ',
        description: 'Regular project description without path',
      };

      const path = determineGitRepoPath(hulyProject);
      expect(path).toBe('/opt/stacks/huly-sync-placeholders/PROJ');
    });

    it('should use placeholder path for empty description', () => {
      const hulyProject = {
        identifier: 'EMPTY',
        description: '',
      };

      const path = determineGitRepoPath(hulyProject);
      expect(path).toBe('/opt/stacks/huly-sync-placeholders/EMPTY');
    });
  });

  describe('validateGitRepoPath', () => {
    let existsSyncSpy;
    let statSyncSpy;

    beforeEach(() => {
      existsSyncSpy = vi.spyOn(fs, 'existsSync');
      statSyncSpy = vi.spyOn(fs, 'statSync');
    });

    afterEach(() => {
      existsSyncSpy.mockRestore();
      statSyncSpy.mockRestore();
    });

    it('should reject null path', () => {
      const result = validateGitRepoPath(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('null');
    });

    it('should reject empty string', () => {
      const result = validateGitRepoPath('');
      expect(result.valid).toBe(false);
    });

    it('should reject relative path', () => {
      const result = validateGitRepoPath('relative/path');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not absolute');
    });

    it('should reject path that does not exist', () => {
      existsSyncSpy.mockReturnValue(false);
      const result = validateGitRepoPath('/nonexistent/path');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not exist');
    });

    it('should reject path that is not a directory', () => {
      existsSyncSpy.mockReturnValue(true);
      statSyncSpy.mockReturnValue({ isDirectory: () => false });
      const result = validateGitRepoPath('/some/file.txt');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not a directory');
    });

    it('should reject path without .git directory', () => {
      existsSyncSpy.mockImplementation(p => {
        if (p === '/opt/stacks/some-project') return true;
        if (p === '/opt/stacks/some-project/.git') return false;
        return false;
      });
      statSyncSpy.mockReturnValue({ isDirectory: () => true });
      const result = validateGitRepoPath('/opt/stacks/some-project');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not a git repository');
    });

    it('should accept valid git repo path', () => {
      existsSyncSpy.mockReturnValue(true);
      statSyncSpy.mockReturnValue({ isDirectory: () => true });
      const result = validateGitRepoPath('/opt/stacks/valid-repo');
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should handle statSync throwing', () => {
      existsSyncSpy.mockReturnValue(true);
      statSyncSpy.mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = validateGitRepoPath('/opt/stacks/no-access');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('cannot stat');
    });
  });

  describe('cleanGitUrl', () => {
    it('should strip HTTPS PAT credentials', () => {
      expect(cleanGitUrl('https://ghp_abc123@github.com/oculairmedia/repo.git')).toBe(
        'https://github.com/oculairmedia/repo'
      );
    });

    it('should strip github_pat credentials', () => {
      expect(cleanGitUrl('https://github_pat_LONG_TOKEN@github.com/oculairmedia/repo.git')).toBe(
        'https://github.com/oculairmedia/repo'
      );
    });

    it('should convert SSH to HTTPS', () => {
      expect(cleanGitUrl('git@github.com:oculairmedia/repo.git')).toBe(
        'https://github.com/oculairmedia/repo'
      );
    });

    it('should strip trailing .git from clean URLs', () => {
      expect(cleanGitUrl('https://github.com/oculairmedia/repo.git')).toBe(
        'https://github.com/oculairmedia/repo'
      );
    });

    it('should pass through already-clean URLs', () => {
      expect(cleanGitUrl('https://github.com/oculairmedia/repo')).toBe(
        'https://github.com/oculairmedia/repo'
      );
    });

    it('should return null for non-GitHub URLs', () => {
      expect(cleanGitUrl('https://gitlab.com/user/repo')).toBeNull();
    });

    it('should return null for empty/null input', () => {
      expect(cleanGitUrl(null)).toBeNull();
      expect(cleanGitUrl('')).toBeNull();
    });
  });

  describe('resolveGitUrl', () => {
    it('should return null for non-existent path', async () => {
      expect(await resolveGitUrl('/nonexistent/path')).toBeNull();
    });

    it('should return null for null input', async () => {
      expect(await resolveGitUrl(null)).toBeNull();
    });

    it.skipIf(!fs.existsSync('/opt/stacks/huly-vibe-sync/.git'))(
      'should resolve a real git repo',
      async () => {
        const url = await resolveGitUrl('/opt/stacks/huly-vibe-sync');
        expect(url).toBe('https://github.com/oculairmedia/huly-vibe-sync');
      }
    );
  });
});
