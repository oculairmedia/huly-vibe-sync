/**
 * Connection Status Component
 *
 * Displays SSE connection status and real-time events indicator
 */

'use client'

import { useRealtimeEvents } from '@/lib/hooks/useRealtimeEvents'
import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'

export function ConnectionStatus() {
  const { connected, reconnecting, error } = useRealtimeEvents()

  if (reconnecting) {
    return (
      <Badge variant="warning" className="gap-1">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Reconnecting...
      </Badge>
    )
  }

  if (error || !connected) {
    return (
      <Badge variant="error" className="gap-1">
        <WifiOff className="h-3 w-3" />
        Disconnected
      </Badge>
    )
  }

  return (
    <Badge variant="success" className="gap-1">
      <Wifi className="h-3 w-3" />
      Live
    </Badge>
  )
}
