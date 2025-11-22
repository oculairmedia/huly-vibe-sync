/**
 * Dashboard Page
 *
 * Main dashboard displaying sync status, health metrics, and controls
 */

'use client'

import { SyncStatusCard } from '@/components/dashboard/SyncStatusCard'
import { HealthMetrics } from '@/components/dashboard/HealthMetrics'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { ConnectionStatus } from '@/components/dashboard/ConnectionStatus'
import { DatabaseStats } from '@/components/dashboard/DatabaseStats'
import { ProjectsList } from '@/components/dashboard/ProjectsList'

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Huly-Vibe Sync Dashboard
              </h1>
              <p className="text-sm text-gray-600">
                Monitor and manage bidirectional synchronization
              </p>
            </div>
            <ConnectionStatus />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Top Row - Sync Status, System Health, Database Stats */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-6">
          {/* Sync Status */}
          <div className="md:col-span-1">
            <SyncStatusCard />
          </div>

          {/* System Health */}
          <div className="md:col-span-1">
            <HealthMetrics />
          </div>

          {/* Database Stats */}
          <div className="md:col-span-1">
            <DatabaseStats />
          </div>
        </div>

        {/* Second Row - Projects List and Quick Actions */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Projects List */}
          <ProjectsList />

          {/* Quick Actions */}
          <div className="md:col-span-1">
            <QuickActions />
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-8 rounded-lg border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold">About</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              This dashboard monitors the bidirectional synchronization service between
              Huly (project management) and Vibe Kanban (AI-powered task execution).
            </p>
            <p>
              <strong>Features:</strong>
            </p>
            <ul className="ml-6 list-disc space-y-1">
              <li>Real-time sync status and health monitoring</li>
              <li>Live updates via Server-Sent Events (SSE)</li>
              <li>Manual sync triggers for on-demand synchronization</li>
              <li>Performance metrics and error tracking</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
