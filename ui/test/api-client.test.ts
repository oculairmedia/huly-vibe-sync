/**
 * Tests for API client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { ApiClient, ApiClientError, ValidationError } from '../lib/api/client'

describe('ApiClient', () => {
  let client: ApiClient

  beforeEach(() => {
    client = new ApiClient({ baseUrl: 'http://localhost:3099' })
    vi.clearAllMocks()
  })

  describe('GET requests', () => {
    it('makes successful GET request', async () => {
      const mockData = { status: 'healthy' }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      })

      const result = await client.get('/health')

      expect(result).toEqual(mockData)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3099/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('throws error on failed GET request', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Resource not found' }),
      })

      await expect(client.get('/invalid')).rejects.toThrow(ApiClientError)
    })
  })

  describe('POST requests', () => {
    it('makes successful POST request with data', async () => {
      const mockResponse = { message: 'Success' }
      const postData = { key: 'value' }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await client.post('/api/sync/trigger', postData)

      expect(result).toEqual(mockResponse)
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3099/api/sync/trigger',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(postData),
        })
      )
    })
  })

  describe('PATCH requests', () => {
    it('makes successful PATCH request', async () => {
      const mockResponse = { config: { updated: true } }
      const patchData = { syncInterval: 60000 }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await client.patch('/api/config', patchData)

      expect(result).toEqual(mockResponse)
    })
  })

  describe('Error handling', () => {
    it('retries on network errors', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        })

      const result = await client.get('/health')

      expect(result).toEqual({ success: true })
      expect(global.fetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('throws error after max retries', async () => {
      const client = new ApiClient({ retries: 1 })

      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))

      await expect(client.get('/health')).rejects.toThrow()
    })
  })

  describe('Zod validation', () => {
    const HealthSchema = z.object({
      status: z.string(),
      uptime: z.number(),
    })

    it('validates response with schema and returns typed data', async () => {
      const mockData = { status: 'healthy', uptime: 12345 }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      })

      const result = await client.get('/health', { schema: HealthSchema })

      expect(result).toEqual(mockData)
      expect(result.status).toBe('healthy')
      expect(result.uptime).toBe(12345)
    })

    it('throws ValidationError when response does not match schema', async () => {
      const invalidData = { status: 'healthy', uptime: 'not-a-number' }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => invalidData,
      })

      await expect(
        client.get('/health', { schema: HealthSchema })
      ).rejects.toThrow(ValidationError)
    })

    it('throws ValidationError with detailed error message', async () => {
      const invalidData = { status: 123, uptime: 'invalid' }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => invalidData,
      })

      try {
        await client.get('/health', { schema: HealthSchema })
        expect.fail('Should have thrown ValidationError')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).message).toContain('Response validation failed')
      }
    })

    it('works without schema for backward compatibility', async () => {
      const mockData = { anything: 'goes', no: 'validation' }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      })

      const result = await client.get('/unvalidated')

      expect(result).toEqual(mockData)
    })

    it('validates POST response with schema', async () => {
      const ResponseSchema = z.object({
        message: z.string(),
        eventId: z.string(),
      })

      const mockResponse = { message: 'Sync triggered', eventId: 'evt-123' }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await client.post('/api/sync/trigger', {}, { schema: ResponseSchema })

      expect(result).toEqual(mockResponse)
    })

    it('validates PATCH response with schema', async () => {
      const ConfigSchema = z.object({
        config: z.object({
          syncInterval: z.number(),
        }),
      })

      const mockResponse = { config: { syncInterval: 60000 } }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await client.patch(
        '/api/config',
        { syncInterval: 60000 },
        { schema: ConfigSchema }
      )

      expect(result).toEqual(mockResponse)
    })

    it('throws ValidationError for invalid POST response', async () => {
      const ResponseSchema = z.object({
        message: z.string(),
        eventId: z.string(),
      })

      const invalidResponse = { message: 'Sync triggered' } // missing eventId

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => invalidResponse,
      })

      await expect(
        client.post('/api/sync/trigger', {}, { schema: ResponseSchema })
      ).rejects.toThrow(ValidationError)
    })
  })
})
