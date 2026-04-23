/**
 * Activity Feed Component
 *
 * Real-time SSE-powered live sync activity feed showing events
 * in reverse chronological order with color-coded type badges
 */

'use client'

import { useRealtimeEvents } from '@/lib/hooks/useRealtimeEvents'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SSEEvent } from '@/lib/types'
import { format } from 'date-fns'
import { RefreshCw } from 'lucide-react'

/**
 * Map event type to badge variant and label
 */
function getEventBadgeProps(type: string): {
  className: string
  label: string
} {
  switch (type) {
    case 'sync:started':
      return {
        className: 'bg-blue-100 text-blue-800 border-blue-200',
        label: 'sync:started',
      }
    case 'sync:completed':
      return {
        className: 'bg-green-100 text-green-800 border-green-200',
        label: 'sync:completed',
      }
    case 'sync:error':
      return {
        className: 'bg-red-100 text-red-800 border-red-200',
        label: 'sync:error',
      }
    case 'config:updated':
      return {
        className: 'bg-purple-100 text-purple-800 border-purple-200',
        label: 'config:updated',
      }
    case 'health:updated':
      return {
        className: 'bg-gray-100 text-gray-800 border-gray-200',
        label: 'health:updated',
      }
    case 'connected':
      return {
        className: 'bg-green-100 text-green-800 border-green-200',
        label: 'connected',
      }
    default:
      return {
        className: 'bg-gray-100 text-gray-800 border-gray-200',
        label: type,
      }
  }
}

/**
 * Extract a human-readable detail string from an event
 */
function getEventDetails(event: SSEEvent): string | null {
  const { type, data } = event

  if (!data) return null

  switch (type) {
    case 'sync:started':
      return data.projectId ? `Project: ${data.projectId}` : 'Full sync'
    case 'sync:completed':
      if (data.duration != null) {
        const durationStr =
          data.duration >= 1000
            ? `${(data.duration / 1000).toFixed(1)}s`
            : `${data.duration}ms`
        return data.projectId
          ? `Project: ${data.projectId} (${durationStr})`
          : `Duration: ${durationStr}`
      }
      return data.projectId ? `Project: ${data.projectId}` : null
    case 'sync:error':
      return data.error || (data.projectId ? `Project: ${data.projectId}` : null)
    case 'config:updated':
      if (data.updates) {
        const keys = Object.keys(data.updates)
        return keys.length > 0 ? `Updated: ${keys.join(', ')}` : null
      }
      return null
    case 'connected':
      return data.clientId ? `Client: ${data.clientId}` : null
    default:
      return null
  }
}

/**
 * Format an ISO timestamp to HH:MM:SS
 */
function formatTimestamp(timestamp: string): string {
  try {
    return format(new Date(timestamp), 'HH:mm:ss')
  } catch {
    return '--:--:--'
  }
}

/**
 * Connection status indicator dot
 */
function ConnectionDot({
  connected,
  reconnecting,
}: {
  connected: boolean
  reconnecting: boolean
}) {
  if (reconnecting) {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-500 animate-pulse"
        title="Reconnecting"
      />
    )
  }

  if (connected) {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full bg-green-500"
        title="Connected"
      />
    )
  }

  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full bg-red-500"
      title="Disconnected"
    />
  )
}

/**
 * Single event row in the activity feed
 */
function EventRow({ event }: { event: SSEEvent }) {
  const badgeProps = getEventBadgeProps(event.type)
  const details = getEventDetails(event)

  return (
    <div className="flex items-start gap-3 border-b py-2.5 last:border-b-0">
      <span className="shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
        {formatTimestamp(event.timestamp)}
      </span>
      <Badge
        variant="outline"
        className={`shrink-0 text-[11px] ${badgeProps.className}`}
      >
        {badgeProps.label}
      </Badge>
      {details && (
        <span className="truncate text-sm text-gray-600">{details}</span>
      )}
    </div>
  )
}

export function ActivityFeed() {
  const { connected, reconnecting, error, events, reconnect } =
    useRealtimeEvents()

  const isDisconnected = !connected && !reconnecting

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">Live Activity</CardTitle>
            <ConnectionDot connected={connected} reconnecting={reconnecting} />
          </div>
          {isDisconnected && (
            <Button variant="outline" size="sm" onClick={reconnect}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reconnect
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[350px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="animate-pulse text-sm text-muted-foreground">
                No events yet — waiting for activity...
              </p>
            </div>
          ) : (
            <div>
              {events.map((event, index) => (
                <EventRow key={`${event.timestamp}-${index}`} event={event} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
