/**
 * useProjects Hook
 *
 * React Query hook for fetching project list and stats
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query'
import { api } from '../api/client'
import { ProjectsResponse } from '../types'
import { z } from 'zod'

// Schema for validation
const ProjectsResponseSchema = z.object({
  total: z.number(),
  projects: z.array(
    z.object({
      identifier: z.string(),
      name: z.string(),
      issue_count: z.number(),
      last_sync_at: z.number(),
      last_checked_at: z.number(),
    })
  ),
  timestamp: z.string(),
})

/**
 * Fetch projects data from /api/projects endpoint
 */
async function fetchProjects(): Promise<ProjectsResponse> {
  return api.get<ProjectsResponse>('/api/projects', {
    schema: ProjectsResponseSchema,
  })
}

/**
 * Hook for fetching projects data with auto-refetch
 *
 * @param options - React Query options
 * @returns Query result with projects data
 */
export function useProjects(
  options?: Omit<UseQueryOptions<ProjectsResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<ProjectsResponse, Error>({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    ...options,
  })
}
