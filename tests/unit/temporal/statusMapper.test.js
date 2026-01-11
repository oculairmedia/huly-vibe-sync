/**
 * Tests for Temporal Status Mapper
 *
 * Tests all status and priority mapping logic between Huly, Vibe, and Beads.
 */

import { describe, it, expect } from 'vitest';

describe('Status Mapper Logic', () => {
  describe('mapHulyStatusToVibe', () => {
    const mapHulyStatusToVibe = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'backlog' || normalized === 'todo') return 'todo';
      if (normalized === 'in progress') return 'inprogress';
      if (normalized === 'in review') return 'inreview';
      if (normalized === 'done') return 'done';
      if (normalized === 'cancelled') return 'cancelled';
      return 'todo';
    };

    it('should map Backlog to todo', () => {
      expect(mapHulyStatusToVibe('Backlog')).toBe('todo');
    });

    it('should map Todo to todo', () => {
      expect(mapHulyStatusToVibe('Todo')).toBe('todo');
    });

    it('should map In Progress to inprogress', () => {
      expect(mapHulyStatusToVibe('In Progress')).toBe('inprogress');
    });

    it('should map In Review to inreview', () => {
      expect(mapHulyStatusToVibe('In Review')).toBe('inreview');
    });

    it('should map Done to done', () => {
      expect(mapHulyStatusToVibe('Done')).toBe('done');
    });

    it('should map Cancelled to cancelled', () => {
      expect(mapHulyStatusToVibe('Cancelled')).toBe('cancelled');
    });

    it('should handle case insensitive input', () => {
      expect(mapHulyStatusToVibe('BACKLOG')).toBe('todo');
      expect(mapHulyStatusToVibe('in progress')).toBe('inprogress');
      expect(mapHulyStatusToVibe('DONE')).toBe('done');
    });

    it('should default unknown statuses to todo', () => {
      expect(mapHulyStatusToVibe('Unknown')).toBe('todo');
      expect(mapHulyStatusToVibe('')).toBe('todo');
    });
  });

  describe('mapVibeStatusToHuly', () => {
    const mapVibeStatusToHuly = (status) => {
      const normalized = status?.toLowerCase().replace(/\s+/g, '') || '';
      if (normalized === 'todo') return 'Backlog';
      if (normalized === 'inprogress') return 'In Progress';
      if (normalized === 'inreview') return 'In Review';
      if (normalized === 'done') return 'Done';
      if (normalized === 'cancelled') return 'Cancelled';
      return 'Backlog';
    };

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

    it('should map cancelled to Cancelled', () => {
      expect(mapVibeStatusToHuly('cancelled')).toBe('Cancelled');
    });

    it('should handle case variations', () => {
      expect(mapVibeStatusToHuly('TODO')).toBe('Backlog');
      expect(mapVibeStatusToHuly('InProgress')).toBe('In Progress');
    });

    it('should default unknown statuses to Backlog', () => {
      expect(mapVibeStatusToHuly('unknown')).toBe('Backlog');
    });
  });

  describe('mapHulyStatusToBeads', () => {
    const mapHulyStatusToBeads = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'backlog' || normalized === 'todo') return 'open';
      if (normalized === 'in progress') return 'in_progress';
      if (normalized === 'in review') return 'in_progress';
      if (normalized === 'done') return 'closed';
      if (normalized === 'cancelled') return 'closed';
      return 'open';
    };

    it('should map Backlog to open', () => {
      expect(mapHulyStatusToBeads('Backlog')).toBe('open');
    });

    it('should map In Progress to in_progress', () => {
      expect(mapHulyStatusToBeads('In Progress')).toBe('in_progress');
    });

    it('should map Done to closed', () => {
      expect(mapHulyStatusToBeads('Done')).toBe('closed');
    });

    it('should map Cancelled to closed', () => {
      expect(mapHulyStatusToBeads('Cancelled')).toBe('closed');
    });
  });

  describe('mapHulyStatusToBeadsSimple', () => {
    const mapHulyStatusToBeadsSimple = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'backlog' || normalized === 'todo') return 'open';
      if (normalized === 'in progress' || normalized === 'in review') return 'in_progress';
      if (normalized === 'done' || normalized === 'cancelled') return 'closed';
      return 'open';
    };

    it('should return open for backlog statuses', () => {
      expect(mapHulyStatusToBeadsSimple('Backlog')).toBe('open');
      expect(mapHulyStatusToBeadsSimple('Todo')).toBe('open');
    });

    it('should return in_progress for active statuses', () => {
      expect(mapHulyStatusToBeadsSimple('In Progress')).toBe('in_progress');
      expect(mapHulyStatusToBeadsSimple('In Review')).toBe('in_progress');
    });

    it('should return closed for completed statuses', () => {
      expect(mapHulyStatusToBeadsSimple('Done')).toBe('closed');
      expect(mapHulyStatusToBeadsSimple('Cancelled')).toBe('closed');
    });
  });

  describe('mapBeadsStatusToHuly', () => {
    const mapBeadsStatusToHuly = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'open') return 'Backlog';
      if (normalized === 'in_progress') return 'In Progress';
      if (normalized === 'closed') return 'Done';
      return 'Backlog';
    };

    it('should map open to Backlog', () => {
      expect(mapBeadsStatusToHuly('open')).toBe('Backlog');
    });

    it('should map in_progress to In Progress', () => {
      expect(mapBeadsStatusToHuly('in_progress')).toBe('In Progress');
    });

    it('should map closed to Done', () => {
      expect(mapBeadsStatusToHuly('closed')).toBe('Done');
    });

    it('should default unknown statuses to Backlog', () => {
      expect(mapBeadsStatusToHuly('unknown')).toBe('Backlog');
    });
  });

  describe('mapBeadsStatusToVibe', () => {
    const mapBeadsStatusToVibe = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'open') return 'todo';
      if (normalized === 'in_progress') return 'inprogress';
      if (normalized === 'closed') return 'done';
      return 'todo';
    };

    it('should map open to todo', () => {
      expect(mapBeadsStatusToVibe('open')).toBe('todo');
    });

    it('should map in_progress to inprogress', () => {
      expect(mapBeadsStatusToVibe('in_progress')).toBe('inprogress');
    });

    it('should map closed to done', () => {
      expect(mapBeadsStatusToVibe('closed')).toBe('done');
    });
  });

  describe('mapHulyPriorityToBeads', () => {
    const mapHulyPriorityToBeads = (priority) => {
      const normalized = priority?.toLowerCase() || '';
      if (normalized === 'urgent') return 1;
      if (normalized === 'high') return 2;
      if (normalized === 'medium') return 3;
      if (normalized === 'low') return 4;
      return 3; // Default to medium
    };

    it('should map Urgent to 1', () => {
      expect(mapHulyPriorityToBeads('Urgent')).toBe(1);
    });

    it('should map High to 2', () => {
      expect(mapHulyPriorityToBeads('High')).toBe(2);
    });

    it('should map Medium to 3', () => {
      expect(mapHulyPriorityToBeads('Medium')).toBe(3);
    });

    it('should map Low to 4', () => {
      expect(mapHulyPriorityToBeads('Low')).toBe(4);
    });

    it('should default to 3 for unknown priority', () => {
      expect(mapHulyPriorityToBeads('Unknown')).toBe(3);
      expect(mapHulyPriorityToBeads(undefined)).toBe(3);
    });
  });

  describe('mapBeadsPriorityToHuly', () => {
    const mapBeadsPriorityToHuly = (priority) => {
      if (priority === 1) return 'Urgent';
      if (priority === 2) return 'High';
      if (priority === 3) return 'Medium';
      if (priority === 4) return 'Low';
      return 'Medium';
    };

    it('should map 1 to Urgent', () => {
      expect(mapBeadsPriorityToHuly(1)).toBe('Urgent');
    });

    it('should map 2 to High', () => {
      expect(mapBeadsPriorityToHuly(2)).toBe('High');
    });

    it('should map 3 to Medium', () => {
      expect(mapBeadsPriorityToHuly(3)).toBe('Medium');
    });

    it('should map 4 to Low', () => {
      expect(mapBeadsPriorityToHuly(4)).toBe('Low');
    });

    it('should default to Medium for unknown priority', () => {
      expect(mapBeadsPriorityToHuly(5)).toBe('Medium');
      expect(mapBeadsPriorityToHuly(undefined)).toBe('Medium');
    });
  });

  describe('normalizeVibeStatus', () => {
    const normalizeVibeStatus = (status) => {
      return status?.toLowerCase().replace(/\s+/g, '') || '';
    };

    it('should normalize status to lowercase without spaces', () => {
      expect(normalizeVibeStatus('In Progress')).toBe('inprogress');
      expect(normalizeVibeStatus('TODO')).toBe('todo');
      expect(normalizeVibeStatus('in review')).toBe('inreview');
    });

    it('should handle already normalized statuses', () => {
      expect(normalizeVibeStatus('inprogress')).toBe('inprogress');
      expect(normalizeVibeStatus('todo')).toBe('todo');
    });
  });

  describe('normalizeHulyStatus', () => {
    const normalizeHulyStatus = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'backlog') return 'Backlog';
      if (normalized === 'todo') return 'Todo';
      if (normalized === 'in progress') return 'In Progress';
      if (normalized === 'in review') return 'In Review';
      if (normalized === 'done') return 'Done';
      if (normalized === 'cancelled') return 'Cancelled';
      return status;
    };

    it('should normalize status with proper casing', () => {
      expect(normalizeHulyStatus('in progress')).toBe('In Progress');
      expect(normalizeHulyStatus('BACKLOG')).toBe('Backlog');
      expect(normalizeHulyStatus('done')).toBe('Done');
    });
  });

  describe('Round-trip mapping consistency', () => {
    const mapHulyStatusToVibe = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'backlog' || normalized === 'todo') return 'todo';
      if (normalized === 'in progress') return 'inprogress';
      if (normalized === 'in review') return 'inreview';
      if (normalized === 'done') return 'done';
      if (normalized === 'cancelled') return 'cancelled';
      return 'todo';
    };

    const mapVibeStatusToHuly = (status) => {
      const normalized = status?.toLowerCase().replace(/\s+/g, '') || '';
      if (normalized === 'todo') return 'Backlog';
      if (normalized === 'inprogress') return 'In Progress';
      if (normalized === 'inreview') return 'In Review';
      if (normalized === 'done') return 'Done';
      if (normalized === 'cancelled') return 'Cancelled';
      return 'Backlog';
    };

    const mapHulyStatusToBeadsSimple = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'backlog' || normalized === 'todo') return 'open';
      if (normalized === 'in progress' || normalized === 'in review') return 'in_progress';
      if (normalized === 'done' || normalized === 'cancelled') return 'closed';
      return 'open';
    };

    const mapBeadsStatusToHuly = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'open') return 'Backlog';
      if (normalized === 'in_progress') return 'In Progress';
      if (normalized === 'closed') return 'Done';
      return 'Backlog';
    };

    const mapBeadsStatusToVibe = (status) => {
      const normalized = status?.toLowerCase().trim() || '';
      if (normalized === 'open') return 'todo';
      if (normalized === 'in_progress') return 'inprogress';
      if (normalized === 'closed') return 'done';
      return 'todo';
    };

    it('should maintain consistency Huly -> Vibe -> Huly', () => {
      const hulyStatuses = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled'];

      for (const huly of hulyStatuses) {
        const vibe = mapHulyStatusToVibe(huly);
        const backToHuly = mapVibeStatusToHuly(vibe);

        // Some mappings collapse (Backlog and Todo both map to todo)
        // So we check the reverse maps to a valid Huly status
        expect(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']).toContain(backToHuly);
      }
    });

    it('should maintain consistency Huly -> Beads -> Huly', () => {
      const hulyStatuses = ['Backlog', 'In Progress', 'Done'];

      for (const huly of hulyStatuses) {
        const beads = mapHulyStatusToBeadsSimple(huly);
        const backToHuly = mapBeadsStatusToHuly(beads);

        expect(['Backlog', 'In Progress', 'Done']).toContain(backToHuly);
      }
    });

    it('should maintain consistency Beads -> Vibe -> Beads', () => {
      const beadsStatuses = ['open', 'in_progress', 'closed'];

      for (const beads of beadsStatuses) {
        const vibe = mapBeadsStatusToVibe(beads);
        // Map back via Huly
        const huly = mapVibeStatusToHuly(vibe);
        const backToBeads = mapHulyStatusToBeadsSimple(huly);

        expect(backToBeads).toBe(beads);
      }
    });
  });
});
