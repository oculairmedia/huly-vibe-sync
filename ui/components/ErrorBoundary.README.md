# Error Boundary Documentation

## Overview

The `ErrorBoundary` component catches React component errors and prevents them from crashing the entire application. Instead, it displays a user-friendly error message with recovery options.

## Features

- 🛡️ **Full App Protection**: Catches errors anywhere in the component tree
- 🎨 **User-Friendly UI**: Clean error display with actionable recovery options
- 🔍 **Development Tools**: Stack traces and component stack in development mode
- 🔄 **Recovery Options**: Try again or reload page buttons
- 📊 **Error Reporting**: Extensible for integration with error tracking services (Sentry, etc.)
- 📦 **Section Boundaries**: Lightweight boundaries for specific UI sections

## Usage

### App-Level Protection (Automatic)

The `ErrorBoundary` is already integrated in `app/providers.tsx` and wraps the entire application:

```tsx
// app/providers.tsx
<ErrorBoundary onError={handleError}>
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
</ErrorBoundary>
```

This catches all errors in the application automatically.

### Section-Level Protection

For specific sections that might fail independently:

```tsx
import { SectionErrorBoundary } from '@/components/ErrorBoundary'

function Dashboard() {
  return (
    <div>
      <SectionErrorBoundary>
        <RiskySectionComponent />
      </SectionErrorBoundary>

      <SectionErrorBoundary>
        <AnotherRiskySectionComponent />
      </SectionErrorBoundary>
    </div>
  )
}
```

This allows other sections to continue working even if one section fails.

### Custom Fallback UI

```tsx
import { ErrorBoundary } from '@/components/ErrorBoundary'

function MyComponent() {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 bg-red-50 border border-red-200 rounded">
          <p>Custom error message</p>
        </div>
      }
    >
      <ComponentThatMightError />
    </ErrorBoundary>
  )
}
```

### Error Logging

The error handler in `providers.tsx` can be extended to send errors to monitoring services:

```tsx
const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
  // Development logging
  if (process.env.NODE_ENV === 'development') {
    console.error('Application Error:', error)
    console.error('Error Info:', errorInfo)
  }

  // Production error tracking
  // Sentry.captureException(error, { extra: errorInfo })
  // LogRocket.captureException(error)
  // Custom analytics service
}
```

## Testing

### Using the Error Test Component (Development Only)

```tsx
import { ErrorTestComponent } from '@/components/__tests__/ErrorTestComponent'

// Test render errors
<ErrorTestComponent errorType="render" />

// Test click handler errors
<ErrorTestComponent errorType="click" />

// Test async errors (note: may not be caught)
<ErrorTestComponent errorType="async" />
```

### Manual Testing

1. Navigate to your app
2. Add the `ErrorTestComponent` temporarily to any page
3. Click the error trigger button
4. Verify the error boundary displays correctly
5. Test the "Try Again" and "Reload Page" buttons
6. Remove the test component when done

## Error Types Caught

✅ **Caught by Error Boundary:**
- Render errors (during component rendering)
- Lifecycle method errors
- Constructor errors
- Event handler errors (click, submit, etc.)

❌ **NOT Caught by Error Boundary:**
- Async errors (use try-catch instead)
- Server-side errors (Next.js error.tsx handles these)
- Event handlers with async operations (wrap in try-catch)
- Errors in error boundary itself

## Best Practices

1. **Use Try-Catch for Async**: Error boundaries don't catch async errors
   ```tsx
   const handleAsync = async () => {
     try {
       await riskyAsyncOperation()
     } catch (error) {
       setError(error)
     }
   }
   ```

2. **Multiple Boundaries**: Use multiple boundaries to isolate failures
   ```tsx
   <ErrorBoundary>
     <CriticalSection />
     <ErrorBoundary>
       <OptionalSection />
     </ErrorBoundary>
   </ErrorBoundary>
   ```

3. **Error Reporting**: Integrate with error tracking services in production

4. **User Communication**: Provide clear recovery steps in error messages

## Integration with Monitoring

### Sentry Example

```typescript
// app/providers.tsx
import * as Sentry from '@sentry/nextjs'

const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
  Sentry.captureException(error, {
    contexts: {
      react: {
        componentStack: errorInfo.componentStack,
      },
    },
  })
}
```

### Custom Service Example

```typescript
const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
  fetch('/api/errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    }),
  })
}
```

## Component API

### ErrorBoundary Props

```typescript
interface Props {
  children: ReactNode          // Components to protect
  fallback?: ReactNode         // Custom error UI
  onError?: (                  // Error handler callback
    error: Error,
    errorInfo: ErrorInfo
  ) => void
}
```

### SectionErrorBoundary Props

```typescript
interface Props {
  children: ReactNode          // Components to protect
}
```

## Files

- `components/ErrorBoundary.tsx` - Main error boundary component
- `components/__tests__/ErrorTestComponent.tsx` - Test component (dev only)
- `app/providers.tsx` - Error boundary integration
- `components/ErrorBoundary.README.md` - This documentation

## Resources

- [React Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [Next.js Error Handling](https://nextjs.org/docs/app/building-your-application/routing/error-handling)
- [Sentry React Integration](https://docs.sentry.io/platforms/javascript/guides/react/)
