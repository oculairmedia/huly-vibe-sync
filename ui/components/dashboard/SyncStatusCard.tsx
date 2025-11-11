/**
 * Sync Status Card Component
 *
 * Displays current sync status, last sync time, and statistics
 */

'use client'

import { useHealth } from '@/lib/hooks/useHealth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration } from '@/lib/utils'
import { Activity, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { useRealtimeEvents } from '@/lib/hooks/useRealtimeEvents'
import { useState } from 'react'

export function SyncStatusCard() {
  const { data: health, isLoading, error } = useHealth()
  const [syncInProgress, setSyncInProgress] = useState(false)

  // Listen to real-time sync events
  useRealtimeEvents({
    onSyncStarted: () => setSyncInProgress(true),
    onSyncCompleted: () => setSyncInProgress(false),
    onSyncError: () => setSyncInProgress(false),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sync Status</CardTitle>
          <CardDescription>Current synchronization status</CardDescription>
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
          <CardTitle>Sync Status</CardTitle>
          <CardDescription>Current synchronization status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <XCircle className="h-4 w-4" />
            <span>Failed to load sync status</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!health) return null

  const { sync } = health
  const successRate = parseFloat(sync.successRate.replace('%', ''))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sync Status</CardTitle>
            <CardDescription>Current synchronization status</CardDescription>
          </div>
          {syncInProgress ? (
            <Badge variant="default" className="animate-pulse">
              <Activity className="mr-1 h-3 w-3" />
              Syncing...
            </Badge>
          ) : (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Ready
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Last Sync */}
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Last Sync</span>
          </div>
          <div className="text-sm font-medium">
            {sync.lastSyncTime
              ? new Date(sync.lastSyncTime).toLocaleString()
              : 'Never'}
          </div>
        </div>

        {/* Sync Duration */}
        {sync.lastSyncDuration && (
          <div className="flex items-center justify-between border-b pb-3">
            <span className="text-sm text-muted-foreground">Duration</span>
            <span className="text-sm font-medium">{sync.lastSyncDuration}</span>
          </div>
        )}

        {/* Total Syncs */}
        <div className="flex items-center justify-between border-b pb-3">
          <span className="text-sm text-muted-foreground">Total Syncs</span>
          <span className="text-sm font-medium">{sync.totalSyncs}</span>
        </div>

        {/* Error Count */}
        <div className="flex items-center justify-between border-b pb-3">
          <span className="text-sm text-muted-foreground">Errors</span>
          <span
            className={`text-sm font-medium ${
              sync.errorCount > 0 ? 'text-destructive' : 'text-green-600'
            }`}
          >
            {sync.errorCount}
          </span>
        </div>

        {/* Success Rate */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Success Rate</span>
          <Badge
            variant={
              successRate >= 95
                ? 'success'
                : successRate >= 80
                ? 'warning'
                : 'error'
            }
          >
            {sync.successRate}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
