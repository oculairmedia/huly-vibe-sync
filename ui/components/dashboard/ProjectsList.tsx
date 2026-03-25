/**
 * Projects List Component
 *
 * Displays registry projects in a sortable, filterable table
 */

'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/hooks/useProjects';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FolderKanban,
  AlertTriangle,
  RefreshCw,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  X,
} from 'lucide-react';

type SortField = 'identifier' | 'name' | 'tech_stack' | 'letta_agent_id' | 'beads_issue_count' | 'status';
type SortDirection = 'asc' | 'desc';

const COLUMNS: { key: SortField; label: string }[] = [
  { key: 'identifier', label: 'Identifier' },
  { key: 'name', label: 'Name' },
  { key: 'tech_stack', label: 'Tech Stack' },
  { key: 'letta_agent_id', label: 'Agent' },
  { key: 'beads_issue_count', label: 'Beads Issues' },
  { key: 'status', label: 'Status' },
];

function SortIcon({
  field,
  sortField,
  sortDirection,
}: {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  if (field !== sortField) {
    return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
  }
  if (sortDirection === 'asc') {
    return <ArrowUp className="ml-1 h-3 w-3" />;
  }
  return <ArrowDown className="ml-1 h-3 w-3" />;
}

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

function getTechStackColor(tech: string): string {
  const colors: Record<string, string> = {
    typescript: 'bg-blue-100 text-blue-800',
    javascript: 'bg-yellow-100 text-yellow-800',
    python: 'bg-green-100 text-green-800',
    rust: 'bg-orange-100 text-orange-800',
    go: 'bg-cyan-100 text-cyan-800',
  };
  return colors[tech.toLowerCase()] || 'bg-gray-100 text-gray-800';
}

export function ProjectsList() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isRefetching } = useProjects();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredAndSorted = useMemo(() => {
    if (!data?.projects) return [];

    let projects = [...data.projects];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      projects = projects.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.identifier.toLowerCase().includes(q)
      );
    }

    projects.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'identifier':
          aVal = a.identifier.toLowerCase();
          bVal = b.identifier.toLowerCase();
          break;
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'tech_stack':
          aVal = (a.tech_stack || '').toLowerCase();
          bVal = (b.tech_stack || '').toLowerCase();
          break;
        case 'letta_agent_id':
          aVal = a.letta_agent_id ? 1 : 0;
          bVal = b.letta_agent_id ? 1 : 0;
          break;
        case 'beads_issue_count':
          aVal = a.beads_issue_count ?? 0;
          bVal = b.beads_issue_count ?? 0;
          break;
        case 'status':
          aVal = (a.status || '').toLowerCase();
          bVal = (b.status || '').toLowerCase();
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return projects;
  }, [data?.projects, searchQuery, sortField, sortDirection]);

  if (isLoading) {
    return (
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>Project registry</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="flex items-center gap-4 border-b pb-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>Project registry</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>Failed to load projects</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Project registry</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={'mr-1 h-3 w-3' + (isRefetching ? ' animate-spin' : '')} />
              Refresh
            </Button>
            <Badge variant="outline">
              <FolderKanban className="mr-1 h-3 w-3" />
              {data.total} Total
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter by name or identifier..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="max-h-[500px] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="inline-flex items-center">
                      {col.label}
                      <SortIcon field={col.key} sortField={sortField} sortDirection={sortDirection} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
                    {searchQuery ? 'No projects match your filter.' : 'No projects found.'}
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map(project => (
                  <tr
                    key={project.identifier}
                    className="cursor-pointer bg-white transition-colors hover:bg-muted/50"
                    onClick={() => router.push('/project/' + project.identifier)}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {project.identifier}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 font-medium">
                      {project.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {project.tech_stack ? (
                        <span className={'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' + getTechStackColor(project.tech_stack)}>
                          {project.tech_stack}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {project.letta_agent_id ? (
                        <span className="inline-flex items-center text-green-600" title={project.letta_agent_id}>
                          <Check className="h-4 w-4" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-red-400">
                          <X className="h-4 w-4" />
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                      {(project.beads_issue_count ?? 0) > 0 ? (
                        <span className="font-medium text-amber-600">{project.beads_issue_count}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {project.status ? (
                        <Badge variant={getStatusBadgeVariant(project.status)}>
                          {project.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {searchQuery && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {filteredAndSorted.length} of {data.projects.length} projects
          </p>
        )}
      </CardContent>
    </Card>
  );
}
