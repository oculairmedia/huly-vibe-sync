/**
 * Database Stats Component
 *
 * Displays database statistics (projects, issues, sync status)
 */

'use client'

import { useStats } from '@/lib/hooks/useHealth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Database, FolderKanban, FileText, Clock, AlertTriangle } from 'lucide-react'

export function DatabaseStats() {
  const { data: stats, isLoading, error } = useStats()

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Database Statistics</CardTitle>
          <CardDescription>Project and issue metrics</CardDescription>
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
          <CardTitle>Database Statistics</CardTitle>
          <CardDescription>Project and issue metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>Failed to load database statistics</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!stats?.database) return null

  const { database } = stats

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Database Statistics</CardTitle>
            <CardDescription>Project and issue metrics</CardDescription>
          </div>
          <Badge variant="secondary">
            <Database className="mr-1 h-3 w-3" />
            SQLite
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Projects */}
        <div className="grid grid-cols-3 gap-4 border-b pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FolderKanban className="h-3 w-3" />
              <span>Total</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{database.totalProjects}</p>
            <p className="text-xs text-muted-foreground">Projects</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{database.activeProjects}</p>
            <p className="text-xs text-muted-foreground">With Issues</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Empty</p>
            <p className="mt-1 text-2xl font-bold text-gray-400">{database.emptyProjects}</p>
            <p className="text-xs text-muted-foreground">No Issues</p>
          </div>
        </div>

        {/* Issues */}
        <div className="border-b pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <FileText className="h-3 w-3" />
            <span>Total Issues</span>
          </div>
          <p className="text-3xl font-bold">{database.totalIssues}</p>
        </div>

        {/* Last Sync */}
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Last Sync</span>
          </div>
          <p className="mt-1 text-sm font-medium">
            {database.lastSync === 'never'
              ? 'Never'
              : new Date(database.lastSync).toLocaleString()}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
