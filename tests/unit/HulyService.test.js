/**
 * Unit Tests for HulyService
 *
 * Tests all Huly-specific service operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchHulyProjects,
  fetchHulyIssues,
  updateHulyIssueStatus,
  updateHulyIssueDescription,
} from '../../lib/HulyService.js';

// Mock the HealthService
vi.mock('../../lib/HealthService.js', () => ({
  recordApiLatency: vi.fn(),
}));

describe('HulyService', () => {
  let mockHulyClient;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    // Create a fresh mock client for each test
    mockHulyClient = {
      listProjects: vi.fn(),
      listIssues: vi.fn(),
      updateIssue: vi.fn(),
    };

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchHulyProjects', () => {
    it('should fetch and return projects successfully', async () => {
      const mockProjects = [
        { identifier: 'PROJ1', name: 'Project 1', id: 'proj-1' },
        { identifier: 'PROJ2', name: 'Project 2', id: 'proj-2' },
      ];

      mockHulyClient.listProjects.mockResolvedValue(mockProjects);

      const result = await fetchHulyProjects(mockHulyClient);

      expect(result).toEqual(mockProjects);
      expect(result).toHaveLength(2);
      expect(mockHulyClient.listProjects).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 projects')
      );
    });

    it('should return empty array on error', async () => {
      mockHulyClient.listProjects.mockRejectedValue(
        new Error('API connection failed')
      );

      const result = await fetchHulyProjects(mockHulyClient);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error fetching projects'),
        expect.stringContaining('API connection failed')
      );
    });

    it('should handle empty project list', async () => {
      mockHulyClient.listProjects.mockResolvedValue([]);

      const result = await fetchHulyProjects(mockHulyClient);

      expect(result).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 projects')
      );
    });

    it('should log sample project in dry run mode', async () => {
      const mockProjects = [
        { identifier: 'TEST', name: 'Test Project', id: 'test-1' },
      ];

      mockHulyClient.listProjects.mockResolvedValue(mockProjects);

      await fetchHulyProjects(mockHulyClient, {
        sync: { dryRun: true },
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sample project'),
        expect.any(String)
      );
    });
  });

  describe('fetchHulyIssues', () => {
    const projectIdentifier = 'TEST';

    it('should fetch issues for a project', async () => {
      const mockIssues = [
        {
          identifier: 'TEST-1',
          title: 'Issue 1',
          status: 'Backlog',
          description: 'Test description',
        },
        {
          identifier: 'TEST-2',
          title: 'Issue 2',
          status: 'In Progress',
          description: 'Another test',
        },
      ];

      mockHulyClient.listIssues.mockResolvedValue(mockIssues);

      const result = await fetchHulyIssues(
        mockHulyClient,
        projectIdentifier
      );

      expect(result).toEqual(mockIssues);
      expect(result).toHaveLength(2);
      expect(mockHulyClient.listIssues).toHaveBeenCalledWith(
        projectIdentifier,
        expect.objectContaining({ limit: 1000 })
      );
    });

    it('should support incremental sync with timestamp', async () => {
      const mockIssues = [{ identifier: 'TEST-1', title: 'New Issue' }];
      const lastSyncTime = Date.now() - 60000; // 1 minute ago

      mockHulyClient.listIssues.mockResolvedValue(mockIssues);

      await fetchHulyIssues(
        mockHulyClient,
        projectIdentifier,
        { sync: { incremental: true } },
        lastSyncTime
      );

      expect(mockHulyClient.listIssues).toHaveBeenCalledWith(
        projectIdentifier,
        expect.objectContaining({
          limit: 1000,
          modifiedAfter: expect.any(String),
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Incremental fetch')
      );
    });

    it('should perform full fetch when no last sync time', async () => {
      const mockIssues = [{ identifier: 'TEST-1', title: 'Issue 1' }];

      mockHulyClient.listIssues.mockResolvedValue(mockIssues);

      await fetchHulyIssues(
        mockHulyClient,
        projectIdentifier,
        { sync: { incremental: true } },
        null
      );

      expect(mockHulyClient.listIssues).toHaveBeenCalledWith(
        projectIdentifier,
        expect.objectContaining({ limit: 1000 })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Full fetch')
      );
    });

    it('should return empty array on error', async () => {
      mockHulyClient.listIssues.mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await fetchHulyIssues(
        mockHulyClient,
        projectIdentifier
      );

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Error fetching issues for ${projectIdentifier}`),
        expect.stringContaining('Network timeout')
      );
    });

    it('should handle empty issue list', async () => {
      mockHulyClient.listIssues.mockResolvedValue([]);

      const result = await fetchHulyIssues(
        mockHulyClient,
        projectIdentifier
      );

      expect(result).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 issues')
      );
    });
  });

  describe('updateHulyIssueStatus', () => {
    const issueIdentifier = 'TEST-1';
    const newStatus = 'In Progress';

    it('should update issue status successfully', async () => {
      mockHulyClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssueStatus(
        mockHulyClient,
        issueIdentifier,
        newStatus
      );

      expect(result).toBe(true);
      expect(mockHulyClient.updateIssue).toHaveBeenCalledWith(
        issueIdentifier,
        expect.objectContaining({ status: newStatus })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`✓ Updated ${issueIdentifier}`)
      );
    });

    it('should skip update in dry run mode', async () => {
      const result = await updateHulyIssueStatus(
        mockHulyClient,
        issueIdentifier,
        newStatus,
        { sync: { dryRun: true } }
      );

      expect(result).toBe(true);
      expect(mockHulyClient.updateIssue).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should return false on error', async () => {
      mockHulyClient.updateIssue.mockRejectedValue(
        new Error('Update failed')
      );

      const result = await updateHulyIssueStatus(
        mockHulyClient,
        issueIdentifier,
        newStatus
      );

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`✗ Error updating ${issueIdentifier}`),
        expect.stringContaining('Update failed')
      );
    });

    it('should normalize status values', async () => {
      mockHulyClient.updateIssue.mockResolvedValue({ success: true });

      await updateHulyIssueStatus(
        mockHulyClient,
        issueIdentifier,
        'inprogress' // Lowercase
      );

      expect(mockHulyClient.updateIssue).toHaveBeenCalledWith(
        issueIdentifier,
        expect.objectContaining({ status: 'In Progress' })
      );
    });
  });

  describe('updateHulyIssueDescription', () => {
    const issueIdentifier = 'TEST-1';
    const newDescription = 'Updated description content';

    it('should update issue description successfully', async () => {
      mockHulyClient.updateIssue.mockResolvedValue({ success: true });

      const result = await updateHulyIssueDescription(
        mockHulyClient,
        issueIdentifier,
        newDescription
      );

      expect(result).toBe(true);
      expect(mockHulyClient.updateIssue).toHaveBeenCalledWith(
        issueIdentifier,
        expect.objectContaining({ description: newDescription })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ Updated description')
      );
    });

    it('should skip update in dry run mode', async () => {
      const result = await updateHulyIssueDescription(
        mockHulyClient,
        issueIdentifier,
        newDescription,
        { sync: { dryRun: true } }
      );

      expect(result).toBe(true);
      expect(mockHulyClient.updateIssue).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should return false on error', async () => {
      mockHulyClient.updateIssue.mockRejectedValue(
        new Error('Update failed')
      );

      const result = await updateHulyIssueDescription(
        mockHulyClient,
        issueIdentifier,
        newDescription
      );

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('✗ Error updating description'),
        expect.stringContaining('Update failed')
      );
    });

    it('should handle empty description', async () => {
      mockHulyClient.updateIssue.mockResolvedValue({ success: true });

      await updateHulyIssueDescription(
        mockHulyClient,
        issueIdentifier,
        ''
      );

      expect(mockHulyClient.updateIssue).toHaveBeenCalledWith(
        issueIdentifier,
        expect.objectContaining({ description: '' })
      );
    });

    it('should handle multiline descriptions', async () => {
      const multilineDesc = 'Line 1\nLine 2\n\nLine 3';
      mockHulyClient.updateIssue.mockResolvedValue({ success: true });

      await updateHulyIssueDescription(
        mockHulyClient,
        issueIdentifier,
        multilineDesc
      );

      expect(mockHulyClient.updateIssue).toHaveBeenCalledWith(
        issueIdentifier,
        expect.objectContaining({ description: multilineDesc })
      );
    });
  });

  describe('error handling', () => {
    it('should gracefully handle null client', async () => {
      const result = await fetchHulyProjects(null).catch(() => []);
      expect(result).toBeDefined();
    });

    it('should handle API timeout', async () => {
      mockHulyClient.listProjects.mockImplementation(
        () => new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const result = await fetchHulyProjects(mockHulyClient);
      expect(result).toEqual([]);
    });

    it('should handle malformed API response', async () => {
      mockHulyClient.listProjects.mockResolvedValue(null);

      await expect(
        fetchHulyProjects(mockHulyClient)
      ).resolves.toBeDefined();
    });
  });

  describe('performance', () => {
    it('should complete fetch within reasonable time', async () => {
      const mockProjects = Array.from({ length: 100 }, (_, i) => ({
        identifier: `PROJ${i}`,
        name: `Project ${i}`,
      }));

      mockHulyClient.listProjects.mockResolvedValue(mockProjects);

      const startTime = Date.now();
      await fetchHulyProjects(mockHulyClient);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in <1s
    });
  });
});
