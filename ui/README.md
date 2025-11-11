# Huly-Vibe Sync Dashboard

Modern, real-time web dashboard for monitoring and managing the Huly-Vibe bidirectional synchronization service.

## Features

- **Real-time Monitoring**: Live sync status updates via Server-Sent Events (SSE)
- **Health Metrics**: System health, memory usage, uptime, and connection pool stats
- **Manual Sync Control**: Trigger synchronization on-demand
- **Configuration Management**: Update sync settings dynamically
- **Type-Safe**: Full TypeScript support with end-to-end type safety
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Accessible**: WCAG 2.1 AA compliant components

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **UI Library**: React 18
- **Styling**: Tailwind CSS 3
- **Components**: shadcn/ui + Radix UI
- **State Management**: TanStack Query (server state) + Zustand (client state)
- **Type Safety**: TypeScript 5
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Backend service running on `http://localhost:3099`

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Update .env.local with your backend URL
# NEXT_PUBLIC_API_URL=http://localhost:3099
```

### Development

```bash
# Start development server
npm run dev

# Open http://localhost:3000
```

### Build for Production

```bash
# Build optimized production bundle
npm run build

# Start production server
npm start
```

### Type Checking

```bash
# Run TypeScript type checker
npm run type-check
```

### Linting

```bash
# Run ESLint
npm run lint
```

### Testing

```bash
# Run tests with Vitest
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Project Structure

```
ui/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Dashboard page
│   ├── globals.css         # Global styles
│   └── providers.tsx       # React Query provider
├── components/
│   ├── ui/                 # Base UI components (shadcn/ui)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   └── skeleton.tsx
│   └── dashboard/          # Dashboard-specific components
│       ├── SyncStatusCard.tsx
│       ├── HealthMetrics.tsx
│       ├── QuickActions.tsx
│       └── ConnectionStatus.tsx
├── lib/
│   ├── api/                # API client layer
│   │   └── client.ts       # Base fetch wrapper
│   ├── hooks/              # Custom React hooks
│   │   ├── useHealth.ts
│   │   ├── useConfig.ts
│   │   ├── useSyncTrigger.ts
│   │   └── useRealtimeEvents.ts
│   ├── types.ts            # TypeScript types
│   └── utils.ts            # Utility functions
├── public/                 # Static assets
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.js
```

## API Endpoints

The dashboard connects to the following backend endpoints:

### Health & Metrics
- `GET /health` - Service health check
- `GET /metrics` - Prometheus metrics
- `GET /api/stats` - Human-readable statistics

### Configuration
- `GET /api/config` - Get current configuration
- `PATCH /api/config` - Update configuration
- `POST /api/config/reset` - Reset to defaults

### Sync Control
- `POST /api/sync/trigger` - Trigger manual sync

### Sync History
- `GET /api/sync/history` - Get sync history (paginated)
- `GET /api/sync/mappings` - Get Huly ↔ Vibe mappings

### Real-time Events (SSE)
- `GET /api/events/stream` - Server-Sent Events stream

## Real-time Events

The dashboard uses Server-Sent Events (SSE) for real-time updates:

### Event Types

- `connected` - Client connected to stream
- `sync:started` - Sync cycle started
- `sync:completed` - Sync cycle completed
- `sync:error` - Error during sync
- `config:updated` - Configuration changed
- `health:updated` - Health metrics updated

### Example Event

```json
{
  "type": "sync:completed",
  "data": {
    "projectId": null,
    "duration": 5432,
    "status": "success",
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

## Configuration

### Environment Variables

```bash
# Backend API URL (required)
NEXT_PUBLIC_API_URL=http://localhost:3099

# Application name (optional)
NEXT_PUBLIC_APP_NAME="Huly-Vibe Sync Dashboard"

# Polling interval in milliseconds (optional, default: 5000)
NEXT_PUBLIC_POLLING_INTERVAL=5000
```

## Deployment

### Docker

```bash
# Build Docker image
docker build -t huly-vibe-sync-ui .

# Run container
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://localhost:3099 \
  huly-vibe-sync-ui
```

### Vercel

```bash
# Deploy to Vercel
npm i -g vercel
vercel
```

### Static Export (Optional)

```bash
# Build static export
npm run build

# Serve static files from /out directory
```

## Development Guide

### Adding New Components

1. Create component in `components/ui/` or `components/dashboard/`
2. Follow shadcn/ui patterns for consistency
3. Add JSDoc comments for documentation
4. Ensure accessibility (ARIA labels, keyboard navigation)

### Adding New API Endpoints

1. Add TypeScript types in `lib/types.ts`
2. Create hook in `lib/hooks/`
3. Use TanStack Query for caching and refetching

### Styling Guidelines

- Use Tailwind CSS utility classes
- Follow shadcn/ui design system
- Use `cn()` helper for conditional classes
- Mobile-first responsive design

## Troubleshooting

### Backend Connection Issues

- Verify `NEXT_PUBLIC_API_URL` in `.env.local`
- Check backend is running on correct port
- Ensure CORS is enabled on backend

### SSE Connection Fails

- Check browser console for errors
- Verify `/api/events/stream` endpoint is accessible
- Check network tab for SSE connection status

### Build Errors

```bash
# Clear Next.js cache
rm -rf .next

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Make changes with tests
4. Run linter and type checker
5. Commit changes (`git commit -m 'feat: add new feature'`)
6. Push to branch (`git push origin feature/new-feature`)
7. Open a Pull Request

## License

MIT

## Support

For issues or questions:
- Open a GitHub issue
- Check documentation in `/docs`
- Review API documentation

---

**Last Updated**: 2025-11-11
**Version**: 1.0.0
