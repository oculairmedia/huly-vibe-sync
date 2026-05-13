/**
 * Typed mock helpers for vitest test suite.
 *
 * Use these instead of inline `as any` casts when building mock objects
 * that only partially implement a typed interface.
 */
import { vi } from 'vitest';
import type { MockedFunction } from 'vitest';

/** Create a mock function that always returns the given value. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mockReturn<T>(value: T): (..._args: any[]) => T {
  return vi.fn(() => value);
}

/** Cast an unknown function to a properly typed MockedFunction. */
export function asMock<T extends (..._args: never[]) => unknown>(fn: unknown): MockedFunction<T> {
  return fn as MockedFunction<T>;
}

/** Create a typed mock function with no implementation. */
export function typedMock<T extends (..._args: never[]) => unknown>(): MockedFunction<T> {
  return vi.fn() as unknown as MockedFunction<T>;
}

/** Create a partial mock object — fills missing keys with vi.fn() stubs. */
export function partialMock<T extends Record<string, unknown>>(overrides: Partial<T> = {}): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler: ProxyHandler<Record<string, any>> = {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      const fn = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (target as any)[prop] = fn;
      return fn;
    },
  };
  return new Proxy({ ...overrides }, handler) as unknown as T;
}
