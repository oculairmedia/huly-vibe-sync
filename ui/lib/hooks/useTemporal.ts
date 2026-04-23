/**
 * useTemporal Hook
 *
 * React Query hooks for fetching Temporal workflow schedule and workflow data
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query'
import { api } from '../api/client'
import { z } from 'zod'

// ============================================================================
// Permissive Zod Schemas — we use .passthrough() since the exact shape
// returned by the backend may evolve.
// ============================================================================

/**
 * Schedule info schema (permissive)
 */
const TemporalScheduleSchema = z.object({
  scheduleId: z.string().optional(),
  status: z.string().optional(),
  interval: z.string().optional(),
  nextRunTime: z.string().optional(),
  lastRunTime: z.string().optional(),
  running: z.boolean().optional(),
}).passthrough()

/**
 * Single workflow execution schema (permissive)
 */
const WorkflowExecutionSchema = z.object({
  workflowId: z.string().optional(),
  runId: z.string().optional(),
  status: z.string().optional(),
  startTime: z.string().optional(),
  closeTime: z.string().optional(),
  type: z.string().optional(),
}).passthrough()

/**
 * Workflows list response schema (permissive)
 */
const TemporalWorkflowsSchema = z.object({
  workflows: z.array(WorkflowExecutionSchema).optional(),
  total: z.number().optional(),
}).passthrough()

// ============================================================================
// Types inferred from schemas
// ============================================================================

export type TemporalSchedule = z.infer<typeof TemporalScheduleSchema>
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>
export type TemporalWorkflows = z.infer<typeof TemporalWorkflowsSchema>

// ============================================================================
// Fetch functions
// ============================================================================

async function fetchTemporalSchedule(): Promise<TemporalSchedule> {
  return api.get<TemporalSchedule>('/api/temporal/schedule', {
    schema: TemporalScheduleSchema,
    retries: 1,
    timeout: 10000,
  })
}

async function fetchTemporalWorkflows(): Promise<TemporalWorkflows> {
  return api.get<TemporalWorkflows>('/api/temporal/workflows', {
    schema: TemporalWorkflowsSchema,
    retries: 1,
    timeout: 10000,
  })
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching Temporal schedule data with 30-second auto-refetch
 */
export function useTemporalSchedule(
  options?: Omit<UseQueryOptions<TemporalSchedule, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<TemporalSchedule, Error>({
    queryKey: ['temporal', 'schedule'],
    queryFn: fetchTemporalSchedule,
    refetchInterval: 30_000,
    retry: 1,
    ...options,
  })
}

/**
 * Hook for fetching Temporal workflows with 30-second auto-refetch
 */
export function useTemporalWorkflows(
  options?: Omit<UseQueryOptions<TemporalWorkflows, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<TemporalWorkflows, Error>({
    queryKey: ['temporal', 'workflows'],
    queryFn: fetchTemporalWorkflows,
    refetchInterval: 30_000,
    retry: 1,
    ...options,
  })
}
