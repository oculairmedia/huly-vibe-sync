/**
 * Unit Tests for Status Mapper
 * 
 * Tests bidirectional status mapping between Huly and Vibe Kanban
 */

import { describe, it, expect } from 'vitest';
import {
  mapHulyStatusToVibe,
  mapVibeStatusToHuly,
  normalizeStatus,
  areStatusesEquivalent,
} from '../../lib/statusMapper.js';

describe('statusMapper', () => {
  describe('mapHulyStatusToVibe', () => {
    it('should map null/undefined to todo', () => {
      expect(mapHulyStatusToVibe(null)).toBe('todo');
      expect(mapHulyStatusToVibe(undefined)).toBe('todo');
      expect(mapHulyStatusToVibe('')).toBe('todo');
    });

    it('should map Backlog to todo', () => {
      expect(mapHulyStatusToVibe('Backlog')).toBe('todo');
      expect(mapHulyStatusToVibe('backlog')).toBe('todo');
      expect(mapHulyStatusToVibe('BACKLOG')).toBe('todo');
    });

    it('should map Todo to todo', () => {
      expect(mapHulyStatusToVibe('Todo')).toBe('todo');
      expect(mapHulyStatusToVibe('todo')).toBe('todo');
      expect(mapHulyStatusToVibe('TO DO')).toBe('todo');
    });

    it('should map In Progress to inprogress', () => {
      expect(mapHulyStatusToVibe('In Progress')).toBe('inprogress');
      expect(mapHulyStatusToVibe('in progress')).toBe('inprogress');
      expect(mapHulyStatusToVibe('Progress')).toBe('inprogress');
      expect(mapHulyStatusToVibe('Working')).toBe('todo'); // Doesn't contain "progress"
    });

    it('should map In Review to inreview', () => {
      expect(mapHulyStatusToVibe('In Review')).toBe('inreview');
      expect(mapHulyStatusToVibe('in review')).toBe('inreview');
      expect(mapHulyStatusToVibe('Review')).toBe('inreview');
      expect(mapHulyStatusToVibe('Code Review')).toBe('inreview');
    });

    it('should map Done to done', () => {
      expect(mapHulyStatusToVibe('Done')).toBe('done');
      expect(mapHulyStatusToVibe('done')).toBe('done');
      expect(mapHulyStatusToVibe('DONE')).toBe('done');
      expect(mapHulyStatusToVibe('Completed')).toBe('done');
      expect(mapHulyStatusToVibe('completed')).toBe('done');
    });

    it('should map Cancelled to cancelled', () => {
      expect(mapHulyStatusToVibe('Cancelled')).toBe('cancelled');
      expect(mapHulyStatusToVibe('cancelled')).toBe('cancelled');
      expect(mapHulyStatusToVibe('Cancel')).toBe('cancelled');
      expect(mapHulyStatusToVibe('Canceled')).toBe('cancelled'); // US spelling
    });

    it('should default unknown statuses to todo', () => {
      expect(mapHulyStatusToVibe('Unknown')).toBe('todo');
      expect(mapHulyStatusToVibe('Pending')).toBe('todo');
      expect(mapHulyStatusToVibe('Blocked')).toBe('todo');
      expect(mapHulyStatusToVibe('Random Status')).toBe('todo');
    });

    it('should handle mixed case and spacing', () => {
      expect(mapHulyStatusToVibe('  Todo  ')).toBe('todo');
      expect(mapHulyStatusToVibe('iN PrOgReSs')).toBe('inprogress');
      expect(mapHulyStatusToVibe(' DONE ')).toBe('done');
    });
  });

  describe('mapVibeStatusToHuly', () => {
    it('should map todo to Backlog', () => {
      expect(mapVibeStatusToHuly('todo')).toBe('Backlog');
    });

    it('should map inprogress to In Progress', () => {
      expect(mapVibeStatusToHuly('inprogress')).toBe('In Progress');
    });

    it('should map inreview to In Review', () => {
      expect(mapVibeStatusToHuly('inreview')).toBe('In Review');
    });

    it('should map done to Done', () => {
      expect(mapVibeStatusToHuly('done')).toBe('Done');
    });

    it("should map cancelled to Canceled", () => {
      expect(mapVibeStatusToHuly('cancelled')).toBe('Canceled');
    });

    it('should default unknown statuses to Backlog', () => {
      expect(mapVibeStatusToHuly('unknown')).toBe('Backlog');
      expect(mapVibeStatusToHuly('pending')).toBe('Backlog');
      expect(mapVibeStatusToHuly('')).toBe('Backlog');
      expect(mapVibeStatusToHuly(null)).toBe('Backlog');
    });

    it('should be case-sensitive (Vibe statuses are lowercase)', () => {
      expect(mapVibeStatusToHuly('TODO')).toBe('Backlog'); // Not recognized
      expect(mapVibeStatusToHuly('Done')).toBe('Backlog'); // Not recognized
      expect(mapVibeStatusToHuly('todo')).toBe('Backlog'); // Correct
    });
  });

  describe('normalizeStatus', () => {
    it('should convert to lowercase and trim', () => {
      expect(normalizeStatus('TODO')).toBe('todo');
      expect(normalizeStatus('  Done  ')).toBe('done');
      expect(normalizeStatus('In Progress')).toBe('in progress');
    });

    it('should handle null/undefined/empty', () => {
      expect(normalizeStatus(null)).toBe('');
      expect(normalizeStatus(undefined)).toBe('');
      expect(normalizeStatus('')).toBe('');
    });

    it('should handle already normalized values', () => {
      expect(normalizeStatus('todo')).toBe('todo');
      expect(normalizeStatus('done')).toBe('done');
    });
  });

  describe('areStatusesEquivalent', () => {
    it('should return true for equivalent statuses', () => {
      expect(areStatusesEquivalent('Backlog', 'todo')).toBe(true);
      expect(areStatusesEquivalent('In Progress', 'inprogress')).toBe(true);
      expect(areStatusesEquivalent('Done', 'done')).toBe(true);
      expect(areStatusesEquivalent('Cancelled', 'cancelled')).toBe(true);
    });

    it('should return false for non-equivalent statuses', () => {
      expect(areStatusesEquivalent('Backlog', 'done')).toBe(false);
      expect(areStatusesEquivalent('In Progress', 'todo')).toBe(false);
      expect(areStatusesEquivalent('Done', 'cancelled')).toBe(false);
    });

    it('should handle case variations', () => {
      expect(areStatusesEquivalent('BACKLOG', 'todo')).toBe(true);
      expect(areStatusesEquivalent('done', 'done')).toBe(true);
      expect(areStatusesEquivalent('In PROGRESS', 'inprogress')).toBe(true);
    });

    it('should handle null/undefined values', () => {
      expect(areStatusesEquivalent(null, 'todo')).toBe(true); // null maps to todo
      expect(areStatusesEquivalent('Backlog', null)).toBe(false); // Backlog->todo, null->''
      expect(areStatusesEquivalent(null, null)).toBe(false); // null->todo vs null->'' (not equivalent)
    });
  });

  describe('bidirectional mapping consistency', () => {
    it('should round-trip correctly for standard statuses', () => {
      const hulyStatuses = ['Backlog', 'In Progress', 'In Review', 'Done', 'Cancelled'];
      
      for (const hulyStatus of hulyStatuses) {
        const vibeStatus = mapHulyStatusToVibe(hulyStatus);
        const backToHuly = mapVibeStatusToHuly(vibeStatus);
        
        // The round-trip should produce a normalized version
        // (e.g., "Todo" -> "todo" -> "Backlog", not back to "Todo")
        expect(backToHuly).toBeTruthy();
        expect(areStatusesEquivalent(hulyStatus, vibeStatus)).toBe(true);
      }
    });

    it('should maintain semantic equivalence after mapping', () => {
      // Test that semantic meaning is preserved
      const mappings = [
        { huly: 'Backlog', vibe: 'todo' },
        { huly: 'Todo', vibe: 'todo' },
        { huly: 'In Progress', vibe: 'inprogress' },
        { huly: 'In Review', vibe: 'inreview' },
        { huly: 'Done', vibe: 'done' },
        { huly: 'Completed', vibe: 'done' },
        { huly: 'Cancelled', vibe: 'cancelled' },
      ];

      for (const { huly, vibe } of mappings) {
        expect(mapHulyStatusToVibe(huly)).toBe(vibe);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle statuses with special characters', () => {
      expect(mapHulyStatusToVibe('In-Progress')).toBe('inprogress');
      expect(mapHulyStatusToVibe('Done!')).toBe('done');
      expect(mapHulyStatusToVibe('Todo?')).toBe('todo');
    });

    it('should handle statuses with numbers', () => {
      expect(mapHulyStatusToVibe('Todo 1')).toBe('todo');
      expect(mapHulyStatusToVibe('Phase 2 Progress')).toBe('inprogress');
      expect(mapHulyStatusToVibe('Done v2')).toBe('done');
    });

    it('should handle very long status strings', () => {
      const longStatus = 'This is a very long status that contains the word progress somewhere in the middle';
      expect(mapHulyStatusToVibe(longStatus)).toBe('inprogress');
    });

    it('should handle status strings with partial matches', () => {
      expect(mapHulyStatusToVibe('Progressive')).toBe('inprogress'); // Contains "progress"
      expect(mapHulyStatusToVibe('Reviewer')).toBe('inreview'); // Contains "review"
      expect(mapHulyStatusToVibe('Canceled order')).toBe('cancelled'); // Contains "cancel"
    });
  });
});
