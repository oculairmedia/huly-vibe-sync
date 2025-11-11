/**
 * useSyncTrigger Hook
 *
 * React Query hook for triggering manual syncs
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { SyncTriggerRequest, SyncTriggerResponse } from '../types'
import { SyncTriggerResponseSchema } from '../schemas'

/**
 * Trigger sync via POST /api/sync/trigger
 */
async function triggerSync(request: SyncTriggerRequest = {}): Promise<SyncTriggerResponse> {
  return api.post<SyncTriggerResponse>('/api/sync/trigger', request, {
    schema: SyncTriggerResponseSchema,
  })
}

/**
 * Hook for triggering manual sync
 *
 * @returns Mutation function and state
 */
export function useSyncTrigger() {
  const queryClient = useQueryClient()

  return useMutation<SyncTriggerResponse, Error, SyncTriggerRequest>({
    mutationFn: triggerSync,
    onSuccess: () => {
      // Invalidate sync history to show new sync
      queryClient.invalidateQueries({ queryKey: ['syncHistory'] })

      // Refetch health after a delay to show updated stats
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['health'] })
      }, 2000)
    },
  })
}
