/**
 * Dashboard Page
 *
 * Main dashboard displaying registry status, health metrics, and controls
 */

'use client';

import { SyncStatusCard } from '@/components/dashboard/SyncStatusCard';
import { HealthMetrics } from '@/components/dashboard/HealthMetrics';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { ConnectionStatus } from '@/components/dashboard/ConnectionStatus';
import { DatabaseStats } from '@/components/dashboard/DatabaseStats';
import { ProjectsList } from '@/components/dashboard/ProjectsList';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { TemporalMonitor } from '@/components/dashboard/TemporalMonitor';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">VibeSync Dashboard</h1>
              <p className="text-sm text-gray-600">Project Registry & System Monitor</p>
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

        {/* Third Row - Activity Feed & Temporal Workflows */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <ActivityFeed />
          <TemporalMonitor />
        </div>

        {/* Footer Info */}
        <div className="mt-8 rounded-lg border bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold">About</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              This dashboard monitors the VibeSync registry — a centralized system for managing
              project metadata and synchronization state.
            </p>
            <p>
              <strong>Features:</strong>
            </p>
            <ul className="ml-6 list-disc space-y-1">
              <li>Real-time registry status and health monitoring</li>
              <li>Live updates via Server-Sent Events (SSE)</li>
              <li>Manual sync triggers for on-demand synchronization</li>
              <li>Performance metrics and error tracking</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
