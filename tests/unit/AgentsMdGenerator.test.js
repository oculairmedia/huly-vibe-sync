import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentsMdGenerator,
  markers,
  SECTION_ORDER,
  interpolate,
} from '../../lib/AgentsMdGenerator.js';
import fs from 'fs';

vi.mock('fs');

vi.mock('../../lib/logger.js', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

const MOCK_TEMPLATES = {
  'project-info': '# Agent Instructions\n\n- **Project Code**: `{{identifier}}`',
  'reporting-hierarchy': '## PM Agent Communication\n\nReport to PM agent.',
  'beads-instructions': '## Beads Issue Tracking\n\nUse **bd** for issue tracking.',
  'bookstack-docs': '## BookStack Documentation\n\nDocs at BookStack.',
  'session-completion': '## Landing the Plane\n\nPush before ending.',
  'codebase-context': '## Codebase Context\n\nProject: {{identifier}}',
  'custom-rules': '## Custom Rules\n\nFollow project conventions.',
};

function setupTemplateMocks() {
  fs.existsSync.mockImplementation(p => {
    if (p.includes('templates/agents-md/')) {
      const filename = p.split('/').pop().replace('.md', '');
      return filename in MOCK_TEMPLATES;
    }
    return false;
  });
  fs.readFileSync.mockImplementation(p => {
    if (p.includes('templates/agents-md/')) {
      const filename = p.split('/').pop().replace('.md', '');
      return MOCK_TEMPLATES[filename] || '';
    }
    return '';
  });
  fs.writeFileSync.mockImplementation(() => {});
  fs.mkdirSync.mockImplementation(() => {});
}

describe('AgentsMdGenerator', () => {
  let generator;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new AgentsMdGenerator();
    setupTemplateMocks();
  });

  describe('markers', () => {
    it('should produce correct start/end/custom markers', () => {
      const m = markers('project-info');
      expect(m.start).toBe('<!-- VIBESYNC:project-info:START -->');
      expect(m.end).toBe('<!-- VIBESYNC:project-info:END -->');
      expect(m.custom).toBe('<!-- VIBESYNC:project-info:CUSTOM -->');
    });
  });

  describe('interpolate', () => {
    it('should replace template variables', () => {
      const result = interpolate('Hello {{name}}, code: {{identifier}}', {
        name: 'Test Project',
        identifier: 'TEST',
      });
      expect(result).toBe('Hello Test Project, code: TEST');
    });

    it('should preserve unknown variables', () => {
      const result = interpolate('{{known}} and {{unknown}}', { known: 'yes' });
      expect(result).toBe('yes and {{unknown}}');
    });

    it('should handle null/undefined vars', () => {
      expect(interpolate('test', null)).toBe('test');
      expect(interpolate(null, {})).toBeNull();
    });
  });

  describe('generate - fresh file', () => {
    it('should generate all sections in order for new file', () => {
      fs.existsSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return false;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });

      const { content, changes } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'TEST' },
        { dryRun: true }
      );

      for (const sectionId of SECTION_ORDER) {
        const m = markers(sectionId);
        expect(content).toContain(m.start);
        expect(content).toContain(m.end);
      }

      const projectIdx = content.indexOf('<!-- VIBESYNC:project-info:START -->');
      const beadsIdx = content.indexOf('<!-- VIBESYNC:beads-instructions:START -->');
      const sessionIdx = content.indexOf('<!-- VIBESYNC:session-completion:START -->');
      expect(projectIdx).toBeLessThan(beadsIdx);
      expect(beadsIdx).toBeLessThan(sessionIdx);

      expect(changes.every(c => c.action === 'inserted')).toBe(true);
    });

    it('should interpolate variables in templates', () => {
      fs.existsSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return false;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });

      const { content } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'MYPROJ' },
        { dryRun: true }
      );

      expect(content).toContain('`MYPROJ`');
      expect(content).not.toContain('{{identifier}}');
    });
  });

  describe('generate - update existing sections', () => {
    it('should update existing managed sections', () => {
      const existing = [
        '<!-- VIBESYNC:project-info:START -->',
        '# Old Content',
        '<!-- VIBESYNC:project-info:END -->',
      ].join('\n');

      fs.existsSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return true;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      fs.readFileSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return existing;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content, changes } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'UPD' },
        { dryRun: true }
      );

      expect(content).toContain('`UPD`');
      expect(content).not.toContain('# Old Content');

      const piChange = changes.find(c => c.section === 'project-info');
      expect(piChange.action).toBe('updated');
    });
  });

  describe('generate - CUSTOM marker preservation (HVSYN-911)', () => {
    it('should skip CUSTOM sections and never overwrite their content', () => {
      const existing = [
        '<!-- VIBESYNC:project-info:START -->',
        '# Project Info',
        '<!-- VIBESYNC:project-info:END -->',
        '',
        '<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->',
        '',
        '## Custom PM Workflow',
        '',
        'This is custom content that must be preserved.',
        '',
        '<!-- VIBESYNC:beads-instructions:START -->',
        '## Old Beads',
        '<!-- VIBESYNC:beads-instructions:END -->',
      ].join('\n');

      fs.existsSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return true;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      fs.readFileSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return existing;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content, changes } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'GRAPH' },
        { dryRun: true }
      );

      expect(content).toContain('<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->');
      expect(content).toContain('This is custom content that must be preserved.');

      const rhChange = changes.find(c => c.section === 'reporting-hierarchy');
      expect(rhChange.action).toBe('skipped');
      expect(rhChange.reason).toBe('CUSTOM marker');
    });

    it('should insert new sections AFTER custom content, not between marker and body', () => {
      const existing = [
        '<!-- VIBESYNC:project-info:START -->',
        '# Project Info',
        '<!-- VIBESYNC:project-info:END -->',
        '',
        '<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->',
        '',
        '## Custom Developer-PM Workflow',
        '',
        'Custom content line 1.',
        'Custom content line 2.',
        'Custom content line 3.',
      ].join('\n');

      fs.existsSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return true;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      fs.readFileSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return existing;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'GRAPH' },
        { dryRun: true, sections: ['beads-instructions'] }
      );

      const customMarkerIdx = content.indexOf('<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->');
      const customContentIdx = content.indexOf('Custom content line 3.');
      const beadsStartIdx = content.indexOf('<!-- VIBESYNC:beads-instructions:START -->');

      expect(customMarkerIdx).toBeGreaterThan(-1);
      expect(customContentIdx).toBeGreaterThan(-1);
      expect(beadsStartIdx).toBeGreaterThan(-1);

      expect(customContentIdx).toBeGreaterThan(customMarkerIdx);
      expect(beadsStartIdx).toBeGreaterThan(customContentIdx);
    });

    it('should handle CUSTOM section at end of file with no trailing sections', () => {
      const existing = [
        '<!-- VIBESYNC:project-info:START -->',
        '# Project Info',
        '<!-- VIBESYNC:project-info:END -->',
        '',
        '<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->',
        '',
        '## Custom Workflow',
        '',
        'End of custom content.',
      ].join('\n');

      fs.existsSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return true;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      fs.readFileSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return existing;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'GRAPH' },
        { dryRun: true, sections: ['beads-instructions'] }
      );

      const customContentIdx = content.indexOf('End of custom content.');
      const beadsIdx = content.indexOf('<!-- VIBESYNC:beads-instructions:START -->');

      expect(beadsIdx).toBeGreaterThan(customContentIdx);
    });

    it('should preserve CUSTOM content when inserting multiple sections after it', () => {
      const existing = [
        '<!-- VIBESYNC:project-info:START -->',
        '# Project Info',
        '<!-- VIBESYNC:project-info:END -->',
        '',
        '<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->',
        '',
        '## Custom Workflow',
        '',
        'Preserved content here.',
      ].join('\n');

      fs.existsSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return true;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      fs.readFileSync.mockImplementation(p => {
        if (p.endsWith('AGENTS.md')) return existing;
        if (p.includes('templates/agents-md/')) {
          const filename = p.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'GRAPH' },
        { dryRun: true, sections: ['beads-instructions', 'session-completion'] }
      );

      const preservedIdx = content.indexOf('Preserved content here.');
      const beadsIdx = content.indexOf('<!-- VIBESYNC:beads-instructions:START -->');
      const sessionIdx = content.indexOf('<!-- VIBESYNC:session-completion:START -->');

      expect(beadsIdx).toBeGreaterThan(preservedIdx);
      expect(sessionIdx).toBeGreaterThan(beadsIdx);
    });
  });

  describe('hasSection', () => {
    it('should detect managed section', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        '<!-- VIBESYNC:project-info:START -->\ncontent\n<!-- VIBESYNC:project-info:END -->'
      );

      const result = generator.hasSection('/tmp/AGENTS.md', 'project-info');
      expect(result).toEqual({ exists: true, custom: false });
    });

    it('should detect CUSTOM section', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        '<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->\ncustom content'
      );

      const result = generator.hasSection('/tmp/AGENTS.md', 'reporting-hierarchy');
      expect(result).toEqual({ exists: true, custom: true });
    });

    it('should return not found for missing section', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('no markers here');

      const result = generator.hasSection('/tmp/AGENTS.md', 'project-info');
      expect(result).toEqual({ exists: false });
    });

    it('should handle missing file', () => {
      fs.existsSync.mockReturnValue(false);

      const result = generator.hasSection('/tmp/missing.md', 'project-info');
      expect(result).toEqual({ exists: false });
    });
  });

  describe('inspect', () => {
    it('should report status of all sections', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        [
          '<!-- VIBESYNC:project-info:START -->',
          'content',
          '<!-- VIBESYNC:project-info:END -->',
          '<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->',
          'custom stuff',
        ].join('\n')
      );

      const result = generator.inspect('/tmp/AGENTS.md');

      expect(result['project-info']).toEqual({ exists: true, custom: false });
      expect(result['reporting-hierarchy']).toEqual({ exists: true, custom: true });
      expect(result['beads-instructions']).toEqual({ exists: false });
    });
  });
});
