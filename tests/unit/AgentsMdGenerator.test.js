import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentsMdGenerator,
  markers,
  SECTION_ORDER,
  interpolate,
} from '../../lib/AgentsMdGenerator.js';
import fs from 'fs';

vi.mock('fs');

const mockedFs = vi.mocked(fs);
const pathText = value => String(value);

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
  'bookstack-docs': '## BookStack Documentation\n\nDocs at BookStack.',
  'session-completion': '## Landing the Plane\n\nPush before ending.',
  'codebase-context': '## Codebase Context\n\nProject: {{identifier}}',
  'custom-rules': '## Custom Rules\n\nFollow project conventions.',
};

function setupTemplateMocks() {
  mockedFs.existsSync.mockImplementation(p => {
    const path = pathText(p);
    if (path.includes('templates/agents-md/')) {
      const filename = path.split('/').pop().replace('.md', '');
      return filename in MOCK_TEMPLATES;
    }
    return false;
  });
  mockedFs.readFileSync.mockImplementation(p => {
    const path = pathText(p);
    if (path.includes('templates/agents-md/')) {
      const filename = path.split('/').pop().replace('.md', '');
      return MOCK_TEMPLATES[filename] || '';
    }
    return '';
  });
  mockedFs.writeFileSync.mockImplementation(() => {});
  mockedFs.mkdirSync.mockImplementation(() => '/tmp');
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
      mockedFs.existsSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return false;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
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
      const bookstackIdx = content.indexOf('<!-- VIBESYNC:bookstack-docs:START -->');
      const sessionIdx = content.indexOf('<!-- VIBESYNC:session-completion:START -->');
      expect(projectIdx).toBeLessThan(bookstackIdx);
      expect(bookstackIdx).toBeLessThan(sessionIdx);

      expect(changes.every(c => c.action === 'inserted')).toBe(true);
    });

    it('should interpolate variables in templates', () => {
      mockedFs.existsSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return false;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
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

      mockedFs.existsSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return true;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      mockedFs.readFileSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return existing;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
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
        '<!-- VIBESYNC:bookstack-docs:START -->',
        '## Old BookStack',
        '<!-- VIBESYNC:bookstack-docs:END -->',
      ].join('\n');

      mockedFs.existsSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return true;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      mockedFs.readFileSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return existing;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
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

      mockedFs.existsSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return true;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      mockedFs.readFileSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return existing;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'GRAPH' },
        { dryRun: true, sections: ['bookstack-docs'] }
      );

      const customMarkerIdx = content.indexOf('<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->');
      const customContentIdx = content.indexOf('Custom content line 3.');
      const bookstackStartIdx = content.indexOf('<!-- VIBESYNC:bookstack-docs:START -->');

      expect(customMarkerIdx).toBeGreaterThan(-1);
      expect(customContentIdx).toBeGreaterThan(-1);
      expect(bookstackStartIdx).toBeGreaterThan(-1);

      expect(customContentIdx).toBeGreaterThan(customMarkerIdx);
      expect(bookstackStartIdx).toBeGreaterThan(customContentIdx);
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

      mockedFs.existsSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return true;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      mockedFs.readFileSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return existing;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'GRAPH' },
        { dryRun: true, sections: ['bookstack-docs'] }
      );

      const customContentIdx = content.indexOf('End of custom content.');
      const bookstackIdx = content.indexOf('<!-- VIBESYNC:bookstack-docs:START -->');

      expect(bookstackIdx).toBeGreaterThan(customContentIdx);
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

      mockedFs.existsSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return true;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return filename in MOCK_TEMPLATES;
        }
        return false;
      });
      mockedFs.readFileSync.mockImplementation(p => {
        const path = pathText(p);
        if (path.endsWith('AGENTS.md')) return existing;
        if (path.includes('templates/agents-md/')) {
          const filename = path.split('/').pop().replace('.md', '');
          return MOCK_TEMPLATES[filename] || '';
        }
        return '';
      });

      const { content } = generator.generate(
        '/tmp/AGENTS.md',
        { identifier: 'GRAPH' },
        { dryRun: true, sections: ['bookstack-docs', 'session-completion'] }
      );

      const preservedIdx = content.indexOf('Preserved content here.');
      const bookstackIdx = content.indexOf('<!-- VIBESYNC:bookstack-docs:START -->');
      const sessionIdx = content.indexOf('<!-- VIBESYNC:session-completion:START -->');

      expect(bookstackIdx).toBeGreaterThan(preservedIdx);
      expect(sessionIdx).toBeGreaterThan(bookstackIdx);
    });
  });

  describe('hasSection', () => {
    it('should detect managed section', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        '<!-- VIBESYNC:project-info:START -->\ncontent\n<!-- VIBESYNC:project-info:END -->'
      );

      const result = generator.hasSection('/tmp/AGENTS.md', 'project-info');
      expect(result).toEqual({ exists: true, custom: false });
    });

    it('should detect CUSTOM section', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        '<!-- VIBESYNC:reporting-hierarchy:CUSTOM -->\ncustom content'
      );

      const result = generator.hasSection('/tmp/AGENTS.md', 'reporting-hierarchy');
      expect(result).toEqual({ exists: true, custom: true });
    });

    it('should return not found for missing section', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('no markers here');

      const result = generator.hasSection('/tmp/AGENTS.md', 'project-info');
      expect(result).toEqual({ exists: false });
    });

    it('should handle missing file', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = generator.hasSection('/tmp/missing.md', 'project-info');
      expect(result).toEqual({ exists: false });
    });
  });

  describe('inspect', () => {
    it('should report status of all sections', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
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
      expect(result['bookstack-docs']).toEqual({ exists: false });
    });
  });
});
