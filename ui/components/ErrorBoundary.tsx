/**
 * Error Boundary Component
 *
 * Catches React component errors and prevents full app crashes
 */

'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Error Boundary class component
 *
 * Catches errors in child components and displays a fallback UI
 * instead of crashing the entire application
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    // Store error info in state
    this.setState({
      error,
      errorInfo,
    })

    // Call optional error handler
    this.props.onError?.(error, errorInfo)

    // In production, you could send this to an error tracking service
    // Example: Sentry.captureException(error, { extra: errorInfo })
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-6 w-6 text-red-500" />
                <CardTitle>Something went wrong</CardTitle>
              </div>
              <CardDescription>
                An unexpected error occurred in the application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Error message */}
              <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                <h3 className="font-semibold text-red-900 mb-2">Error Details</h3>
                <p className="text-sm text-red-800 font-mono">
                  {this.state.error?.message || 'Unknown error'}
                </p>
              </div>

              {/* Component stack (only in development) */}
              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <details className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                  <summary className="cursor-pointer font-semibold text-gray-900 mb-2">
                    Component Stack
                  </summary>
                  <pre className="text-xs text-gray-700 overflow-auto max-h-48 whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}

              {/* Error stack trace (only in development) */}
              {process.env.NODE_ENV === 'development' && this.state.error?.stack && (
                <details className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                  <summary className="cursor-pointer font-semibold text-gray-900 mb-2">
                    Stack Trace
                  </summary>
                  <pre className="text-xs text-gray-700 overflow-auto max-h-48 whitespace-pre-wrap">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-4">
                <Button onClick={this.handleReset} variant="default">
                  Try Again
                </Button>
                <Button onClick={this.handleReload} variant="outline">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reload Page
                </Button>
              </div>

              {/* Help text */}
              <p className="text-sm text-gray-600 pt-2">
                If this problem persists, please contact support or report an issue on{' '}
                <a
                  href="https://github.com/oculairmedia/huly-vibe-sync/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  GitHub
                </a>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Lightweight error boundary for specific sections
 *
 * Shows a compact error message instead of the full-screen UI
 */
export function SectionErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <p className="text-sm font-semibold text-red-900">
              Error loading this section
            </p>
          </div>
          <p className="text-xs text-red-800">
            Please refresh the page to try again.
          </p>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  )
}
