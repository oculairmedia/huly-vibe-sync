/**
 * useRealtimeEvents Hook
 *
 * Hook for Server-Sent Events (SSE) real-time updates
 */

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SSEEvent } from '../types'

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
        const data = JSON.parse(e.data)
        options.onConnected?.(data.clientId)
      })

      eventSource.addEventListener('sync:started', (e) => {
        const data = JSON.parse(e.data)
        options.onSyncStarted?.(data)
      })

      eventSource.addEventListener('sync:completed', (e) => {
        const data = JSON.parse(e.data)
        options.onSyncCompleted?.(data)

        // Invalidate health query to refetch updated stats
        queryClient.invalidateQueries({ queryKey: ['health'] })
        queryClient.invalidateQueries({ queryKey: ['syncHistory'] })
      })

      eventSource.addEventListener('sync:error', (e) => {
        const data = JSON.parse(e.data)
        options.onSyncError?.(data)

        // Invalidate health query to show error
        queryClient.invalidateQueries({ queryKey: ['health'] })
      })

      eventSource.addEventListener('config:updated', (e) => {
        const data = JSON.parse(e.data)
        options.onConfigUpdated?.(data)

        // Invalidate config query to refetch
        queryClient.invalidateQueries({ queryKey: ['config'] })
        queryClient.invalidateQueries({ queryKey: ['health'] })
      })

      eventSource.addEventListener('health:updated', (e) => {
        const data = JSON.parse(e.data)
        options.onHealthUpdated?.(data)

        // Optionally update health cache directly
        queryClient.setQueryData(['health'], data)
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
