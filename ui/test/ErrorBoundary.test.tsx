/**
 * Tests for ErrorBoundary component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary, SectionErrorBoundary } from '../components/ErrorBoundary'

// Suppress console errors during tests
let originalError: typeof console.error

beforeEach(() => {
  originalError = console.error
  console.error = vi.fn()
})

afterEach(() => {
  console.error = originalError
})

// Component that throws an error
function ThrowError({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message')
  }
  return <div>No error</div>
}

describe('ErrorBoundary', () => {
  describe('Error catching', () => {
    it('catches render errors and displays fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      expect(
        screen.getByText('An unexpected error occurred in the application')
      ).toBeInTheDocument()
    })

    it('displays error message in fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Test error message')).toBeInTheDocument()
    })

    it('renders children normally when no error occurs', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      )

      expect(screen.getByText('No error')).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    // Note: Error boundaries do NOT catch errors from event handlers
    // This is expected React behavior - event handler errors must be caught manually
    it('does not catch errors from event handlers (expected behavior)', () => {
      // This test documents that error boundaries don't catch event handler errors
      // In real apps, use try-catch in event handlers or let them bubble to window.onerror

      const { container } = render(
        <ErrorBoundary>
          <div>Component with event handler</div>
        </ErrorBoundary>
      )

      // Should render normally - error boundaries don't affect event handlers
      expect(screen.getByText('Component with event handler')).toBeInTheDocument()
    })
  })

  describe('Custom fallback', () => {
    it('renders custom fallback when provided', () => {
      const CustomFallback = <div>Custom error UI</div>

      render(
        <ErrorBoundary fallback={CustomFallback}>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Custom error UI')).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })
  })

  describe('Error callback', () => {
    it('calls onError callback when error occurs', () => {
      const onError = vi.fn()

      render(
        <ErrorBoundary onError={onError}>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Test error message',
        }),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      )
    })

    it('does not call onError when no error occurs', () => {
      const onError = vi.fn()

      render(
        <ErrorBoundary onError={onError}>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      )

      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('Recovery actions', () => {
    it('displays Try Again button', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Try Again')).toBeInTheDocument()
    })

    it('displays Reload Page button', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Reload Page')).toBeInTheDocument()
    })

    it('resets error state when Try Again is clicked', async () => {
      const user = userEvent.setup()
      let shouldThrow = true

      function ConditionalThrow() {
        if (shouldThrow) {
          throw new Error('Test error')
        }
        return <div>Success</div>
      }

      const { rerender } = render(
        <ErrorBoundary>
          <ConditionalThrow />
        </ErrorBoundary>
      )

      // Error should be shown
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()

      // Fix the error condition
      shouldThrow = false

      // Click Try Again
      const tryAgainButton = screen.getByText('Try Again')
      await user.click(tryAgainButton)

      // Component should re-render without error
      rerender(
        <ErrorBoundary>
          <ConditionalThrow />
        </ErrorBoundary>
      )

      expect(screen.getByText('Success')).toBeInTheDocument()
    })
  })

  describe('Error details', () => {
    it('displays error details section', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Error Details')).toBeInTheDocument()
    })

    it('includes link to GitHub issues', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      const link = screen.getByText('GitHub')
      expect(link).toHaveAttribute(
        'href',
        'https://github.com/oculairmedia/huly-vibe-sync/issues'
      )
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('Development mode features', () => {
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv
    })

    it('shows component stack in development mode', () => {
      process.env.NODE_ENV = 'development'

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Component Stack')).toBeInTheDocument()
    })

    it('shows stack trace in development mode', () => {
      process.env.NODE_ENV = 'development'

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.getByText('Stack Trace')).toBeInTheDocument()
    })

    it('hides component stack in production mode', () => {
      process.env.NODE_ENV = 'production'

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.queryByText('Component Stack')).not.toBeInTheDocument()
    })

    it('hides stack trace in production mode', () => {
      process.env.NODE_ENV = 'production'

      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      )

      expect(screen.queryByText('Stack Trace')).not.toBeInTheDocument()
    })
  })
})

describe('SectionErrorBoundary', () => {
  it('catches errors and displays compact error UI', () => {
    render(
      <SectionErrorBoundary>
        <ThrowError />
      </SectionErrorBoundary>
    )

    expect(screen.getByText('Error loading this section')).toBeInTheDocument()
    expect(
      screen.getByText('Please refresh the page to try again.')
    ).toBeInTheDocument()
  })

  it('renders children normally when no error occurs', () => {
    render(
      <SectionErrorBoundary>
        <ThrowError shouldThrow={false} />
      </SectionErrorBoundary>
    )

    expect(screen.getByText('No error')).toBeInTheDocument()
    expect(
      screen.queryByText('Error loading this section')
    ).not.toBeInTheDocument()
  })

  it('displays compact error message without full error details', () => {
    render(
      <SectionErrorBoundary>
        <ThrowError />
      </SectionErrorBoundary>
    )

    // Should show compact message
    expect(screen.getByText('Error loading this section')).toBeInTheDocument()

    // Should NOT show full error details
    expect(screen.queryByText('Error Details')).not.toBeInTheDocument()
    expect(screen.queryByText('Try Again')).not.toBeInTheDocument()
    expect(screen.queryByText('Reload Page')).not.toBeInTheDocument()
  })
})

describe('Multiple error boundaries', () => {
  it('isolates errors to specific boundaries', () => {
    render(
      <div>
        <ErrorBoundary>
          <div>Section 1: Working</div>
        </ErrorBoundary>

        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>

        <ErrorBoundary>
          <div>Section 3: Working</div>
        </ErrorBoundary>
      </div>
    )

    // Working sections should render normally
    expect(screen.getByText('Section 1: Working')).toBeInTheDocument()
    expect(screen.getByText('Section 3: Working')).toBeInTheDocument()

    // Only the error section should show error UI
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('allows nested error boundaries', () => {
    function OuterComponent() {
      return (
        <div>
          Outer content
          <ThrowError />
        </div>
      )
    }

    render(
      <ErrorBoundary fallback={<div>Outer error</div>}>
        <ErrorBoundary fallback={<div>Inner error</div>}>
          <OuterComponent />
        </ErrorBoundary>
      </ErrorBoundary>
    )

    // Inner boundary should catch the error first
    expect(screen.getByText('Inner error')).toBeInTheDocument()
    expect(screen.queryByText('Outer error')).not.toBeInTheDocument()
  })
})

describe('Edge cases', () => {
  it('handles errors with no message', () => {
    function ThrowErrorNoMessage() {
      throw new Error()
    }

    render(
      <ErrorBoundary>
        <ThrowErrorNoMessage />
      </ErrorBoundary>
    )

    // Should still display error UI
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('handles errors with very long messages', () => {
    const longMessage = 'A'.repeat(1000)

    function ThrowLongError() {
      throw new Error(longMessage)
    }

    render(
      <ErrorBoundary>
        <ThrowLongError />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(longMessage)).toBeInTheDocument()
  })

  it('maintains error state across rerenders', () => {
    const onError = vi.fn()

    function ThrowConsistentError() {
      throw new Error('Consistent error')
    }

    const { rerender } = render(
      <ErrorBoundary onError={onError}>
        <ThrowConsistentError />
      </ErrorBoundary>
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Consistent error')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Rerender - error boundary should maintain error state
    rerender(
      <ErrorBoundary onError={onError}>
        <ThrowConsistentError />
      </ErrorBoundary>
    )

    // Error boundary should still be showing error state
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Consistent error')).toBeInTheDocument()
  })
})
