/**
 * useHealth Hook
 *
 * React Query hook for fetching health/stats data
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query'
import { api } from '../api/client'
import { HealthResponse, StatsResponse } from '../types'
import { HealthResponseSchema, StatsResponseSchema } from '../schemas'

/**
 * Fetch health data from /health endpoint
 */
async function fetchHealth(): Promise<HealthResponse> {
  return api.get<HealthResponse>('/health', {
    schema: HealthResponseSchema,
  })
}

/**
 * Fetch stats data from /api/stats endpoint
 */
async function fetchStats(): Promise<StatsResponse> {
  return api.get<StatsResponse>('/api/stats', {
    schema: StatsResponseSchema,
  })
}

/**
 * Hook for fetching health data with auto-refetch
 *
 * @param options - React Query options
 * @returns Query result with health data
 */
export function useHealth(
  options?: Omit<
    UseQueryOptions<HealthResponse, Error>,
    'queryKey' | 'queryFn'
  >
) {
  return useQuery<HealthResponse, Error>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    ...options,
  })
}

/**
 * Hook for fetching stats data with auto-refetch
 *
 * @param options - React Query options
 * @returns Query result with stats data
 */
export function useStats(
  options?: Omit<UseQueryOptions<StatsResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<StatsResponse, Error>({
    queryKey: ['stats'],
    queryFn: fetchStats,
    ...options,
  })
}
