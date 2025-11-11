/**
 * useRealtimeEvents Hook
 *
 * Hook for Server-Sent Events (SSE) real-time updates
 */

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SSEEvent } from '../types'
import {
  SSEConnectedEventSchema,
  SSESyncStartedEventSchema,
  SSESyncCompletedEventSchema,
  SSESyncErrorEventSchema,
  SSEConfigUpdatedEventSchema,
  SSEHealthUpdatedEventSchema,
} from '../schemas'

interface UseRealtimeEventsOptions {
  onConnected?: (clientId: string) => void
  onSyncStarted?: (data: any) => void
  onSyncCompleted?: (data: any) => void
  onSyncError?: (data: any) => void
  onConfigUpdated?: (data: any) => void
  onHealthUpdated?: (data: any) => void
  onEvent?: (event: SSEEvent) => void
}

export interface RealtimeEventsState {
  connected: boolean
  reconnecting: boolean
  error: string | null
  events: SSEEvent[]
}

/**
 * Hook for SSE real-time events
 *
 * Automatically connects to /api/events/stream and handles reconnection
 *
 * @param options - Event handlers
 * @returns Events state and connection info
 */
export function useRealtimeEvents(options: UseRealtimeEventsOptions = {}) {
  const queryClient = useQueryClient()
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [state, setState] = useState<RealtimeEventsState>({
    connected: false,
    reconnecting: false,
    error: null,
    events: [],
  })

  const [reconnectDelay, setReconnectDelay] = useState(1000) // Start with 1 second

  /**
   * Connect to SSE stream
   */
  const connect = () => {
    // Don't connect if already connected or reconnecting
    if (eventSourceRef.current) {
      return
    }

    setState(prev => ({ ...prev, reconnecting: true, error: null }))

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
    const url = `${apiUrl}/api/events/stream`

    try {
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      // Handle connection open
      eventSource.onopen = () => {
        setState(prev => ({
          ...prev,
          connected: true,
          reconnecting: false,
          error: null,
        }))
        setReconnectDelay(1000) // Reset delay on successful connection
      }

      // Handle generic messages
      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          const event: SSEEvent = {
            type: e.type || 'message',
            data,
            timestamp: new Date().toISOString(),
          }

          setState(prev => ({
            ...prev,
            events: [event, ...prev.events].slice(0, 100), // Keep last 100 events
          }))

          options.onEvent?.(event)
        } catch (error) {
          console.error('Failed to parse SSE message:', error)
        }
      }

      // Handle specific event types
      eventSource.addEventListener('connected', (e) => {
        try {
          const rawData = JSON.parse(e.data)
          const event = SSEConnectedEventSchema.parse({
            type: 'connected',
            data: rawData,
            timestamp: new Date().toISOString(),
          })
          options.onConnected?.(event.data.clientId)
        } catch (error) {
          console.error('Failed to validate connected event:', error)
        }
      })

      eventSource.addEventListener('sync:started', (e) => {
        try {
          const rawData = JSON.parse(e.data)
          const event = SSESyncStartedEventSchema.parse({
            type: 'sync:started',
            data: rawData,
            timestamp: new Date().toISOString(),
          })
          options.onSyncStarted?.(event.data)
        } catch (error) {
          console.error('Failed to validate sync:started event:', error)
        }
      })

      eventSource.addEventListener('sync:completed', (e) => {
        try {
          const rawData = JSON.parse(e.data)
          const event = SSESyncCompletedEventSchema.parse({
            type: 'sync:completed',
            data: rawData,
            timestamp: new Date().toISOString(),
          })
          options.onSyncCompleted?.(event.data)

          // Invalidate health query to refetch updated stats
          queryClient.invalidateQueries({ queryKey: ['health'] })
          queryClient.invalidateQueries({ queryKey: ['syncHistory'] })
        } catch (error) {
          console.error('Failed to validate sync:completed event:', error)
        }
      })

      eventSource.addEventListener('sync:error', (e) => {
        try {
          const rawData = JSON.parse(e.data)
          const event = SSESyncErrorEventSchema.parse({
            type: 'sync:error',
            data: rawData,
            timestamp: new Date().toISOString(),
          })
          options.onSyncError?.(event.data)

          // Invalidate health query to show error
          queryClient.invalidateQueries({ queryKey: ['health'] })
        } catch (error) {
          console.error('Failed to validate sync:error event:', error)
        }
      })

      eventSource.addEventListener('config:updated', (e) => {
        try {
          const rawData = JSON.parse(e.data)
          const event = SSEConfigUpdatedEventSchema.parse({
            type: 'config:updated',
            data: rawData,
            timestamp: new Date().toISOString(),
          })
          options.onConfigUpdated?.(event.data)

          // Invalidate config query to refetch
          queryClient.invalidateQueries({ queryKey: ['config'] })
          queryClient.invalidateQueries({ queryKey: ['health'] })
        } catch (error) {
          console.error('Failed to validate config:updated event:', error)
        }
      })

      eventSource.addEventListener('health:updated', (e) => {
        try {
          const rawData = JSON.parse(e.data)
          const event = SSEHealthUpdatedEventSchema.parse({
            type: 'health:updated',
            data: rawData,
            timestamp: new Date().toISOString(),
          })
          options.onHealthUpdated?.(event.data)

          // Optionally update health cache directly
          queryClient.setQueryData(['health'], event.data)
        } catch (error) {
          console.error('Failed to validate health:updated event:', error)
        }
      })

      // Handle errors
      eventSource.onerror = (error) => {
        console.error('SSE error:', error)

        setState(prev => ({
          ...prev,
          connected: false,
          reconnecting: false,
          error: 'Connection lost',
        }))

        // Close the connection
        eventSource.close()
        eventSourceRef.current = null

        // Schedule reconnection with exponential backoff
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectDelay(prev => Math.min(prev * 2, 30000)) // Max 30 seconds
          connect()
        }, reconnectDelay)
      }
    } catch (error) {
      console.error('Failed to create EventSource:', error)
      setState(prev => ({
        ...prev,
        connected: false,
        reconnecting: false,
        error: 'Failed to connect',
      }))
    }
  }

  /**
   * Disconnect from SSE stream
   */
  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    setState(prev => ({
      ...prev,
      connected: false,
      reconnecting: false,
    }))
  }

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    ...state,
    reconnect: connect,
    disconnect,
  }
}
