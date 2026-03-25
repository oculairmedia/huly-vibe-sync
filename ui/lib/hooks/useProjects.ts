/**
 * useProjects Hook
 *
 * React Query hook for fetching project list from the registry
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query'
import { api } from '../api/client'
import { ProjectsResponse, ProjectSummary } from '../types'
import { z } from 'zod'

// Schema for validation — permissive with .passthrough()
const ProjectSummarySchema = z.object({
  identifier: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tech_stack: z.string().default('unknown'),
  letta_agent_id: z.string().nullable().default(null),
  beads_issue_count: z.number().default(0),
  beads_prefix: z.string().default(''),
  status: z.string().default('unknown'),
  last_scan_at: z.string().nullable().default(null),
  last_sync_at: z.string().nullable().default(null),
  issue_count: z.number().default(0),
  filesystem_path: z.string().default(''),
  git_url: z.string().nullable().default(null),
}).passthrough()

const ProjectsResponseSchema = z.object({
  total: z.number(),
  projects: z.array(ProjectSummarySchema),
}).passthrough()

/**
 * Fetch projects data from /api/registry/projects endpoint
 */
async function fetchProjects(): Promise<ProjectsResponse> {
  return api.get<ProjectsResponse>('/api/registry/projects', {
    schema: ProjectsResponseSchema,
  })
}

/**
 * Fetch a single project by identifier
 */
async function fetchProject(identifier: string): Promise<ProjectSummary> {
  return api.get<ProjectSummary>(`/api/registry/projects/${identifier}`, {
    schema: ProjectSummarySchema,
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

/**
 * Hook for fetching a single project by identifier
 *
 * @param identifier - Project identifier
 * @param options - React Query options
 * @returns Query result with project data
 */
export function useProject(
  identifier: string,
  options?: Omit<UseQueryOptions<ProjectSummary, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<ProjectSummary, Error>({
    queryKey: ['project', identifier],
    queryFn: () => fetchProject(identifier),
    enabled: !!identifier,
    ...options,
  })
}
