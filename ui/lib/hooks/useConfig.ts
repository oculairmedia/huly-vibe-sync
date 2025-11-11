/**
 * useConfig Hook
 *
 * React Query hooks for configuration management
 */

import { useMutation, useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query'
import { api } from '../api/client'
import { Configuration, ConfigResponse, ConfigUpdateRequest } from '../types'

/**
 * Fetch configuration from /api/config
 */
async function fetchConfig(): Promise<ConfigResponse> {
  return api.get<ConfigResponse>('/api/config')
}

/**
 * Update configuration via PATCH /api/config
 */
async function updateConfig(updates: ConfigUpdateRequest): Promise<ConfigResponse> {
  return api.patch<ConfigResponse>('/api/config', updates)
}

/**
 * Reset configuration to defaults via POST /api/config/reset
 */
async function resetConfig(): Promise<ConfigResponse> {
  return api.post<ConfigResponse>('/api/config/reset')
}

/**
 * Hook for fetching configuration with auto-refetch
 *
 * @param options - React Query options
 * @returns Query result with configuration data
 */
export function useConfig(
  options?: Omit<UseQueryOptions<ConfigResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<ConfigResponse, Error>({
    queryKey: ['config'],
    queryFn: fetchConfig,
    ...options,
  })
}

/**
 * Hook for updating configuration
 *
 * @returns Mutation function and state
 */
export function useUpdateConfig() {
  const queryClient = useQueryClient()

  return useMutation<ConfigResponse, Error, ConfigUpdateRequest>({
    mutationFn: updateConfig,
    onSuccess: (data) => {
      // Update the config query cache
      queryClient.setQueryData(['config'], data)

      // Invalidate health query to refetch with new config
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}

/**
 * Hook for resetting configuration to defaults
 *
 * @returns Mutation function and state
 */
export function useResetConfig() {
  const queryClient = useQueryClient()

  return useMutation<ConfigResponse, Error, void>({
    mutationFn: resetConfig,
    onSuccess: (data) => {
      // Update the config query cache
      queryClient.setQueryData(['config'], data)

      // Invalidate health query to refetch with new config
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })
}
