import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('OpenAPI Spec Generation', () => {
  let specPath: string;
  let spec: any;

  beforeAll(() => {
    specPath = path.join(process.cwd(), 'dist', 'openapi.json');
    expect(fs.existsSync(specPath)).toBe(true);
    spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  });

  it('should generate a valid OpenAPI 3.1.0 spec', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('should have required info fields', () => {
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe('Vibesync API');
    expect(spec.info.version).toBe('1.0.0');
  });

  it('should have all required paths', () => {
    const requiredPaths = [
      '/health',
      '/metrics',
      '/api/stats',
      '/api/projects',
      '/api/projects/{id}',
      '/api/issues/{id}',
      '/api/issues/{id}/claim',
      '/api/issues/{id}/unclaim',
      '/api/issues/{id}/status',
      '/api/issues/{id}/notes',
      '/api/issues/{id}/close',
      '/api/issues/{id}/reopen',
    ];

    for (const pathName of requiredPaths) {
      expect(spec.paths[pathName]).toBeDefined();
    }
  });

  it('should have all required schemas', () => {
    const requiredSchemas = [
      'HealthMetrics',
      'StatsResponse',
      'ProjectSummary',
      'ProjectDetail',
      'IssueSummary',
      'IssueDetail',
      'ErrorResponse',
      'ConflictResponse',
    ];

    for (const schemaName of requiredSchemas) {
      expect(spec.components.schemas[schemaName]).toBeDefined();
    }
  });

  it('should have at least 22 paths', () => {
    const pathCount = Object.keys(spec.paths).length;
    expect(pathCount).toBeGreaterThanOrEqual(22);
  });

  it('should have at least 18 schemas', () => {
    const schemaCount = Object.keys(spec.components.schemas).length;
    expect(schemaCount).toBeGreaterThanOrEqual(18);
  });

  it('should have valid response schemas', () => {
    const healthPath = spec.paths['/health'];
    expect(healthPath.get).toBeDefined();
    expect(healthPath.get.responses['200']).toBeDefined();
    expect(healthPath.get.responses['200'].content['application/json']).toBeDefined();
  });

  it('should have proper parameter definitions', () => {
    const projectPath = spec.paths['/api/projects/{id}'];
    expect(projectPath.get).toBeDefined();
    expect(projectPath.get.parameters).toBeDefined();
    const idParam = projectPath.get.parameters.find((p: any) => p.name === 'id');
    expect(idParam).toBeDefined();
    expect(idParam.in).toBe('path');
    expect(idParam.required).toBe(true);
  });
});
