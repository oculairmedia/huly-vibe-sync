/**
 * Temporal Monitor Component
 *
 * Displays Temporal workflow schedule status, active workflows, and recent
 * execution history. Fetches from /api/temporal/schedule and /api/temporal/workflows.
 */

'use client'

import {
  useTemporalSchedule,
  useTemporalWorkflows,
  type WorkflowExecution,
} from '@/lib/hooks/useTemporal'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Timer,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Play,
  CalendarClock,
  Loader2,
} from 'lucide-react'

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const absDiff = Math.abs(diffMs)
    const isFuture = diffMs < 0

    const seconds = Math.floor(absDiff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    let label: string
    if (days > 0) {
      label = `${days}d ${hours % 24}h`
    } else if (hours > 0) {
      label = `${hours}h ${minutes % 60}m`
    } else if (minutes > 0) {
      label = `${minutes}m`
    } else {
      label = `${seconds}s`
    }

    return isFuture ? `in ${label}` : `${label} ago`
  } catch {
    return isoString
  }
}

function getWorkflowStatusIcon(status?: string) {
  switch (status?.toUpperCase()) {
    case 'RUNNING':
    case 'WORKFLOW_EXECUTION_STATUS_RUNNING':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
    case 'COMPLETED':
    case 'WORKFLOW_EXECUTION_STATUS_COMPLETED':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
    case 'FAILED':
    case 'WORKFLOW_EXECUTION_STATUS_FAILED':
      return <XCircle className="h-3.5 w-3.5 text-red-600" />
    case 'TIMED_OUT':
    case 'WORKFLOW_EXECUTION_STATUS_TIMED_OUT':
      return <Clock className="h-3.5 w-3.5 text-yellow-600" />
    case 'CANCELED':
    case 'CANCELLED':
    case 'WORKFLOW_EXECUTION_STATUS_CANCELED':
      return <XCircle className="h-3.5 w-3.5 text-gray-500" />
    default:
      return <Activity className="h-3.5 w-3.5 text-gray-400" />
  }
}

function getWorkflowStatusBadgeVariant(
  status?: string
): 'success' | 'warning' | 'error' | 'secondary' | 'default' {
  switch (status?.toUpperCase()) {
    case 'RUNNING':
    case 'WORKFLOW_EXECUTION_STATUS_RUNNING':
      return 'default'
    case 'COMPLETED':
    case 'WORKFLOW_EXECUTION_STATUS_COMPLETED':
      return 'success'
    case 'FAILED':
    case 'WORKFLOW_EXECUTION_STATUS_FAILED':
      return 'error'
    case 'TIMED_OUT':
    case 'WORKFLOW_EXECUTION_STATUS_TIMED_OUT':
      return 'warning'
    default:
      return 'secondary'
  }
}

function normalizeStatus(status?: string): string {
  if (!status) return 'Unknown'
  // Strip the verbose Temporal prefix if present
  return status
    .replace('WORKFLOW_EXECUTION_STATUS_', '')
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase())
}

function computeDuration(start?: string, end?: string): string | null {
  if (!start) return null
  try {
    const startMs = new Date(start).getTime()
    const endMs = end ? new Date(end).getTime() : Date.now()
    const diffMs = endMs - startMs
    if (diffMs < 0) return null
    const seconds = Math.floor(diffMs / 1000)
    const minutes = Math.floor(seconds / 60)
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  } catch {
    return null
  }
}

// ============================================================================
// Sub-components
// ============================================================================

function ScheduleInfo({ data }: { data: Record<string, any> }) {
  const name = data.scheduleId || data.name || data.id || 'Sync Schedule'
  const interval = data.interval || data.frequency || data.every
  const nextRun = data.nextRunTime || data.nextRun || data.next_run_time
  const lastRun = data.lastRunTime || data.lastRun || data.last_run_time
  const isRunning = data.running ?? (data.paused != null ? !data.paused : null)

  return (
    <div className="space-y-3">
      {/* Schedule Name */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4" />
          <span>Schedule</span>
        </div>
        <span className="text-sm font-medium">{name}</span>
      </div>

      {/* Interval */}
      {interval && (
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Timer className="h-4 w-4" />
            <span>Interval</span>
          </div>
          <span className="text-sm font-medium">{interval}</span>
        </div>
      )}

      {/* Schedule Status */}
      {isRunning !== null && (
        <div className="flex items-center justify-between border-b pb-3">
          <span className="text-sm text-muted-foreground">Schedule</span>
          {isRunning ? (
            <Badge variant="success">
              <Play className="mr-1 h-3 w-3" />
              Active
            </Badge>
          ) : (
            <Badge variant="secondary">Paused</Badge>
          )}
        </div>
      )}

      {/* Next Run */}
      {nextRun && (
        <div className="flex items-center justify-between border-b pb-3">
          <span className="text-sm text-muted-foreground">Next Run</span>
          <span className="text-sm font-medium" title={nextRun}>
            {formatRelativeTime(nextRun)}
          </span>
        </div>
      )}

      {/* Last Run */}
      {lastRun && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Last Run</span>
          <span className="text-sm font-medium" title={lastRun}>
            {formatRelativeTime(lastRun)}
          </span>
        </div>
      )}
    </div>
  )
}

function WorkflowList({ workflows }: { workflows: WorkflowExecution[] }) {
  if (workflows.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No recent workflow executions
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {workflows.slice(0, 5).map((wf, idx) => {
        const id = wf.workflowId || wf.runId || `wf-${idx}`
        const duration = computeDuration(wf.startTime, wf.closeTime)
        const displayName =
          wf.type || wf.workflowId?.replace(/-[^-]+$/, '') || 'Workflow'

        return (
          <div
            key={id + idx}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2 min-w-0">
              {getWorkflowStatusIcon(wf.status)}
              <span className="truncate font-medium" title={id}>
                {displayName}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {duration && (
                <span className="text-xs text-muted-foreground">{duration}</span>
              )}
              <Badge
                variant={getWorkflowStatusBadgeVariant(wf.status)}
                className="text-[10px] px-1.5"
              >
                {normalizeStatus(wf.status)}
              </Badge>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// Loading state
// ============================================================================

function TemporalMonitorSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Temporal Workflows</CardTitle>
            <CardDescription>Workflow schedule &amp; execution status</CardDescription>
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-px w-full" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Main component
// ============================================================================

export function TemporalMonitor() {
  const {
    data: schedule,
    isLoading: scheduleLoading,
    error: scheduleError,
  } = useTemporalSchedule()

  const {
    data: workflowsData,
    isLoading: workflowsLoading,
    error: workflowsError,
  } = useTemporalWorkflows()

  const isLoading = scheduleLoading || workflowsLoading
  const isUnreachable = !!scheduleError && !!workflowsError

  // Show skeleton while both are loading
  if (isLoading && !schedule && !workflowsData) {
    return <TemporalMonitorSkeleton />
  }

  // Derive overall health indicator
  const isHealthy = !isUnreachable && (!!schedule || !!workflowsData)
  const workflows = workflowsData?.workflows ?? []
  const activeCount = workflows.filter(
    wf =>
      wf.status?.toUpperCase() === 'RUNNING' ||
      wf.status === 'WORKFLOW_EXECUTION_STATUS_RUNNING'
  ).length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Temporal Workflows</CardTitle>
            <CardDescription>Workflow schedule &amp; execution status</CardDescription>
          </div>
          {isUnreachable ? (
            <Badge variant="error">
              <XCircle className="mr-1 h-3 w-3" />
              Unreachable
            </Badge>
          ) : isHealthy ? (
            <Badge variant="success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Healthy
            </Badge>
          ) : (
            <Badge variant="warning">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Degraded
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Unreachable warning */}
        {isUnreachable && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Temporal is unreachable</p>
              <p className="text-xs text-yellow-700">
                Could not connect to the Temporal schedule or workflow endpoints.
                Check that the Temporal worker is running.
              </p>
            </div>
          </div>
        )}

        {/* Schedule Info */}
        {schedule && !scheduleError && (
          <ScheduleInfo data={schedule} />
        )}

        {/* Schedule-specific error (but workflows work) */}
        {scheduleError && !isUnreachable && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span>Schedule info unavailable</span>
          </div>
        )}

        {/* Active Workflows Count */}
        {!workflowsError && (
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              <span>Active Workflows</span>
            </div>
            <span className="text-sm font-medium tabular-nums">
              {activeCount}
            </span>
          </div>
        )}

        {/* Recent Workflow Executions */}
        {!workflowsError && workflows.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">
              Recent Executions
            </h4>
            <WorkflowList workflows={workflows} />
          </div>
        )}

        {/* Workflow-specific error (but schedule works) */}
        {workflowsError && !isUnreachable && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span>Workflow history unavailable</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
