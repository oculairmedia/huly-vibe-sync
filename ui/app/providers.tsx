'use client'

/**
 * Application Providers
 *
 * Wraps the application with necessary context providers
 * - React Query for server state management
 * - Error Boundary for error handling
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stale time: how long before data is considered stale
            staleTime: 3000, // 3 seconds

            // Refetch interval: poll for updates
            refetchInterval: parseInt(
              process.env.NEXT_PUBLIC_POLLING_INTERVAL || '5000'
            ), // 5 seconds

            // Retry logic
            retry: 2,
            retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),

            // Refetch on window focus
            refetchOnWindowFocus: true,
          },
          mutations: {
            // Retry mutations once
            retry: 1,
          },
        },
      })
  )

  // Optional: Custom error handler for logging/reporting
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Application Error:', error)
      console.error('Error Info:', errorInfo)
    }

    // In production, you could send to an error tracking service
    // Example: Sentry.captureException(error, { extra: errorInfo })
  }

  return (
    <ErrorBoundary onError={handleError}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ErrorBoundary>
  )
}
