/**
 * Unit Tests for Text Parsers
 *
 * Tests parsing of structured text from Huly MCP output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  parseProjectsFromText,
  parseIssuesFromText,
  extractFilesystemPath,
  extractHulyIdentifierFromDescription,
  parseIssueCount,
  extractFullDescription,
  extractHulyIdentifier,
  getGitUrl,
  determineGitRepoPath,
} from '../../lib/textParsers.js';

describe('textParsers', () => {
  describe('parseProjectsFromText', () => {
    it('should parse a single project', () => {
      const text = `
📁 Test Project (TEST)
Description: A test project
Issues: 10 open
Status: active
      `.trim();

      const projects = parseProjectsFromText(text);

      expect(projects).toHaveLength(1);
      expect(projects[0]).toEqual({
        name: 'Test Project',
        identifier: 'TEST',
        description: 'A test project',
        issues: 10,
        status: 'active',
      });
    });

    it('should parse multiple projects', () => {
      const text = `
📁 First Project (FIRST)
Description: First description
Issues: 5 open
Status: active

📁 Second Project (SECOND)
Description: Second description
Issues: 15 open
Status: active
      `.trim();

      const projects = parseProjectsFromText(text);

      expect(projects).toHaveLength(2);
      expect(projects[0].identifier).toBe('FIRST');
      expect(projects[1].identifier).toBe('SECOND');
    });

    it('should handle projects without descriptions', () => {
      const text = `
📁 Minimal Project (MIN)
Issues: 0 open
Status: active
      `.trim();

      const projects = parseProjectsFromText(text);

      expect(projects).toHaveLength(1);
      expect(projects[0].description).toBe('');
      expect(projects[0].issues).toBe(0);
    });

    it('should handle filesystem paths in descriptions', () => {
      const text = `
📁 Code Project (CODE)
Description: A project with code
Filesystem: /opt/stacks/my-project
Issues: 5 open
      `.trim();

      const projects = parseProjectsFromText(text);

      expect(projects).toHaveLength(1);
      expect(projects[0].description).toContain('Filesystem:');
      expect(projects[0].description).toContain('/opt/stacks/my-project');
    });

    it('should parse project names with special characters', () => {
      const text = `
📁 Project with (parentheses) and spaces (SPEC)
Description: Special chars test
Issues: 2 open
      `.trim();

      const projects = parseProjectsFromText(text);

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Project with (parentheses) and spaces');
      expect(projects[0].identifier).toBe('SPEC');
    });

    it('should handle empty text', () => {
      const projects = parseProjectsFromText('');
      expect(projects).toHaveLength(0);
    });

    it('should handle malformed input gracefully', () => {
      const text = `
Some random text
Not a project header
📁 Valid Project (VALID)
Issues: 5 open
Random text again
      `.trim();

      const projects = parseProjectsFromText(text);

      expect(projects).toHaveLength(1);
      expect(projects[0].identifier).toBe('VALID');
    });

    it('should parse issue count correctly', () => {
      const testCases = [
        { input: 'Issues: 0 open', expected: 0 },
        { input: 'Issues: 1 open', expected: 1 },
        { input: 'Issues: 42 open', expected: 42 },
        { input: 'Issues: 100 total', expected: 100 },
        { input: 'Issues: invalid', expected: 0 },
      ];

      for (const { input, expected } of testCases) {
        const text = `
📁 Test (TEST)
${input}
        `.trim();

        const projects = parseProjectsFromText(text);
        expect(projects[0].issues).toBe(expected);
      }
    });
  });

  describe('parseIssuesFromText', () => {
    it('should parse a single issue', () => {
      const text = `
📋 **TEST-1**: First issue
Status: in progress
Priority: high
Description: This is a test issue
      `.trim();

      const issues = parseIssuesFromText(text);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual({
        identifier: 'TEST-1',
        title: 'First issue',
        description: 'This is a test issue',
        status: 'in progress',
        priority: 'high',
        component: null,
        milestone: null,
      });
    });

    it('should parse multiple issues', () => {
      const text = `
📋 **TEST-1**: First issue
Status: todo
Priority: low
Description: First description

📋 **TEST-2**: Second issue
Status: done
Priority: high
Description: Second description
      `.trim();

      const issues = parseIssuesFromText(text);

      expect(issues).toHaveLength(2);
      expect(issues[0].identifier).toBe('TEST-1');
      expect(issues[1].identifier).toBe('TEST-2');
    });

    it('should handle issues with project ID', () => {
      const text = `
📋 **TEST-1**: Test issue
Status: todo
      `.trim();

      const issues = parseIssuesFromText(text, 'test-project-id');

      expect(issues).toHaveLength(1);
      expect(issues[0].project).toBe('test-project-id');
    });

    it('should parse issues with components and milestones', () => {
      const text = `
📋 **TEST-1**: Feature issue
Status: in progress
Priority: high
Component: Frontend
Milestone: v1.0
Description: Build UI component
      `.trim();

      const issues = parseIssuesFromText(text);

      expect(issues).toHaveLength(1);
      expect(issues[0].component).toBe('Frontend');
      expect(issues[0].milestone).toBe('v1.0');
    });

    it('should use default values for missing fields', () => {
      const text = `
📋 **TEST-1**: Minimal issue
      `.trim();

      const issues = parseIssuesFromText(text);

      expect(issues).toHaveLength(1);
      expect(issues[0].status).toBe('unknown');
      expect(issues[0].priority).toBe('medium');
      expect(issues[0].description).toBe('');
      expect(issues[0].component).toBeNull();
      expect(issues[0].milestone).toBeNull();
    });

    it('should handle empty text', () => {
      const issues = parseIssuesFromText('');
      expect(issues).toHaveLength(0);
    });

    it('should handle malformed issue headers gracefully', () => {
      const text = `
Some random text
📋 **TEST-1**: Valid issue
Status: todo
Not an issue header
📋 Invalid header without colon
      `.trim();

      const issues = parseIssuesFromText(text);

      expect(issues).toHaveLength(1);
      expect(issues[0].identifier).toBe('TEST-1');
    });

    it('should parse issue titles with special characters', () => {
      const text = `
📋 **TEST-1**: Fix bug: API timeout (critical!)
Status: in progress
      `.trim();

      const issues = parseIssuesFromText(text);

      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe('Fix bug: API timeout (critical!)');
    });
  });

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

  describe('extractHulyIdentifierFromDescription', () => {
    it('should extract identifier with "Huly Issue:" prefix', () => {
      const description = 'Task description\n\n---\nHuly Issue: TEST-123';
      const identifier = extractHulyIdentifierFromDescription(description);
      expect(identifier).toBe('TEST-123');
    });

    it('should extract identifier with "Synced from Huly:" prefix', () => {
      const description = 'Synced from Huly: PROJ-456';
      const identifier = extractHulyIdentifierFromDescription(description);
      expect(identifier).toBe('PROJ-456');
    });

    it('should be case-insensitive', () => {
      const description = 'huly issue: TEST-789';
      const identifier = extractHulyIdentifierFromDescription(description);
      expect(identifier).toBe('TEST-789');
    });

    it('should return null for descriptions without identifiers', () => {
      const description = 'Regular task description';
      const identifier = extractHulyIdentifierFromDescription(description);
      expect(identifier).toBeNull();
    });

    it('should return null for null/undefined/empty input', () => {
      expect(extractHulyIdentifierFromDescription(null)).toBeNull();
      expect(extractHulyIdentifierFromDescription(undefined)).toBeNull();
      expect(extractHulyIdentifierFromDescription('')).toBeNull();
    });

    it('should extract first identifier if multiple are present', () => {
      const description = 'Huly Issue: TEST-1\nHuly Issue: TEST-2';
      const identifier = extractHulyIdentifierFromDescription(description);
      expect(identifier).toBe('TEST-1');
    });

    it('should handle various project code formats', () => {
      const testCases = ['Huly Issue: A-1', 'Huly Issue: ABC-999', 'Huly Issue: PROJECT-42'];

      for (const description of testCases) {
        const identifier = extractHulyIdentifierFromDescription(description);
        expect(identifier).toBeTruthy();
        expect(identifier).toMatch(/^[A-Z]+-\d+$/);
      }
    });
  });

  describe('parseIssueCount', () => {
    it('should parse issue count from text', () => {
      expect(parseIssueCount('10 open')).toBe(10);
      expect(parseIssueCount('5 total')).toBe(5);
      expect(parseIssueCount('0 issues')).toBe(0);
      expect(parseIssueCount('42')).toBe(42);
    });

    it('should extract first number from text', () => {
      expect(parseIssueCount('Found 25 issues in 3 projects')).toBe(25);
      expect(parseIssueCount('123 abc 456')).toBe(123);
    });

    it('should return 0 for text without numbers', () => {
      expect(parseIssueCount('no issues')).toBe(0);
      expect(parseIssueCount('unknown')).toBe(0);
      expect(parseIssueCount('')).toBe(0);
    });

    it('should return 0 for null/undefined input', () => {
      expect(parseIssueCount(null)).toBe(0);
      expect(parseIssueCount(undefined)).toBe(0);
    });

    it('should handle large numbers', () => {
      expect(parseIssueCount('1000 issues')).toBe(1000);
      expect(parseIssueCount('999999 total')).toBe(999999);
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

  describe('integration tests', () => {
    it('should parse a complete project list with all fields', () => {
      const text = `
📁 Frontend App (FRONT)
Description: React-based frontend application
Filesystem: /opt/stacks/frontend
Issues: 25 open
Status: active

📁 Backend API (BACK)
Description: Node.js REST API server
Filesystem: /opt/stacks/backend
Issues: 15 open
Status: active

📁 Documentation (DOCS)
Description: Project documentation and guides
Issues: 5 open
Status: active
      `.trim();

      const projects = parseProjectsFromText(text);

      expect(projects).toHaveLength(3);

      // Verify all projects parsed correctly
      expect(projects[0].identifier).toBe('FRONT');
      expect(projects[1].identifier).toBe('BACK');
      expect(projects[2].identifier).toBe('DOCS');

      // Verify filesystem paths extracted
      expect(extractFilesystemPath(projects[0].description)).toBe('/opt/stacks/frontend');
      expect(extractFilesystemPath(projects[1].description)).toBe('/opt/stacks/backend');
    });

    it('should parse a complete issue list with all fields', () => {
      const text = `
📋 **PROJ-1**: Implement user authentication
Status: in progress
Priority: high
Component: Backend
Milestone: v1.0
Description: Add JWT-based auth system

📋 **PROJ-2**: Design landing page
Status: todo
Priority: medium
Component: Frontend
Milestone: v1.0
Description: Create responsive landing page

📋 **PROJ-3**: Write API documentation
Status: done
Priority: low
Component: Documentation
Description: Document all API endpoints
      `.trim();

      const issues = parseIssuesFromText(text, 'test-project');

      expect(issues).toHaveLength(3);

      // Verify all issues parsed correctly
      expect(issues[0]).toMatchObject({
        identifier: 'PROJ-1',
        title: 'Implement user authentication',
        status: 'in progress',
        priority: 'high',
        component: 'Backend',
        milestone: 'v1.0',
        project: 'test-project',
      });

      expect(issues[1]).toMatchObject({
        identifier: 'PROJ-2',
        component: 'Frontend',
        milestone: 'v1.0',
      });

      expect(issues[2]).toMatchObject({
        identifier: 'PROJ-3',
        status: 'done',
        milestone: null, // No milestone specified
      });
    });
  });
});
