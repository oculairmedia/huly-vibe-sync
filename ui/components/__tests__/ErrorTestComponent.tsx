/**
 * Test Component for Error Boundary
 *
 * This component is ONLY for testing the Error Boundary in development.
 * It intentionally throws errors when the button is clicked.
 *
 * DO NOT use this component in production!
 */

'use client'

import { useState } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { AlertTriangle } from 'lucide-react'

interface ErrorTestComponentProps {
  errorType?: 'render' | 'click' | 'async'
}

export function ErrorTestComponent({ errorType = 'click' }: ErrorTestComponentProps) {
  const [shouldError, setShouldError] = useState(false)

  // Render error - throws immediately during render
  if (shouldError && errorType === 'render') {
    throw new Error('Test render error: This error was thrown during component rendering')
  }

  // Click error - throws when button is clicked
  const handleClickError = () => {
    if (errorType === 'click') {
      throw new Error('Test click error: This error was thrown from a click handler')
    }
  }

  // Async error - throws after a delay
  const handleAsyncError = () => {
    if (errorType === 'async') {
      setTimeout(() => {
        throw new Error('Test async error: This error was thrown asynchronously')
      }, 100)
    }
  }

  return (
    <Card className="border-yellow-500 border-2">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          <CardTitle className="text-yellow-900">Error Boundary Test</CardTitle>
        </div>
        <CardDescription>
          Test component for verifying Error Boundary functionality (Development only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-yellow-50 p-4">
          <p className="text-sm text-yellow-900">
            This component allows testing different types of errors:
          </p>
          <ul className="list-disc list-inside text-sm text-yellow-800 mt-2 space-y-1">
            <li>
              <strong>Render Error:</strong> Throws error during component rendering
            </li>
            <li>
              <strong>Click Error:</strong> Throws error when button is clicked
            </li>
            <li>
              <strong>Async Error:</strong> Throws error after async operation
            </li>
          </ul>
        </div>

        <div className="flex gap-2">
          {errorType === 'render' && (
            <Button
              onClick={() => setShouldError(true)}
              variant="destructive"
            >
              Trigger Render Error
            </Button>
          )}

          {errorType === 'click' && (
            <Button onClick={handleClickError} variant="destructive">
              Trigger Click Error
            </Button>
          )}

          {errorType === 'async' && (
            <Button onClick={handleAsyncError} variant="destructive">
              Trigger Async Error
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-600">
          Note: Async errors may not be caught by Error Boundary in some cases.
          Use try-catch blocks for async operations.
        </p>
      </CardContent>
    </Card>
  )
}
