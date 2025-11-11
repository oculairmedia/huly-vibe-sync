/**
 * Tests for utility functions
 */

import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatPercentage,
  truncate,
  getStatusColor,
  safeJsonParse,
} from '../lib/utils'

describe('Utility Functions', () => {
  describe('formatBytes', () => {
    it('formats bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 Bytes')
      expect(formatBytes(1024)).toBe('1 KB')
      expect(formatBytes(1024 * 1024)).toBe('1 MB')
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('respects decimal places', () => {
      expect(formatBytes(1536, 2)).toBe('1.5 KB')
      expect(formatBytes(1536, 0)).toBe('2 KB')
    })
  })

  describe('formatDuration', () => {
    it('formats milliseconds correctly', () => {
      expect(formatDuration(1000)).toBe('1s')
      expect(formatDuration(60000)).toBe('1m 0s')
      expect(formatDuration(3600000)).toBe('1h 0m')
      expect(formatDuration(86400000)).toBe('1d 0h')
    })

    it('handles zero and negative values', () => {
      expect(formatDuration(0)).toBe('0s')
      expect(formatDuration(-1000)).toBe('0s')
    })
  })

  describe('formatNumber', () => {
    it('adds thousand separators', () => {
      expect(formatNumber(1000)).toBe('1,000')
      expect(formatNumber(1000000)).toBe('1,000,000')
      expect(formatNumber(123)).toBe('123')
    })
  })

  describe('formatPercentage', () => {
    it('calculates percentage correctly', () => {
      expect(formatPercentage(50, 100)).toBe('50.0%')
      expect(formatPercentage(1, 3, 2)).toBe('33.33%')
      expect(formatPercentage(0, 100)).toBe('0.0%')
    })

    it('handles zero total', () => {
      expect(formatPercentage(50, 0)).toBe('0%')
    })
  })

  describe('truncate', () => {
    it('truncates long strings', () => {
      expect(truncate('Hello World', 8)).toBe('Hello...')
      expect(truncate('Short', 10)).toBe('Short')
    })
  })

  describe('getStatusColor', () => {
    it('returns correct color classes', () => {
      expect(getStatusColor('error')).toContain('red')
      expect(getStatusColor('success')).toContain('green')
      expect(getStatusColor('warning')).toContain('yellow')
      expect(getStatusColor('in progress')).toContain('blue')
    })
  })

  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      expect(safeJsonParse('{"key": "value"}', {})).toEqual({ key: 'value' })
    })

    it('returns fallback for invalid JSON', () => {
      expect(safeJsonParse('invalid', { default: true })).toEqual({
        default: true,
      })
    })
  })
})
