/**
 * API Client
 *
 * Base HTTP client with retry logic, error handling, and type safety
 */

import { ApiError } from '../types'

/**
 * Custom error class for API errors
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

/**
 * API client configuration
 */
interface ApiClientConfig {
  baseUrl?: string
  timeout?: number
  retries?: number
  retryDelay?: number
}

/**
 * Fetch options
 */
interface FetchOptions extends RequestInit {
  timeout?: number
  retries?: number
}

/**
 * API Client class
 */
export class ApiClient {
  private baseUrl: string
  private timeout: number
  private retries: number
  private retryDelay: number

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.NEXT_PUBLIC_API_URL || ''
    this.timeout = config.timeout || 30000 // 30 seconds
    this.retries = config.retries || 2
    this.retryDelay = config.retryDelay || 1000 // 1 second
  }

  /**
   * Make HTTP request with retry logic
   */
  private async fetchWithRetry(
    url: string,
    options: FetchOptions = {},
    attempt = 0
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout || this.timeout
    )

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // If response is not ok and we have retries left
      if (!response.ok && attempt < (options.retries || this.retries)) {
        // Wait before retry (exponential backoff)
        await this.sleep(this.retryDelay * Math.pow(2, attempt))
        return this.fetchWithRetry(url, options, attempt + 1)
      }

      return response
    } catch (error) {
      clearTimeout(timeoutId)

      // Retry on network errors
      if (attempt < (options.retries || this.retries)) {
        await this.sleep(this.retryDelay * Math.pow(2, attempt))
        return this.fetchWithRetry(url, options, attempt + 1)
      }

      throw error
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Parse error response
   */
  private async parseError(response: Response): Promise<ApiClientError> {
    try {
      const data = (await response.json()) as ApiError
      return new ApiClientError(
        data.error || response.statusText,
        response.status,
        data.details
      )
    } catch {
      return new ApiClientError(response.statusText, response.status)
    }
  }

  /**
   * GET request
   */
  async get<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path

    try {
      const response = await this.fetchWithRetry(url, {
        ...options,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      if (!response.ok) {
        throw await this.parseError(response)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error
      }
      throw new ApiClientError(
        error instanceof Error ? error.message : 'Network error',
        0
      )
    }
  }

  /**
   * POST request
   */
  async post<T>(
    path: string,
    data?: any,
    options: FetchOptions = {}
  ): Promise<T> {
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path

    try {
      const response = await this.fetchWithRetry(url, {
        ...options,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: data ? JSON.stringify(data) : undefined,
      })

      if (!response.ok) {
        throw await this.parseError(response)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error
      }
      throw new ApiClientError(
        error instanceof Error ? error.message : 'Network error',
        0
      )
    }
  }

  /**
   * PATCH request
   */
  async patch<T>(
    path: string,
    data: any,
    options: FetchOptions = {}
  ): Promise<T> {
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path

    try {
      const response = await this.fetchWithRetry(url, {
        ...options,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw await this.parseError(response)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error
      }
      throw new ApiClientError(
        error instanceof Error ? error.message : 'Network error',
        0
      )
    }
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const url = this.baseUrl ? `${this.baseUrl}${path}` : path

    try {
      const response = await this.fetchWithRetry(url, {
        ...options,
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      if (!response.ok) {
        throw await this.parseError(response)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error
      }
      throw new ApiClientError(
        error instanceof Error ? error.message : 'Network error',
        0
      )
    }
  }
}

/**
 * Default API client instance
 */
export const apiClient = new ApiClient()

/**
 * Convenience functions
 */
export const api = {
  get: <T>(path: string, options?: FetchOptions) =>
    apiClient.get<T>(path, options),
  post: <T>(path: string, data?: any, options?: FetchOptions) =>
    apiClient.post<T>(path, data, options),
  patch: <T>(path: string, data: any, options?: FetchOptions) =>
    apiClient.patch<T>(path, data, options),
  delete: <T>(path: string, options?: FetchOptions) =>
    apiClient.delete<T>(path, options),
}
