/**
 * Integration Tests for Sync Flows
 * 
 * Tests end-to-end synchronization between Huly and Vibe Kanban
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncDatabase } from '../../lib/database.js';
import { HulyRestClient } from '../../lib/HulyRestClient.js';
import { mapHulyStatusToVibe, mapVibeStatusToHuly } from '../../lib/statusMapper.js';
import {
  createMockHulyProject,
  createMockHulyIssue,
  createMockListProjectsResponse,
  createMockListIssuesResponse,
  createMockToolResponse,
} from '../mocks/hulyMocks.js';
import {
  createMockVibeTask,
  createMockVibeProject,
} from '../mocks/vibeMocks.js';
import fs from 'fs';
import path from 'path';

describe('Sync Integration Tests', () => {
  let db;
  let hulyClient;
  let mockFetch;
  const testDbPath = ':memory:'; // Use in-memory DB for tests

  beforeEach(() => {
    // Initialize database
    db = new SyncDatabase(testDbPath);
    db.initialize(); // Must call initialize after construction

    // Create Huly client
    hulyClient = new HulyRestClient('http://localhost:3458');

    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.restoreAllMocks();
  });

  describe('Huly to Database sync', () => {
    it('should fetch projects from Huly and store in database', async () => {
      const mockProjects = [
        createMockHulyProject({ identifier: 'TEST1', name: 'Test Project 1' }),
        createMockHulyProject({ identifier: 'TEST2', name: 'Test Project 2' }),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ projects: mockProjects }),
      });

      // Fetch projects from Huly
      const projects = await hulyClient.listProjects();

      // Store in database
      for (const project of projects) {
        db.upsertProject(project);
      }

      // Verify storage
      const storedProjects = db.getAllProjects();
      expect(storedProjects).toHaveLength(2);
      expect(storedProjects[0].identifier).toBe('TEST1');
      expect(storedProjects[1].identifier).toBe('TEST2');
    });

    it('should fetch issues from Huly and store in database', async () => {
      // Setup: Add project first
      db.upsertProject({ identifier: 'TEST', name: 'Test Project', description: 'Description' });

      const mockIssues = [
        createMockHulyIssue({ identifier: 'TEST-1', title: 'Issue 1', status: 'Todo' }),
        createMockHulyIssue({ identifier: 'TEST-2', title: 'Issue 2', status: 'InProgress' }),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues: mockIssues, count: mockIssues.length }),
      });

      // Fetch issues from Huly
      const issues = await hulyClient.listIssues('TEST');

      // Store in database
      for (const issue of issues) {
        db.upsertIssue({
          identifier: issue.identifier,
          project_identifier: 'TEST',
          title: issue.title,
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
        });
      }

      // Verify storage
      const storedIssues = db.getProjectIssues('TEST');
      expect(storedIssues).toHaveLength(2);
      expect(storedIssues[0].identifier).toBe('TEST-1');
      expect(storedIssues[0].status).toBe('Todo');
    });

    it('should handle incremental sync with modifiedAfter', async () => {
      // Setup: Add project and existing issue
      db.upsertProject({ identifier: 'TEST', name: 'Test Project', description: 'Description' });
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Old Issue',
        description: 'Old',
        status: 'Done',
        priority: 'Medium',
      });

      const lastSync = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago

      // Only return modified issues
      const mockModifiedIssues = [
        createMockHulyIssue({ 
          identifier: 'TEST-2', 
          title: 'New Issue',
          modifiedOn: new Date().toISOString(),
        }),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ 
          issues: mockModifiedIssues, 
          count: mockModifiedIssues.length,
        }),
      });

      // Fetch with incremental sync
      const issues = await hulyClient.listIssues('TEST', { modifiedAfter: lastSync });

      expect(issues).toHaveLength(1);
      expect(issues[0].identifier).toBe('TEST-2');

      // Verify old issue wasn't modified
      const allIssues = db.getProjectIssues('TEST');
      expect(allIssues).toHaveLength(1); // Only old one exists in DB before update
    });
  });

  describe('Status mapping integration', () => {
    it('should correctly map statuses during sync', () => {
      // Huly -> Vibe
      expect(mapHulyStatusToVibe('Todo')).toBe('todo');
      expect(mapHulyStatusToVibe('InProgress')).toBe('inprogress');
      expect(mapHulyStatusToVibe('Done')).toBe('done');
      expect(mapHulyStatusToVibe('Cancelled')).toBe('cancelled');

      // Vibe -> Huly (based on actual implementation)
      expect(mapVibeStatusToHuly('todo')).toBe('Backlog');
      expect(mapVibeStatusToHuly('inprogress')).toBe('In Progress');
      expect(mapVibeStatusToHuly('done')).toBe('Done');
      expect(mapVibeStatusToHuly('cancelled')).toBe('Cancelled');
    });

    it('should handle unknown statuses gracefully', () => {
      expect(mapHulyStatusToVibe('UnknownStatus')).toBe('todo');
      expect(mapVibeStatusToHuly('unknown')).toBe('Backlog');
    });

    it('should map backlog status correctly', () => {
      // Both Backlog and Todo should map to 'todo' in Vibe
      expect(mapHulyStatusToVibe('Backlog')).toBe('todo');
      expect(mapHulyStatusToVibe('Todo')).toBe('todo');
      
      // And vice versa, 'todo' maps to 'Backlog' in Huly
      expect(mapVibeStatusToHuly('todo')).toBe('Backlog');
    });
  });

  describe('Bidirectional sync', () => {
    it('should sync issue updates from Huly to database', async () => {
      // Setup
      db.upsertProject({ identifier: 'TEST', name: 'Test Project', description: 'Description' });
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue 1',
        description: 'Description',
        status: 'Todo',
        priority: 'Medium',
      });

      // Mock Huly update response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          issueId: 'TEST-1',
          field: 'status',
          value: 'Done',
          success: true,
        }),
      });

      // Update via Huly API
      await hulyClient.updateIssue('TEST-1', 'status', 'Done');

      // Update local database
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue 1',
        description: 'Description',
        status: 'Done',
        priority: 'Medium',
      });

      // Verify
      const issue = db.getIssue('TEST-1');
      expect(issue.status).toBe('Done');
    });

    it('should track sync history', () => {
      // Start sync run
      const syncId = db.startSyncRun();
      expect(syncId).toBeGreaterThan(0);

      // Complete sync run
      db.completeSyncRun(syncId, {
        projectsProcessed: 2,
        projectsFailed: 0,
        issuesSynced: 5,
        errors: [],
        durationMs: 100,
      });

      // Verify history
      const recentSyncs = db.getRecentSyncs(10);
      expect(recentSyncs).toHaveLength(1);
      expect(recentSyncs[0].projects_processed).toBe(2);
      expect(recentSyncs[0].issues_synced).toBe(5);
      expect(recentSyncs[0].completed_at).toBeTruthy();
    });
  });

  describe('Error handling in sync flows', () => {
    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(hulyClient.listProjects()).rejects.toThrow('Network error');
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error',
      });

      await expect(hulyClient.listProjects()).rejects.toThrow('REST API error (500)');
    });

    it('should handle database errors gracefully', () => {
      db.close();

      expect(() => {
        db.upsertProject('TEST', 'Test', 'Description');
      }).toThrow();
    });
  });

  describe('Performance characteristics', () => {
    it('should handle batch project sync efficiently', async () => {
      // Create many projects
      const projects = Array.from({ length: 100 }, (_, i) =>
        createMockHulyProject({ 
          identifier: `TEST${i}`, 
          name: `Project ${i}`,
        })
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ projects }),
      });

      const start = Date.now();
      const fetchedProjects = await hulyClient.listProjects();
      
      // Store in database
      for (const project of fetchedProjects) {
        db.upsertProject(project);
      }
      
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 1 second for 100 projects)
      expect(duration).toBeLessThan(1000);
      expect(db.getAllProjects()).toHaveLength(100);
    });

    it('should handle batch issue sync efficiently', async () => {
      // Setup project
      db.upsertProject({ identifier: 'TEST', name: 'Test Project', description: 'Description' });

      // Create many issues
      const issues = Array.from({ length: 200 }, (_, i) =>
        createMockHulyIssue({ 
          identifier: `TEST-${i}`, 
          title: `Issue ${i}`,
        })
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ issues, count: issues.length }),
      });

      const start = Date.now();
      const fetchedIssues = await hulyClient.listIssues('TEST');
      
      // Store in database
      for (const issue of fetchedIssues) {
        db.upsertIssue({
          identifier: issue.identifier,
          project_identifier: 'TEST',
          title: issue.title,
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
        });
      }
      
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 2 seconds for 200 issues)
      expect(duration).toBeLessThan(2000);
      expect(db.getProjectIssues('TEST')).toHaveLength(200);
    });
  });

  describe('Data consistency', () => {
    it('should maintain referential integrity', () => {
      // Try to insert issue without project
      expect(() => {
        db.upsertIssue({
          identifier: 'NOPROJECT-1',
          project_identifier: 'NOPROJECT',
          title: 'Issue',
          description: 'Desc',
          status: 'Todo',
          priority: 'Medium',
        });
      }).toThrow(); // Should fail due to foreign key constraint
    });

    it('should handle concurrent updates correctly', () => {
      db.upsertProject({ identifier: 'TEST', name: 'Test Project', description: 'Description' });
      
      // Insert same issue multiple times (simulating concurrent updates)
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue v1',
        description: 'Desc',
        status: 'Todo',
        priority: 'Medium',
      });
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue v2',
        description: 'Desc',
        status: 'InProgress',
        priority: 'High',
      });
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue v3',
        description: 'Desc',
        status: 'Done',
        priority: 'Low',
      });

      // Should have latest version
      const issue = db.getIssue('TEST-1');
      expect(issue.title).toBe('Issue v3');
      expect(issue.status).toBe('Done');
      expect(issue.priority).toBe('Low');
    });

    it('should track modification timestamps', async () => {
      db.upsertProject({ identifier: 'TEST', name: 'Test Project', description: 'Description' });
      
      const before = Date.now();
      db.upsertIssue({
        identifier: 'TEST-1',
        project_identifier: 'TEST',
        title: 'Issue',
        description: 'Desc',
        status: 'Todo',
        priority: 'Medium',
      });
      const after = Date.now();

      const issue = db.getIssue('TEST-1');
      const updatedAt = new Date(issue.updated_at).getTime();
      
      expect(updatedAt).toBeGreaterThanOrEqual(before);
      expect(updatedAt).toBeLessThanOrEqual(after);
    });
  });
});
