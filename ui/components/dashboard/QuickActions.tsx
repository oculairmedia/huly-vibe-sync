/**
 * Quick Actions Component
 *
 * Quick action buttons for triggering sync, refreshing data, etc.
 */

'use client';

import { useState } from 'react';
import { useSyncTrigger } from '@/lib/hooks/useSyncTrigger';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Play, CheckCircle2, XCircle } from 'lucide-react';

export function QuickActions() {
  const { mutate: triggerSync, isPending, isSuccess, isError } = useSyncTrigger();
  const [lastTrigger, setLastTrigger] = useState<Date | null>(null);

  const handleSyncNow = () => {
    triggerSync(
      {},
      {
        onSuccess: () => {
          setLastTrigger(new Date());
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Manual controls and operations</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sync Now Button */}
        <div className="space-y-2">
          <Button onClick={handleSyncNow} disabled={isPending} className="w-full" size="lg">
            {isPending ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Trigger Sync Now
              </>
            )}
          </Button>

          {/* Status Messages */}
          {isSuccess && lastTrigger && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4" />
              <span>Sync triggered successfully at {lastTrigger.toLocaleTimeString()}</span>
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <XCircle className="h-4 w-4" />
              <span>Failed to trigger sync. Please try again.</span>
            </div>
          )}
        </div>

        {/* Additional Info */}
        <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <p className="font-semibold mb-1">What does this do?</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Fetches latest data from Huly for all projects</li>
            <li>Syncs all issues bidirectionally with Vibe Kanban</li>
            <li>Updates project metadata and issue counts</li>
            <li>Bypasses scheduled interval for immediate execution</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
