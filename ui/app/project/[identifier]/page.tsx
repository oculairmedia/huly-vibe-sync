/**
 * Project Detail Page
 *
 * Displays full metadata for a single project from the registry
 */

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useProject } from '@/lib/hooks/useProjects';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  AlertTriangle,
  FolderKanban,
  GitBranch,
  Bot,
  Clock,
  HardDrive,
  RefreshCw,
} from 'lucide-react';

function getStatusBadgeVariant(status: string): 'success' | 'warning' | 'error' | 'secondary' {
  switch (status.toLowerCase()) {
    case 'active':
      return 'success';
    case 'inactive':
      return 'secondary';
    case 'error':
      return 'error';
    case 'pending':
      return 'warning';
    default:
      return 'secondary';
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
      <dt className="min-w-[140px] shrink-0 text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="mb-6 h-9 w-24" />
        <div className="grid gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4, 5].map(i => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent className="space-y-4">
                {[1, 2, 3].map(j => (
                  <div key={j} className="flex gap-4">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const identifier = params.identifier as string;

  const { data: project, isLoading, error, refetch, isRefetching } = useProject(identifier);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <Button variant="ghost" size="sm" onClick={() => router.push('/')} className="mb-6">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <Card>
            <CardContent className="flex items-center gap-3 py-12">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span className="text-destructive">
                Failed to load project &quot;{identifier}&quot;: {error.message}
              </span>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!project) return null;

  const status = project.status || 'unknown';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
                <Badge variant={getStatusBadgeVariant(status)}>{status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                <Badge variant="secondary" className="mr-2 font-mono text-xs">
                  {project.identifier}
                </Badge>
                {project.description || 'No description'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`mr-1 h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FolderKanban className="h-5 w-5" />
                Overview
              </CardTitle>
              <CardDescription>Core project metadata</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <DetailRow label="Status">
                  <Badge variant={getStatusBadgeVariant(status)}>{status}</Badge>
                </DetailRow>
                <DetailRow label="Tech Stack">
                  {project.tech_stack ? (
                    <Badge variant="outline">{project.tech_stack}</Badge>
                  ) : (
                    <span className="text-muted-foreground italic">Unknown</span>
                  )}
                </DetailRow>
                <DetailRow label="Description">
                  {project.description || (
                    <span className="text-muted-foreground italic">None</span>
                  )}
                </DetailRow>
                <DetailRow label="Total Issues">
                  <span className="font-medium tabular-nums">{project.issue_count ?? 0}</span>
                </DetailRow>
              </dl>
            </CardContent>
          </Card>

          {/* Paths */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HardDrive className="h-5 w-5" />
                Paths
              </CardTitle>
              <CardDescription>Filesystem path and git info</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <DetailRow label="Filesystem Path">
                  {project.filesystem_path ? (
                    <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                      {project.filesystem_path}
                    </code>
                  ) : (
                    <span className="text-muted-foreground italic">Not set</span>
                  )}
                </DetailRow>
                <DetailRow label="Git URL">
                  {project.git_url ? (
                    <a
                      href={project.git_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      <GitBranch className="h-3 w-3" />
                      {project.git_url}
                    </a>
                  ) : (
                    <span className="text-muted-foreground italic">Not set</span>
                  )}
                </DetailRow>
              </dl>
            </CardContent>
          </Card>

          {/* Agent */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bot className="h-5 w-5" />
                Agent
              </CardTitle>
              <CardDescription>Letta AI agent configuration</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <DetailRow label="Agent Status">
                  {project.letta_agent_id ? (
                    <Badge variant="success">Connected</Badge>
                  ) : (
                    <Badge variant="secondary">No agent linked</Badge>
                  )}
                </DetailRow>
                <DetailRow label="Agent ID">
                  {project.letta_agent_id ? (
                    <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                      {project.letta_agent_id}
                    </code>
                  ) : (
                    <span className="text-muted-foreground italic">No agent linked</span>
                  )}
                </DetailRow>
              </dl>
            </CardContent>
          </Card>

          {/* Sync */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5" />
                Sync
              </CardTitle>
              <CardDescription>Scan and sync timestamps</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <DetailRow label="Last Scan">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {formatDate(project.last_scan_at)}
                  </span>
                </DetailRow>
                <DetailRow label="Last Sync">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {formatDate(project.last_sync_at)}
                  </span>
                </DetailRow>
              </dl>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
