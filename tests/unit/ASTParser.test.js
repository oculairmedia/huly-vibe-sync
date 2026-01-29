import { describe, it, expect, beforeAll } from 'vitest';
import { parseFile, parseFiles, isSupported, isAvailable } from '../../lib/ASTParser.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('ASTParser', () => {
  let tempDir;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-parser-test-'));
  });

  describe('isAvailable', () => {
    it('returns true when tree-sitter is installed', async () => {
      const available = await isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('isSupported', () => {
    it('returns true for Python files', () => {
      expect(isSupported('test.py')).toBe(true);
      expect(isSupported('test.pyw')).toBe(true);
    });

    it('returns true for JavaScript files', () => {
      expect(isSupported('test.js')).toBe(true);
      expect(isSupported('test.mjs')).toBe(true);
      expect(isSupported('test.cjs')).toBe(true);
      expect(isSupported('test.jsx')).toBe(true);
    });

    it('returns true for TypeScript files', () => {
      expect(isSupported('test.ts')).toBe(true);
      expect(isSupported('test.mts')).toBe(true);
      expect(isSupported('test.tsx')).toBe(true);
    });

    it('returns false for unsupported files', () => {
      expect(isSupported('test.txt')).toBe(false);
      expect(isSupported('test.md')).toBe(false);
      expect(isSupported('test.json')).toBe(false);
      expect(isSupported('test.yaml')).toBe(false);
    });
  });

  describe('parseFile - Python', () => {
    it('extracts function definitions from Python file', async () => {
      const testFile = path.join(tempDir, 'test.py');
      await fs.writeFile(
        testFile,
        `
def greet(name: str) -> str:
    """Say hello to someone."""
    return f"Hello, {name}!"

def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

async def fetch_data(url: str):
    """Fetch data from URL."""
    pass
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.language).toBe('python');
      expect(result.functions).toHaveLength(3);

      const greet = result.functions.find(f => f.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet.signature).toContain('def greet');
      expect(greet.signature).toContain('name: str');
      expect(greet.return_type).toBe('str');
      expect(greet.docstring).toBe('Say hello to someone.');

      const add = result.functions.find(f => f.name === 'add');
      expect(add).toBeDefined();
      expect(add.return_type).toBe('int');

      const fetchData = result.functions.find(f => f.name === 'fetch_data');
      expect(fetchData).toBeDefined();
      expect(fetchData.is_async).toBe(true);
    });

    it('skips private functions (starting with _)', async () => {
      const testFile = path.join(tempDir, 'private.py');
      await fs.writeFile(
        testFile,
        `
def public_func():
    pass

def _private_func():
    pass

def __dunder_func__():
    pass
`
      );

      const result = await parseFile(testFile);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe('public_func');
    });

    it('extracts decorators', async () => {
      const testFile = path.join(tempDir, 'decorated.py');
      await fs.writeFile(
        testFile,
        `
@staticmethod
def static_method():
    pass

@classmethod
@some_decorator
def class_method(cls):
    pass
`
      );

      const result = await parseFile(testFile);

      expect(result.functions).toHaveLength(2);

      const staticMethod = result.functions.find(f => f.name === 'static_method');
      expect(staticMethod.decorators).toContain('@staticmethod');
    });
  });

  describe('parseFile - JavaScript', () => {
    it('extracts function declarations from JavaScript file', async () => {
      const testFile = path.join(tempDir, 'test.js');
      await fs.writeFile(
        testFile,
        `
/**
 * Greet someone by name.
 * @param {string} name - The name
 * @returns {string} Greeting
 */
function greet(name) {
    return \`Hello, \${name}!\`;
}

async function fetchData(url) {
    return fetch(url);
}

export function exportedFunc() {
    return 42;
}
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.language).toBe('javascript');
      expect(result.functions.length).toBeGreaterThanOrEqual(2);

      const greet = result.functions.find(f => f.name === 'greet');
      expect(greet).toBeDefined();
      expect(greet.docstring).toContain('Greet someone by name');

      const fetchData = result.functions.find(f => f.name === 'fetchData');
      expect(fetchData).toBeDefined();
      expect(fetchData.is_async).toBe(true);
    });

    it('extracts arrow functions assigned to const', async () => {
      const testFile = path.join(tempDir, 'arrow.js');
      await fs.writeFile(
        testFile,
        `
const add = (a, b) => a + b;

const multiply = (a, b) => {
    return a * b;
};

const asyncFetch = async (url) => {
    return fetch(url);
};
`
      );

      const result = await parseFile(testFile);

      expect(result.functions.length).toBeGreaterThanOrEqual(2);

      const add = result.functions.find(f => f.name === 'add');
      expect(add).toBeDefined();

      const asyncFetch = result.functions.find(f => f.name === 'asyncFetch');
      expect(asyncFetch).toBeDefined();
      expect(asyncFetch.is_async).toBe(true);
    });
  });

  describe('parseFile - TypeScript', () => {
    it('extracts function definitions from TypeScript file', async () => {
      const testFile = path.join(tempDir, 'test.ts');
      await fs.writeFile(
        testFile,
        `
function greet(name: string): string {
    return \`Hello, \${name}!\`;
}

async function fetchData<T>(url: string): Promise<T> {
    const response = await fetch(url);
    return response.json();
}

export function exportedFunc(): number {
    return 42;
}
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.language).toBe('typescript');
      expect(result.functions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('parseFile - error handling', () => {
    it('returns error for non-existent file', async () => {
      const result = await parseFile('/non/existent/file.py');

      expect(result.error).toBeDefined();
      expect(result.functions).toHaveLength(0);
    });

    it('returns error for unsupported file type', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.writeFile(testFile, 'some text');

      const result = await parseFile(testFile);

      expect(result.error).toContain('Unsupported file type');
      expect(result.functions).toHaveLength(0);
    });
  });

  describe('parseFiles - batch mode', () => {
    it('parses multiple files in batch', async () => {
      const file1 = path.join(tempDir, 'batch1.py');
      const file2 = path.join(tempDir, 'batch2.js');

      await fs.writeFile(file1, 'def func1(): pass');
      await fs.writeFile(file2, 'function func2() {}');

      const results = await parseFiles([file1, file2]);

      expect(results).toHaveLength(2);
      expect(results[0].language).toBe('python');
      expect(results[1].language).toBe('javascript');
    });

    it('filters out unsupported files', async () => {
      const file1 = path.join(tempDir, 'batch3.py');
      const file2 = path.join(tempDir, 'batch3.txt');

      await fs.writeFile(file1, 'def func(): pass');
      await fs.writeFile(file2, 'some text');

      const results = await parseFiles([file1, file2]);

      expect(results).toHaveLength(1);
      expect(results[0].language).toBe('python');
    });

    it('returns empty array for empty input', async () => {
      const results = await parseFiles([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('parseFile - Python imports', () => {
    it('extracts imports from Python file', async () => {
      const testFile = path.join(tempDir, 'imports.py');
      await fs.writeFile(
        testFile,
        `
import json
import os.path
from typing import Optional, List
from os.path import join as path_join
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.imports).toHaveLength(4);

      const jsonImport = result.imports.find(i => i.module === 'json');
      expect(jsonImport).toBeDefined();
      expect(jsonImport.is_from).toBe(false);

      const typingImport = result.imports.find(i => i.module === 'typing');
      expect(typingImport).toBeDefined();
      expect(typingImport.is_from).toBe(true);
      expect(typingImport.names).toContain('Optional');
      expect(typingImport.names).toContain('List');

      const osPathImport = result.imports.find(i => i.module === 'os.path' && i.is_from);
      expect(osPathImport).toBeDefined();
      expect(osPathImport.is_from).toBe(true);
    });
  });

  describe('parseFile - JS imports', () => {
    it('extracts imports from JavaScript file', async () => {
      const testFile = path.join(tempDir, 'imports.js');
      await fs.writeFile(
        testFile,
        `
import express from 'express';
import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.imports).toHaveLength(3);

      const expressImport = result.imports.find(i => i.source === 'express');
      expect(expressImport).toBeDefined();
      expect(expressImport.default).toBe('express');

      const fsImport = result.imports.find(i => i.source === 'fs/promises');
      expect(fsImport).toBeDefined();
      expect(fsImport.specifiers).toContain('readFile');
      expect(fsImport.specifiers).toContain('writeFile');

      const pathImport = result.imports.find(i => i.source === 'path');
      expect(pathImport).toBeDefined();
      expect(pathImport.default).toContain('path');
    });
  });

  describe('parseFile - Python classes', () => {
    it('extracts class definitions from Python file', async () => {
      const testFile = path.join(tempDir, 'classes.py');
      await fs.writeFile(
        testFile,
        `
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        pass

    def _internal(self):
        pass

class Dog(Animal):
    def speak(self):
        return "Woof"
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.classes).toHaveLength(2);

      const animal = result.classes.find(c => c.name === 'Animal');
      expect(animal).toBeDefined();
      expect(animal.superclass).toBeNull();
      expect(animal.methods).toBeDefined();
      expect(animal.methods.map(m => m.name)).toContain('__init__');
      expect(animal.methods.map(m => m.name)).toContain('speak');
      expect(animal.methods.map(m => m.name)).toContain('_internal');

      const internalMethod = animal.methods.find(m => m.name === '_internal');
      expect(internalMethod.is_private).toBe(true);

      const dog = result.classes.find(c => c.name === 'Dog');
      expect(dog).toBeDefined();
      expect(dog.superclass).toBe('Animal');
    });
  });

  describe('parseFile - JS classes', () => {
    it('extracts class definitions from JavaScript file', async () => {
      const testFile = path.join(tempDir, 'classes.js');
      await fs.writeFile(
        testFile,
        `
class Service {
    constructor(config) {
        this.config = config;
    }

    async fetchData(url) {
        return fetch(url);
    }

    static create() {
        return new Service({});
    }

    _internal() {}
}

class ApiService extends Service {
    async fetchApi() {
        return super.fetchData('/api');
    }
}
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.classes).toHaveLength(2);

      const service = result.classes.find(c => c.name === 'Service');
      expect(service).toBeDefined();
      expect(service.methods).toBeDefined();
      expect(service.methods.map(m => m.name)).toContain('constructor');
      expect(service.methods.map(m => m.name)).toContain('fetchData');
      expect(service.methods.map(m => m.name)).toContain('create');
      expect(service.methods.map(m => m.name)).toContain('_internal');

      const fetchData = service.methods.find(m => m.name === 'fetchData');
      expect(fetchData.is_async).toBe(true);

      const create = service.methods.find(m => m.name === 'create');
      expect(create.is_static).toBe(true);

      const internal = service.methods.find(m => m.name === '_internal');
      expect(internal.is_private).toBe(true);

      const apiService = result.classes.find(c => c.name === 'ApiService');
      expect(apiService).toBeDefined();
      expect(apiService.superclass).toBe('Service');
    });
  });

  describe('parseFile - JS exports', () => {
    it('extracts exports from JavaScript file', async () => {
      const testFile = path.join(tempDir, 'exports.js');
      await fs.writeFile(
        testFile,
        `
export function greet() {}
export class Greeter {}
export default function main() {}
export const CONFIG = {};
`
      );

      const result = await parseFile(testFile);

      expect(result.error).toBeNull();
      expect(result.exports.length).toBeGreaterThanOrEqual(3);

      const greetExport = result.exports.find(e => e.name === 'greet');
      expect(greetExport).toBeDefined();
      expect(greetExport.type).toBe('function');

      const greeterExport = result.exports.find(e => e.name === 'Greeter');
      expect(greeterExport).toBeDefined();
      expect(greeterExport.type).toBe('class');

      const defaultExport = result.exports.find(e => e.is_default);
      expect(defaultExport).toBeDefined();
    });
  });
});
