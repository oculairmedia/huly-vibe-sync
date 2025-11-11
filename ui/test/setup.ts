/**
 * Vitest Test Setup
 *
 * Global setup for all tests
 */

import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, afterAll, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      pathname: '/',
      query: {},
      asPath: '/',
    }
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  usePathname() {
    return '/'
  },
}))

// Mock environment variables
beforeAll(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3099'
  process.env.NEXT_PUBLIC_POLLING_INTERVAL = '5000'
})

// Mock fetch globally
global.fetch = vi.fn()

afterAll(() => {
  vi.clearAllMocks()
})
