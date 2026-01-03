/**
 * Unit Tests for Status Mapper
 *
 * Tests bidirectional status mapping between Huly, Vibe Kanban, and Beads
 */

import { describe, it, expect } from 'vitest';
import {
  mapHulyStatusToVibe,
  mapVibeStatusToHuly,
  normalizeStatus,
  areStatusesEquivalent,
  // Beads mapping functions
  mapHulyStatusToBeads,
  mapBeadsStatusToHuly,
  mapHulyPriorityToBeads,
  mapBeadsPriorityToHuly,
  mapHulyTypeToBeads,
  mapBeadsTypeToHuly,
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

    it('should map cancelled to Canceled', () => {
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

// ============================================================
// BEADS MAPPING TESTS
// ============================================================

describe('beadsStatusMapper', () => {
  describe('mapHulyStatusToBeads', () => {
    it('should return object with status and label', () => {
      const result = mapHulyStatusToBeads('In Progress');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('label');
    });

    it('should map null/undefined to open with no label', () => {
      expect(mapHulyStatusToBeads(null)).toEqual({ status: 'open', label: null });
      expect(mapHulyStatusToBeads(undefined)).toEqual({ status: 'open', label: null });
      expect(mapHulyStatusToBeads('')).toEqual({ status: 'open', label: null });
    });

    it('should map Done to closed with no label', () => {
      expect(mapHulyStatusToBeads('Done')).toEqual({ status: 'closed', label: null });
      expect(mapHulyStatusToBeads('done')).toEqual({ status: 'closed', label: null });
      expect(mapHulyStatusToBeads('DONE')).toEqual({ status: 'closed', label: null });
    });

    it('should map Completed to closed with no label', () => {
      expect(mapHulyStatusToBeads('Completed')).toEqual({ status: 'closed', label: null });
      expect(mapHulyStatusToBeads('completed')).toEqual({ status: 'closed', label: null });
    });

    it('should map Cancelled to closed with huly:Canceled label', () => {
      expect(mapHulyStatusToBeads('Cancelled')).toEqual({ status: 'closed', label: 'huly:Canceled' });
      expect(mapHulyStatusToBeads('cancelled')).toEqual({ status: 'closed', label: 'huly:Canceled' });
      expect(mapHulyStatusToBeads('Canceled')).toEqual({ status: 'closed', label: 'huly:Canceled' });
      expect(mapHulyStatusToBeads('Cancel')).toEqual({ status: 'closed', label: 'huly:Canceled' });
    });

    it('should map Backlog to open with no label', () => {
      expect(mapHulyStatusToBeads('Backlog')).toEqual({ status: 'open', label: null });
    });

    it('should map Todo to open with huly:Todo label', () => {
      expect(mapHulyStatusToBeads('Todo')).toEqual({ status: 'open', label: 'huly:Todo' });
    });

    it('should map In Progress to in_progress with no label', () => {
      expect(mapHulyStatusToBeads('In Progress')).toEqual({ status: 'in_progress', label: null });
    });

    it('should map In Review to in_progress with huly:In Review label', () => {
      expect(mapHulyStatusToBeads('In Review')).toEqual({ status: 'in_progress', label: 'huly:In Review' });
    });

    it('should map unknown statuses to open with no label', () => {
      expect(mapHulyStatusToBeads('Unknown')).toEqual({ status: 'open', label: null });
      expect(mapHulyStatusToBeads('Blocked')).toEqual({ status: 'open', label: null });
      expect(mapHulyStatusToBeads('Pending')).toEqual({ status: 'open', label: null });
    });

    it('should handle case insensitivity', () => {
      expect(mapHulyStatusToBeads('DONE').status).toBe('closed');
      expect(mapHulyStatusToBeads('dOnE').status).toBe('closed');
      expect(mapHulyStatusToBeads('IN PROGRESS').status).toBe('in_progress');
    });
  });

  describe('mapBeadsStatusToHuly', () => {
    it('should map open to Backlog by default', () => {
      expect(mapBeadsStatusToHuly('open')).toBe('Backlog');
    });

    it('should map open with huly:Todo label to Todo', () => {
      expect(mapBeadsStatusToHuly('open', ['huly:Todo'])).toBe('Todo');
    });

    it('should map in_progress to In Progress by default', () => {
      expect(mapBeadsStatusToHuly('in_progress')).toBe('In Progress');
    });

    it('should map in_progress with huly:In Review label to In Review', () => {
      expect(mapBeadsStatusToHuly('in_progress', ['huly:In Review'])).toBe('In Review');
    });

    it('should map blocked to In Progress (Huly has no blocked status)', () => {
      expect(mapBeadsStatusToHuly('blocked')).toBe('In Progress');
    });

    it('should map deferred to Backlog', () => {
      expect(mapBeadsStatusToHuly('deferred')).toBe('Backlog');
    });

    it('should map closed to Done by default', () => {
      expect(mapBeadsStatusToHuly('closed')).toBe('Done');
    });

    it('should map closed with huly:Canceled label to Canceled', () => {
      expect(mapBeadsStatusToHuly('closed', ['huly:Canceled'])).toBe('Canceled');
    });

    it('should default unknown statuses to Backlog', () => {
      expect(mapBeadsStatusToHuly('unknown')).toBe('Backlog');
      expect(mapBeadsStatusToHuly('')).toBe('Backlog');
      expect(mapBeadsStatusToHuly(null)).toBe('Backlog');
      expect(mapBeadsStatusToHuly(undefined)).toBe('Backlog');
    });

    it('should ignore non-huly labels', () => {
      expect(mapBeadsStatusToHuly('open', ['bug', 'feature'])).toBe('Backlog');
      expect(mapBeadsStatusToHuly('closed', ['important', 'urgent'])).toBe('Done');
    });
  });

  describe('mapHulyPriorityToBeads', () => {
    it('should map null/undefined to P2 (medium)', () => {
      expect(mapHulyPriorityToBeads(null)).toBe(2);
      expect(mapHulyPriorityToBeads(undefined)).toBe(2);
      expect(mapHulyPriorityToBeads('')).toBe(2);
    });

    it('should map Urgent/Critical to P0', () => {
      expect(mapHulyPriorityToBeads('Urgent')).toBe(0);
      expect(mapHulyPriorityToBeads('urgent')).toBe(0);
      expect(mapHulyPriorityToBeads('Critical')).toBe(0);
      expect(mapHulyPriorityToBeads('critical')).toBe(0);
    });

    it('should map High to P1', () => {
      expect(mapHulyPriorityToBeads('High')).toBe(1);
      expect(mapHulyPriorityToBeads('high')).toBe(1);
      expect(mapHulyPriorityToBeads('HIGH')).toBe(1);
    });

    it('should map Medium to P2', () => {
      expect(mapHulyPriorityToBeads('Medium')).toBe(2);
      expect(mapHulyPriorityToBeads('medium')).toBe(2);
    });

    it('should map Low to P3', () => {
      expect(mapHulyPriorityToBeads('Low')).toBe(3);
      expect(mapHulyPriorityToBeads('low')).toBe(3);
    });

    it('should map NoPriority/None to P4', () => {
      expect(mapHulyPriorityToBeads('NoPriority')).toBe(4);
      expect(mapHulyPriorityToBeads('None')).toBe(4);
      expect(mapHulyPriorityToBeads('none')).toBe(4);
      expect(mapHulyPriorityToBeads('Minimal')).toBe(4);
    });

    it('should default unknown priorities to P2', () => {
      expect(mapHulyPriorityToBeads('Unknown')).toBe(2);
      expect(mapHulyPriorityToBeads('Random')).toBe(2);
    });
  });

  describe('mapBeadsPriorityToHuly', () => {
    it('should map P0 to Urgent', () => {
      expect(mapBeadsPriorityToHuly(0)).toBe('Urgent');
    });

    it('should map P1 to High', () => {
      expect(mapBeadsPriorityToHuly(1)).toBe('High');
    });

    it('should map P2 to Medium', () => {
      expect(mapBeadsPriorityToHuly(2)).toBe('Medium');
    });

    it('should map P3 to Low', () => {
      expect(mapBeadsPriorityToHuly(3)).toBe('Low');
    });

    it('should map P4 to NoPriority', () => {
      expect(mapBeadsPriorityToHuly(4)).toBe('NoPriority');
    });

    it('should default unknown priorities to Medium', () => {
      expect(mapBeadsPriorityToHuly(5)).toBe('Medium');
      expect(mapBeadsPriorityToHuly(-1)).toBe('Medium');
      expect(mapBeadsPriorityToHuly(null)).toBe('Medium');
      expect(mapBeadsPriorityToHuly(undefined)).toBe('Medium');
    });
  });

  describe('mapHulyTypeToBeads', () => {
    it('should map null/undefined to task', () => {
      expect(mapHulyTypeToBeads(null)).toBe('task');
      expect(mapHulyTypeToBeads(undefined)).toBe('task');
      expect(mapHulyTypeToBeads('')).toBe('task');
    });

    it('should map Bug/Defect to bug', () => {
      expect(mapHulyTypeToBeads('Bug')).toBe('bug');
      expect(mapHulyTypeToBeads('bug')).toBe('bug');
      expect(mapHulyTypeToBeads('Defect')).toBe('bug');
      expect(mapHulyTypeToBeads('defect')).toBe('bug');
    });

    it('should map Feature/Enhancement to feature', () => {
      expect(mapHulyTypeToBeads('Feature')).toBe('feature');
      expect(mapHulyTypeToBeads('feature')).toBe('feature');
      expect(mapHulyTypeToBeads('Enhancement')).toBe('feature');
      expect(mapHulyTypeToBeads('enhancement')).toBe('feature');
    });

    it('should map Epic/Initiative to epic', () => {
      expect(mapHulyTypeToBeads('Epic')).toBe('epic');
      expect(mapHulyTypeToBeads('epic')).toBe('epic');
      expect(mapHulyTypeToBeads('Initiative')).toBe('epic');
    });

    it('should map Chore/Maintenance to chore', () => {
      expect(mapHulyTypeToBeads('Chore')).toBe('chore');
      expect(mapHulyTypeToBeads('chore')).toBe('chore');
      expect(mapHulyTypeToBeads('Maintenance')).toBe('chore');
    });

    it('should default unknown types to task', () => {
      expect(mapHulyTypeToBeads('Task')).toBe('task');
      expect(mapHulyTypeToBeads('Story')).toBe('task');
      expect(mapHulyTypeToBeads('Unknown')).toBe('task');
    });
  });

  describe('mapBeadsTypeToHuly', () => {
    it('should map task to Task', () => {
      expect(mapBeadsTypeToHuly('task')).toBe('Task');
    });

    it('should map bug to Bug', () => {
      expect(mapBeadsTypeToHuly('bug')).toBe('Bug');
    });

    it('should map feature to Feature', () => {
      expect(mapBeadsTypeToHuly('feature')).toBe('Feature');
    });

    it('should map epic to Epic', () => {
      expect(mapBeadsTypeToHuly('epic')).toBe('Epic');
    });

    it('should map chore to Chore', () => {
      expect(mapBeadsTypeToHuly('chore')).toBe('Chore');
    });

    it('should default unknown types to Task', () => {
      expect(mapBeadsTypeToHuly('unknown')).toBe('Task');
      expect(mapBeadsTypeToHuly('')).toBe('Task');
      expect(mapBeadsTypeToHuly(null)).toBe('Task');
    });
  });

  describe('Beads bidirectional mapping consistency', () => {
    it('should use native Beads statuses with labels for disambiguation', () => {
      // Backlog -> open (no label)
      expect(mapHulyStatusToBeads('Backlog')).toEqual({ status: 'open', label: null });
      // Todo -> open + huly:Todo label
      expect(mapHulyStatusToBeads('Todo')).toEqual({ status: 'open', label: 'huly:Todo' });
      // In Progress -> in_progress (no label)
      expect(mapHulyStatusToBeads('In Progress')).toEqual({ status: 'in_progress', label: null });
      // In Review -> in_progress + huly:In Review label
      expect(mapHulyStatusToBeads('In Review')).toEqual({ status: 'in_progress', label: 'huly:In Review' });
    });

    it('should preserve status round-trip with labels', () => {
      // Done -> closed -> Done (preserved)
      const doneResult = mapHulyStatusToBeads('Done');
      expect(mapBeadsStatusToHuly(doneResult.status, doneResult.label ? [doneResult.label] : [])).toBe('Done');

      // Cancelled -> closed + huly:Canceled -> Canceled (NOW preserved with labels!)
      const cancelledResult = mapHulyStatusToBeads('Cancelled');
      expect(mapBeadsStatusToHuly(cancelledResult.status, cancelledResult.label ? [cancelledResult.label] : [])).toBe('Canceled');

      // In Review -> in_progress + huly:In Review -> In Review (preserved!)
      const reviewResult = mapHulyStatusToBeads('In Review');
      expect(mapBeadsStatusToHuly(reviewResult.status, reviewResult.label ? [reviewResult.label] : [])).toBe('In Review');

      // Todo -> open + huly:Todo -> Todo (preserved!)
      const todoResult = mapHulyStatusToBeads('Todo');
      expect(mapBeadsStatusToHuly(todoResult.status, todoResult.label ? [todoResult.label] : [])).toBe('Todo');
    });

    it('should preserve priority round-trip', () => {
      // Priority is preserved for all levels
      expect(mapBeadsPriorityToHuly(mapHulyPriorityToBeads('Urgent'))).toBe('Urgent');
      expect(mapBeadsPriorityToHuly(mapHulyPriorityToBeads('High'))).toBe('High');
      expect(mapBeadsPriorityToHuly(mapHulyPriorityToBeads('Medium'))).toBe('Medium');
      expect(mapBeadsPriorityToHuly(mapHulyPriorityToBeads('Low'))).toBe('Low');
      expect(mapBeadsPriorityToHuly(mapHulyPriorityToBeads('NoPriority'))).toBe('NoPriority');
    });

    it('should preserve type round-trip for known types', () => {
      expect(mapBeadsTypeToHuly(mapHulyTypeToBeads('Bug'))).toBe('Bug');
      expect(mapBeadsTypeToHuly(mapHulyTypeToBeads('Feature'))).toBe('Feature');
      expect(mapBeadsTypeToHuly(mapHulyTypeToBeads('Epic'))).toBe('Epic');
      expect(mapBeadsTypeToHuly(mapHulyTypeToBeads('Chore'))).toBe('Chore');
    });
  });

  describe('Beads edge cases', () => {
    it('should handle status with extra whitespace', () => {
      expect(mapHulyStatusToBeads('  Done  ').status).toBe('closed');
      expect(mapHulyStatusToBeads('  In Progress  ').status).toBe('in_progress');
    });

    it('should handle priority strings with extra text', () => {
      expect(mapHulyPriorityToBeads('High Priority')).toBe(1);
      expect(mapHulyPriorityToBeads('Very Urgent')).toBe(0);
    });

    it('should handle type strings with partial matches', () => {
      expect(mapHulyTypeToBeads('Bug Report')).toBe('bug');
      expect(mapHulyTypeToBeads('Feature Request')).toBe('feature');
    });
  });
});
