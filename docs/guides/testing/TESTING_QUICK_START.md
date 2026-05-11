# Testing Quick Start Guide

Quick reference for running tests in the Vibesync project.

## 🚀 Running Tests

```bash
# Run all tests (single run)
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run only unit tests
npm run test:unit

# Run with interactive UI
npm run test:ui
```

## 📊 Checking Coverage

```bash
# Generate coverage report
npm run test:coverage

# View HTML coverage report
open coverage/index.html
```

**Current Coverage:** 98% on utility modules (statusMapper, textParsers)

## ✍️ Writing Tests

### Basic Test Structure

```javascript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../lib/myModule.js';

describe('myModule', () => {
  describe('myFunction', () => {
    it('should do something', () => {
      const result = myFunction('input');
      expect(result).toBe('expected output');
    });
  });
});
```

### Using Test Utilities

```javascript
import { describe, it, expect } from 'vitest';
import {
  createMockLegacyProject,
  createMockVibeTask,
} from '../setup.js';

describe('myTest', () => {
  it('should work with mock data', () => {
    const project = createMockLegacyProject({ name: 'Test Project' });
    const task = createMockVibeTask({ title: 'Test Task' });

    // Your test logic here
  });
});
```

### Available Mock Factories

From `tests/setup.js`:

```javascript
// Create mock Legacy project
createMockLegacyProject({ name: 'My Project', identifier: 'PROJ' })

// Create mock Legacy issue
createMockLegacyIssue({ title: 'Bug fix', status: 'In Progress' })

// Create mock Vibe task
createMockVibeTask({ title: 'Feature', status: 'todo' })

// Create mock Letta agent
createMockLettaAgent({ name: 'Test-Agent' })
```

### Test Utilities

```javascript
// Wait for async operations
await wait(1000); // Wait 1 second

// Clean test database
await cleanTestDb();

// Clean all test data
cleanAllTestData();

// Get console output captured during tests
const logs = getConsoleLogs();
console.log(logs.info);   // All console.log/info
console.log(logs.errors); // All console.error
console.log(logs.warns);  // All console.warn
```

## 🎯 Test Organization

```
tests/
├── setup.js                    # Global test configuration
├── unit/                       # Fast, isolated tests
│   ├── statusMapper.test.js   # Status mapping tests
│   └── textParsers.test.js    # Text parsing tests
├── integration/                # End-to-end tests (future)
├── mocks/                      # Mock implementations (future)
└── __fixtures__/              # Test data (future)
```

**Where to put new tests:**
- **Unit tests** → `tests/unit/` - Fast, pure functions, no I/O
- **Integration tests** → `tests/integration/` - API calls, DB operations
- **Mocks** → `tests/mocks/` - Reusable mock implementations

## 🔍 Test Best Practices

### DO ✅
- Test one thing per test
- Use descriptive test names
- Test edge cases and error conditions
- Keep tests fast (unit tests < 1ms each)
- Use mock data from setup.js
- Clean up after tests

### DON'T ❌
- Make real API calls in unit tests
- Share state between tests
- Test implementation details
- Write flaky tests
- Ignore failing tests

## 🐛 Debugging Tests

### Run specific test file
```bash
npm test tests/unit/statusMapper.test.js
```

### Run tests matching pattern
```bash
npm test -- --grep="should map"
```

### Run with verbose output
```bash
VERBOSE_TESTS=1 npm test
```

### Use interactive UI
```bash
npm run test:ui
```

Then open the URL shown in terminal (usually http://localhost:51204)

## 📋 Common Test Patterns

### Testing Async Functions
```javascript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### Testing Errors
```javascript
it('should throw error on invalid input', () => {
  expect(() => functionThatThrows()).toThrow('Error message');
});
```

### Testing With Mocks
```javascript
import { vi } from 'vitest';

it('should call function', () => {
  const mockFn = vi.fn();
  myFunction(mockFn);
  expect(mockFn).toHaveBeenCalled();
});
```

### Testing Arrays
```javascript
it('should return expected array', () => {
  const result = getArray();
  expect(result).toHaveLength(3);
  expect(result).toContain('item');
  expect(result).toEqual(['a', 'b', 'c']);
});
```

### Testing Objects
```javascript
it('should return expected object', () => {
  const result = getObject();
  expect(result).toHaveProperty('name');
  expect(result).toMatchObject({ status: 'active' });
  expect(result).toEqual({
    name: 'Test',
    status: 'active'
  });
});
```

## 🎨 Code Quality

### Run Linting
```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Format Code
```bash
# Format all files
npm run format

# Check formatting
npm run format:check
```

### Type Check
```bash
npm run type-check
```

## 🚦 CI/CD (Future)

Tests will automatically run on:
- Pull requests
- Pushes to main branch
- Pre-commit hooks (future)

Coverage reports will be posted to GitHub PRs.

## 📚 Further Reading

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [TESTING_INFRASTRUCTURE.md](./TESTING_INFRASTRUCTURE.md) - Detailed documentation

## 💡 Tips

1. **Run tests often** - Use watch mode during development
2. **Write tests first** - TDD helps design better APIs
3. **Keep tests simple** - Easy to read = easy to maintain
4. **Use coverage** - But don't chase 100% mindlessly
5. **Mock external deps** - Tests should be fast and reliable

---

**Quick Help:**
- Tests failing? Check `TESTING_INFRASTRUCTURE.md` troubleshooting section
- Need examples? Look at existing tests in `tests/unit/`
- Have questions? Review the full testing docs

**Last Updated:** November 3, 2025
