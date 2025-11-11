/**
 * Health Metrics Component
 *
 * Displays system health metrics (memory, uptime, connection pool)
 */

'use client'

import { useHealth } from '@/lib/hooks/useHealth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Server, Database, Clock, AlertTriangle } from 'lucide-react'

export function HealthMetrics() {
  const { data: health, isLoading, error } = useHealth()

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Service health and performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Service health and performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>Failed to load health metrics</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!health) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>System Health</CardTitle>
            <CardDescription>Service health and performance metrics</CardDescription>
          </div>
          <Badge variant="success">
            <Server className="mr-1 h-3 w-3" />
            {health.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Service Info */}
        <div className="grid grid-cols-2 gap-4 border-b pb-4">
          <div>
            <p className="text-xs text-muted-foreground">Service</p>
            <p className="text-sm font-medium">{health.service}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Version</p>
            <p className="text-sm font-medium">{health.version}</p>
          </div>
        </div>

        {/* Uptime */}
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Uptime</span>
          </div>
          <span className="text-sm font-medium">{health.uptime.human}</span>
        </div>

        {/* Memory Usage */}
        <div className="space-y-2 border-b pb-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4" />
            <span>Memory Usage</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">RSS</p>
              <p className="font-medium">{health.memory.rss}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Heap Used</p>
              <p className="font-medium">{health.memory.heapUsed}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Heap Total</p>
              <p className="font-medium">{health.memory.heapTotal}</p>
            </div>
          </div>
        </div>

        {/* Connection Pool */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Connection Pool</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">HTTP Active</p>
              <p className="font-medium">{health.connectionPool.http.sockets}</p>
            </div>
            <div>
              <p className="text-muted-foreground">HTTPS Active</p>
              <p className="font-medium">{health.connectionPool.https.sockets}</p>
            </div>
          </div>
        </div>

        {/* Last Error */}
        {health.lastError && (
          <div className="rounded-lg bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">
              Last Error ({health.lastError.age} ago)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {health.lastError.message}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
