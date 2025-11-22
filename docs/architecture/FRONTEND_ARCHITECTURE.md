# Huly-Vibe Sync Frontend Architecture

## Overview

This document describes the architecture of the Huly-Vibe Sync management dashboard - a modern web-based UI for monitoring and configuring the bidirectional synchronization service.

## Architecture Principles

1. **Modularity**: Clear separation of concerns with reusable components
2. **Type Safety**: End-to-end TypeScript for compile-time error detection
3. **Real-time**: Live updates via Server-Sent Events (SSE)
4. **Performance**: Optimistic updates, intelligent caching, lazy loading
5. **Accessibility**: WCAG 2.1 AA compliant components via Radix UI
6. **Documentation**: Comprehensive inline docs and component stories

---

## Tech Stack

### Frontend Framework
- **Next.js 14** (App Router) - React framework with SSR/SSG
- **React 18** - UI library with concurrent rendering
- **TypeScript 5** - Type-safe JavaScript

### UI Layer
- **shadcn/ui** - Accessible, customizable component library
- **Radix UI** - Headless UI primitives (dialogs, dropdowns, etc.)
- **Tailwind CSS 3** - Utility-first CSS framework
- **Lucide React** - Icon library

### Data Management
- **TanStack Query v5** - Server state management, caching, refetching
- **Zustand** - Client state management (filters, UI state)
- **Zod** - Runtime type validation for API responses

### Data Visualization
- **Recharts** - Charting library for metrics visualization
- **date-fns** - Date manipulation for time-series data

### Real-time Communication
- **Server-Sent Events (SSE)** - Push updates from backend
- **EventSource API** - Browser-native SSE client

---

## Project Structure

```
ui/                                    # Frontend application root
├── app/                               # Next.js App Router
│   ├── (dashboard)/                   # Dashboard layout group
│   │   ├── layout.tsx                 # Shared dashboard layout
│   │   ├── page.tsx                   # Main dashboard (/)
│   │   ├── config/
│   │   │   └── page.tsx               # Configuration UI (/config)
│   │   ├── history/
│   │   │   └── page.tsx               # Sync history (/history)
│   │   └── projects/
│   │       └── page.tsx               # Project management (/projects)
│   ├── api/                           # API route handlers (proxy to backend)
│   │   └── proxy/[...path]/route.ts   # Proxy all requests to backend
│   ├── layout.tsx                     # Root layout
│   ├── globals.css                    # Global styles
│   └── providers.tsx                  # React context providers
│
├── components/                        # React components
│   ├── ui/                            # shadcn/ui base components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── chart.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── table.tsx
│   │   └── ...
│   │
│   ├── dashboard/                     # Dashboard-specific components
│   │   ├── SyncStatusCard.tsx         # Displays current sync status
│   │   ├── HealthMetrics.tsx          # System health indicators
│   │   ├── PerformanceChart.tsx       # API latency & throughput charts
│   │   ├── ErrorLogViewer.tsx         # Recent errors & warnings
│   │   └── QuickActions.tsx           # Manual sync triggers
│   │
│   ├── config/                        # Configuration components
│   │   ├── ConfigForm.tsx             # Main config form
│   │   ├── SyncIntervalControl.tsx    # Adjust sync intervals
│   │   ├── ParallelismControl.tsx     # Worker pool settings
│   │   └── FeatureFlagToggle.tsx      # DRY_RUN, INCREMENTAL_SYNC, etc.
│   │
│   ├── history/                       # Sync history components
│   │   ├── SyncTimeline.tsx           # Timeline view of syncs
│   │   ├── IssueMappingTable.tsx      # Huly ↔ Vibe mappings
│   │   └── ConflictResolver.tsx       # Manual conflict resolution
│   │
│   └── shared/                        # Shared/common components
│       ├── Header.tsx                 # App header with navigation
│       ├── Sidebar.tsx                # Sidebar navigation
│       ├── LoadingSpinner.tsx         # Loading states
│       └── ErrorBoundary.tsx          # Error boundaries
│
├── lib/                               # Utility libraries
│   ├── api/                           # API client layer
│   │   ├── client.ts                  # Base fetch wrapper with retry logic
│   │   ├── endpoints/                 # Endpoint-specific clients
│   │   │   ├── health.ts              # GET /health
│   │   │   ├── metrics.ts             # GET /metrics
│   │   │   ├── config.ts              # GET/PATCH /config
│   │   │   ├── sync.ts                # POST /sync/trigger
│   │   │   ├── history.ts             # GET /sync/history
│   │   │   └── events.ts              # SSE /events/stream
│   │   └── types.ts                   # Shared API types
│   │
│   ├── hooks/                         # Custom React hooks
│   │   ├── useHealth.ts               # Fetch & poll health data
│   │   ├── useMetrics.ts              # Fetch & poll metrics
│   │   ├── useConfig.ts               # Get/update config
│   │   ├── useSyncHistory.ts          # Fetch sync history
│   │   ├── useRealtimeEvents.ts       # SSE event stream
│   │   └── useSyncTrigger.ts          # Manual sync trigger
│   │
│   ├── stores/                        # Zustand stores
│   │   ├── uiStore.ts                 # UI state (filters, selected items)
│   │   └── realtimeStore.ts           # Real-time event stream state
│   │
│   ├── utils/                         # Helper utilities
│   │   ├── formatters.ts              # Date, number, status formatters
│   │   ├── validators.ts              # Zod schemas for validation
│   │   ├── cn.ts                      # Tailwind class merger
│   │   └── constants.ts               # App-wide constants
│   │
│   └── types/                         # TypeScript type definitions
│       ├── api.ts                     # API request/response types
│       ├── domain.ts                  # Domain models (Project, Issue, Task)
│       └── ui.ts                      # UI-specific types
│
├── public/                            # Static assets
│   ├── favicon.ico
│   └── images/
│
├── docs/                              # Documentation
│   ├── COMPONENTS.md                  # Component API documentation
│   ├── API_CLIENT.md                  # API client usage guide
│   ├── DEPLOYMENT.md                  # Deployment instructions
│   └── DEVELOPMENT.md                 # Local development guide
│
├── package.json                       # Dependencies & scripts
├── tsconfig.json                      # TypeScript configuration
├── tailwind.config.ts                 # Tailwind CSS configuration
├── next.config.js                     # Next.js configuration
├── .env.example                       # Environment variables template
└── README.md                          # Project overview
```

---

## Backend API Extensions

The backend will be extended with new endpoints to support the frontend:

### 1. Configuration Management
```
GET  /api/config          - Get current configuration
PATCH /api/config         - Update configuration (partial)
POST /api/config/reset    - Reset to defaults
```

### 2. Manual Sync Control
```
POST /api/sync/trigger              - Trigger immediate full sync
POST /api/sync/trigger/:projectId   - Trigger sync for specific project
POST /api/sync/stop                 - Stop current sync (graceful)
```

### 3. Sync History & Audit
```
GET /api/sync/history                    - Get sync history (paginated)
GET /api/sync/history/:syncId            - Get specific sync details
GET /api/sync/mappings                   - Get Huly ↔ Vibe mappings
GET /api/sync/mappings/:hulyIdentifier   - Get mapping for specific issue
```

### 4. Real-time Events (SSE)
```
GET /api/events/stream    - Server-Sent Events stream
```

Event types:
- `sync:started` - Sync cycle started
- `sync:completed` - Sync cycle completed
- `sync:error` - Error during sync
- `config:updated` - Configuration changed
- `health:updated` - Health metrics updated

### 5. Enhanced Health & Metrics
```
GET /health         - Enhanced with more detail
GET /metrics        - Prometheus format (existing)
GET /api/stats      - Human-readable JSON stats
```

---

## Data Flow Architecture

### 1. Initial Page Load (SSR)
```
Browser Request
  ↓
Next.js Server
  ↓
Fetch initial data from Backend API (/health, /config)
  ↓
Render HTML with data
  ↓
Stream to Browser
  ↓
Hydrate React app
```

### 2. Client-side Updates (Polling + SSE)
```
React Component Mount
  ↓
TanStack Query (useHealth, useMetrics hooks)
  ↓
Poll backend every 5s (configurable)
  ↓
Update UI optimistically
  ↓
SSE stream for instant updates
  ↓
Zustand store for real-time state
```

### 3. Configuration Changes
```
User edits config form
  ↓
Zod validation (client-side)
  ↓
Optimistic UI update
  ↓
PATCH /api/config (with retry logic)
  ↓
Backend validates & applies
  ↓
SSE event: config:updated
  ↓
Refetch affected data (useHealth invalidation)
```

### 4. Manual Sync Trigger
```
User clicks "Sync Now"
  ↓
POST /api/sync/trigger
  ↓
Backend starts sync
  ↓
SSE events: sync:started, sync:progress, sync:completed
  ↓
Real-time progress bar updates
  ↓
Refetch history & mappings
```

---

## Component Architecture

### Atomic Design Hierarchy

1. **Atoms** (`components/ui/`)
   - Basic building blocks (Button, Input, Card)
   - No business logic, purely presentational
   - Fully accessible (Radix UI primitives)

2. **Molecules** (`components/shared/`)
   - Combinations of atoms (LoadingSpinner + Text)
   - Minimal logic, reusable across domains

3. **Organisms** (`components/dashboard/`, `components/config/`, etc.)
   - Complex components with business logic
   - Connected to API via hooks
   - Domain-specific (SyncStatusCard, ConfigForm)

4. **Templates** (`app/(dashboard)/layout.tsx`)
   - Page layouts with navigation, header, footer
   - Slot-based composition

5. **Pages** (`app/(dashboard)/page.tsx`)
   - Top-level routes
   - Orchestrate organisms
   - Handle page-level state

---

## State Management Strategy

### Server State (TanStack Query)
- API responses (health, metrics, config, history)
- Automatic caching with configurable TTL
- Background refetching
- Optimistic updates
- Retry logic with exponential backoff

**Example:**
```typescript
const { data: health, isLoading, error } = useHealth({
  refetchInterval: 5000,  // Poll every 5s
  staleTime: 3000,        // Cache for 3s
})
```

### Client State (Zustand)
- UI state (sidebar open/closed, selected filters)
- Real-time event stream state
- Transient notifications/toasts

**Example:**
```typescript
const { filters, setFilter } = useUIStore()
const { events, addEvent } = useRealtimeStore()
```

### Form State (React Hook Form + Zod)
- Form inputs, validation errors
- Managed locally per form component

---

## Real-time Updates (SSE)

### EventSource Connection
```typescript
// lib/hooks/useRealtimeEvents.ts
const eventSource = new EventSource('/api/events/stream')

eventSource.addEventListener('sync:started', (e) => {
  const data = JSON.parse(e.data)
  // Update UI to show sync in progress
})

eventSource.addEventListener('health:updated', (e) => {
  // Invalidate health query to refetch
  queryClient.invalidateQueries(['health'])
})
```

### Reconnection Strategy
- Auto-reconnect on disconnect
- Exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Visual indicator for connection status

---

## Performance Optimization

### 1. Code Splitting
- Route-based splitting (automatic with App Router)
- Dynamic imports for heavy components (charts)
- Lazy load modals/dialogs

### 2. Caching Strategy
- TanStack Query cache (in-memory)
- Next.js HTTP cache (Edge/CDN)
- Service Worker for offline support (future)

### 3. Rendering Strategy
- SSR for initial dashboard (fast FCP)
- Client-side for interactive components
- Streaming for slow data (React Suspense)

### 4. Bundle Optimization
- Tree-shaking (ES modules)
- Minification (SWC)
- Image optimization (next/image)

---

## Security Considerations

### 1. API Security
- CORS configuration (restrict origins)
- Rate limiting (backend)
- Input validation (Zod schemas)

### 2. Authentication (Future)
- JWT-based auth
- HTTP-only cookies
- Role-based access control (RBAC)

### 3. XSS Prevention
- React auto-escapes content
- CSP headers (Content Security Policy)
- Validate all user inputs

---

## Error Handling

### 1. API Errors
```typescript
try {
  const data = await apiClient.patch('/api/config', updates)
} catch (error) {
  if (error instanceof ApiError) {
    // Show user-friendly error message
    toast.error(error.message)
  } else {
    // Log to error tracking service
    Sentry.captureException(error)
  }
}
```

### 2. Component Errors
- React Error Boundaries for component crashes
- Fallback UI with retry button
- Automatic error reporting

### 3. Network Errors
- Retry logic with exponential backoff
- Offline mode detection
- Queue mutations for retry when back online

---

## Accessibility (a11y)

### WCAG 2.1 AA Compliance
- ✅ Keyboard navigation (all interactive elements)
- ✅ Screen reader support (ARIA labels)
- ✅ Focus management (modals, dropdowns)
- ✅ Color contrast ratios (4.5:1 minimum)
- ✅ Responsive text sizing

### Testing
- Automated: `axe-core` in tests
- Manual: VoiceOver, NVDA testing

---

## Testing Strategy

### 1. Unit Tests (Vitest)
- Utility functions
- Custom hooks (with `@testing-library/react-hooks`)
- Type validators (Zod schemas)

### 2. Component Tests (React Testing Library)
- Render tests (smoke tests)
- Interaction tests (click, type, submit)
- Accessibility tests (a11y checks)

### 3. Integration Tests
- API client (with MSW for mocking)
- End-to-end flows (page navigation)

### 4. E2E Tests (Playwright - Future)
- Critical user journeys
- Cross-browser testing

---

## Deployment Architecture

### Development
```
Developer Machine
  ↓
npm run dev (Next.js dev server on :3000)
  ↓
Proxy API calls to Backend (:3099)
```

### Production (Option A: Separate Deployment)
```
Backend Service (Node.js)
  ↓ Port 3099
  ↓
Reverse Proxy (nginx)
  ↓
Frontend (Vercel/Netlify)
  ↓ HTTPS
  ↓
Users
```

### Production (Option B: Integrated)
```
Backend Service (Node.js)
  ↓ Port 3099 (API)
  ↓ Port 3000 (Static Frontend via express.static)
  ↓
Reverse Proxy (nginx)
  ↓ HTTPS
  ↓
Users
```

---

## Development Workflow

### 1. Local Development
```bash
# Terminal 1: Backend
cd /home/user/huly-vibe-sync
npm run dev

# Terminal 2: Frontend
cd /home/user/huly-vibe-sync/ui
npm run dev
```

### 2. Making Changes
1. Create feature branch: `git checkout -b feature/new-component`
2. Make changes with hot reload
3. Write tests
4. Run linter: `npm run lint`
5. Run tests: `npm test`
6. Commit: `git commit -m "feat: add new component"`
7. Push: `git push origin feature/new-component`

### 3. Code Review Checklist
- [ ] TypeScript types defined
- [ ] Component documented (JSDoc)
- [ ] Accessible (keyboard, screen reader)
- [ ] Tests written (>80% coverage)
- [ ] Error handling implemented
- [ ] Loading states handled
- [ ] Responsive design (mobile, tablet, desktop)

---

## Monitoring & Observability

### 1. Frontend Metrics
- Page load time (Core Web Vitals)
- API call success/failure rates
- Client-side errors
- User interactions

### 2. Backend Metrics (Existing)
- Sync performance
- API latency
- Memory/CPU usage
- Database query time

### 3. Tools
- **Sentry** - Error tracking
- **Vercel Analytics** - Performance monitoring
- **Prometheus + Grafana** - Backend metrics

---

## Future Enhancements

### Phase 4: Advanced Features
- [ ] Letta AI agent insights UI
- [ ] Advanced conflict resolution
- [ ] Bulk operations (re-sync multiple projects)
- [ ] Custom sync rules (filters, transformations)
- [ ] Webhook integrations
- [ ] Mobile app (React Native reuse)

### Phase 5: Enterprise Features
- [ ] Multi-user authentication
- [ ] Role-based access control
- [ ] Audit logs with retention
- [ ] SSO integration (SAML, OAuth)
- [ ] White-labeling support

---

## References

- [Next.js Docs](https://nextjs.org/docs)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [TanStack Query Guide](https://tanstack.com/query/latest)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [React Accessibility Guide](https://react.dev/learn/accessibility)

---

## Support

For questions or issues:
1. Check component documentation in `/docs/COMPONENTS.md`
2. Review API client guide in `/docs/API_CLIENT.md`
3. Open an issue on GitHub
4. Contact the maintainers

---

**Last Updated:** 2025-11-11
**Version:** 1.0.0
**Authors:** Huly-Vibe Sync Team
