/**
 * Projects List Component
 *
 * Displays list of all projects with issue counts
 */

'use client'

import { useProjects } from '@/lib/hooks/useProjects'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { FolderKanban, AlertTriangle } from 'lucide-react'

export function ProjectsList() {
  const { data, isLoading, error } = useProjects()

  if (isLoading) {
    return (
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>All projects synced from Huly</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between border-b pb-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>All projects synced from Huly</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>Failed to load projects</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  // Separate projects with and without issues
  const activeProjects = data.projects.filter((p) => p.issue_count > 0)
  const emptyProjects = data.projects.filter((p) => p.issue_count === 0)

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Projects</CardTitle>
            <CardDescription>All projects synced from Huly</CardDescription>
          </div>
          <Badge variant="outline">
            <FolderKanban className="mr-1 h-3 w-3" />
            {data.total} Total
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] overflow-y-auto pr-4">
          {/* Active Projects */}
          {activeProjects.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-green-600">
                Active Projects ({activeProjects.length})
              </h3>
              <div className="space-y-2">
                {activeProjects.map((project) => (
                  <div
                    key={project.identifier}
                    className="flex items-center justify-between rounded-lg border bg-white p-3 hover:bg-gray-50"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {project.identifier}
                        </Badge>
                        <span className="font-medium">{project.name}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last synced:{' '}
                        {new Date(project.last_sync_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <Badge className="ml-4" variant="default">
                      {project.issue_count} issue{project.issue_count !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty Projects */}
          {emptyProjects.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-400">
                Empty Projects ({emptyProjects.length})
              </h3>
              <div className="space-y-2">
                {emptyProjects.map((project) => (
                  <div
                    key={project.identifier}
                    className="flex items-center justify-between rounded-lg border border-dashed bg-gray-50 p-3 opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {project.identifier}
                      </Badge>
                      <span className="text-sm text-gray-600">{project.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">No issues</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
