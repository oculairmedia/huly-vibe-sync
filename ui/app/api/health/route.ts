/**
 * Health Check Endpoint
 *
 * Simple health check for the Next.js UI application.
 * Used by Docker health checks and monitoring.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'huly-vibe-sync-ui',
    timestamp: new Date().toISOString()
  })
}
