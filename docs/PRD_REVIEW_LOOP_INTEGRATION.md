# Product Requirements Document: Vibe Kanban Review Loop Integration

**Version:** 1.0.0  
**Date:** November 17, 2025  
**Status:** Draft - Ready for Implementation  
**Author:** System Architecture Team  
**Stakeholders:** Development Team, Project Management, DevOps

---

## Executive Summary

This PRD defines the implementation of a **real-time review notification system** that closes the loop between Vibe Kanban task execution and Letta PM agent oversight. When a coding agent completes a task and moves it to "InReview" status, the system will automatically notify the project's Letta PM agent to perform code review, provide feedback, or approve the work.

### Key Benefits

- **Automated Review Workflow**: No manual checking required - PM agents are notified instantly
- **Faster Iteration Cycles**: Real-time notifications reduce review latency from hours to seconds
- **Complete Audit Trail**: All review requests and responses tracked in both systems
- **Test-Driven Approach**: Comprehensive test suite ensures reliability and maintainability

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Goals and Success Metrics](#goals-and-success-metrics)
3. [Technical Architecture](#technical-architecture)
4. [Implementation Plan](#implementation-plan)
5. [Test-Driven Development Strategy](#test-driven-development-strategy)
6. [API Specifications](#api-specifications)
7. [Data Models](#data-models)
8. [Error Handling](#error-handling)
9. [Monitoring and Observability](#monitoring-and-observability)
10. [Security Considerations](#security-considerations)
11. [Rollout Plan](#rollout-plan)
12. [Appendices](#appendices)

---

## 1. Problem Statement

### Current State

The huly-vibe-sync service currently provides **bidirectional synchronization** between Huly and Vibe Kanban:

- ✅ Task status changes sync in both directions
- ✅ Task creation and updates propagate automatically
- ✅ Letta PM agents receive project context and board metrics
- ❌ **No automatic notification when tasks need review**
- ❌ Manual checking required to know when work is complete
- ❌ Review loop is disconnected from the workflow

### Desired State

When a coding agent completes work on a task and moves it to "InReview" status:

1. The Letta PM agent for that project is **immediately notified**
2. The agent receives **complete task context** (title, description, changes, branch info)
3. The agent can **respond with feedback** or approval
4. Feedback flows back to the coding agent for iteration
5. All interactions are **logged and auditable**

### Impact

**Without this feature:**
- PM agents don't know when to perform reviews
- Tasks sit in "InReview" status indefinitely
- Manual monitoring required
- Slower feedback cycles

**With this feature:**
- Instant review notifications
- Automated workflow orchestration
- Faster iteration and approval cycles
- Complete task lifecycle automation

---

## 2. Goals and Success Metrics

### Primary Goals

1. **Real-time Review Notifications** - Notify PM agents within 1 second of status change
2. **High Reliability** - 99.9% successful notification delivery
3. **Complete Context** - Include all relevant task information in notifications
4. **Bidirectional Communication** - Allow PM agents to respond with feedback
5. **Resilient Architecture** - Handle failures gracefully with retry logic

### Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Notification Latency | < 1 second | Time from status change to agent message sent |
| Delivery Success Rate | ≥ 99.9% | Successful notifications / total status changes |
| System Uptime | ≥ 99.5% | SSE connection uptime percentage |
| Test Coverage | ≥ 90% | Code coverage for new review loop module |
| Error Recovery Time | < 30 seconds | Time to reconnect after connection failure |

### Non-Goals (Out of Scope)

- ❌ Code review AI/automation (handled by PM agents)
- ❌ Direct GitHub PR integration (future enhancement)
- ❌ UI for review workflow (uses existing Huly/Vibe interfaces)
- ❌ Multi-agent review consensus (future enhancement)

---

## 3. Technical Architecture

### 3.1 System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         Vibe Kanban                              │
│  ┌────────────────┐         ┌──────────────────────────┐        │
│  │ Coding Agent   │────────>│  Task Status: InReview   │        │
│  │  (Claude/etc)  │         │  (Git branch created)    │        │
│  └────────────────┘         └──────────────────────────┘        │
│                                        │                         │
│                                        │ Database Write          │
│                                        ↓                         │
│                             ┌────────────────────┐              │
│                             │  SQLite Database   │              │
│                             │  (Task Events)     │              │
│                             └────────────────────┘              │
│                                        │                         │
│                                        │ SSE Broadcast           │
│                                        ↓                         │
│                             ┌────────────────────┐              │
│                             │ Event Service      │              │
│                             │ /api/events (SSE)  │              │
│                             └────────────────────┘              │
└────────────────────────────────────────┼─────────────────────────┘
                                         │
                                         │ EventSource Connection
                                         ↓
┌──────────────────────────────────────────────────────────────────┐
│                     Huly-Vibe-Sync Service                       │
│  ┌────────────────────────────────────────────────────┐         │
│  │           Review Loop Notification Module          │         │
│  │  ┌──────────────────────────────────────────────┐ │         │
│  │  │  1. SSE Event Consumer                       │ │         │
│  │  │     - Subscribe to /api/events               │ │         │
│  │  │     - Filter for task status changes         │ │         │
│  │  │     - Parse EventPatch JSON                  │ │         │
│  │  └──────────────────────────────────────────────┘ │         │
│  │  ┌──────────────────────────────────────────────┐ │         │
│  │  │  2. Review Notification Service              │ │         │
│  │  │     - Detect "inreview" status               │ │         │
│  │  │     - Fetch additional task context          │ │         │
│  │  │     - Build notification payload             │ │         │
│  │  └──────────────────────────────────────────────┘ │         │
│  │  ┌──────────────────────────────────────────────┐ │         │
│  │  │  3. Notification Queue                       │ │         │
│  │  │     - In-memory queue with disk persistence  │ │         │
│  │  │     - Retry logic with exponential backoff   │ │         │
│  │  │     - Dead letter queue for failures         │ │         │
│  │  └──────────────────────────────────────────────┘ │         │
│  └────────────────────────────────────────────────────┘         │
└────────────────────────────────────┼─────────────────────────────┘
                                     │
                                     │ Letta Agent API
                                     ↓
┌──────────────────────────────────────────────────────────────────┐
│                        Letta Platform                            │
│  ┌────────────────────────────────────────────────────┐         │
│  │  PM Agent for Project X                            │         │
│  │  ┌──────────────────────────────────────────────┐ │         │
│  │  │ Receives Message:                            │ │         │
│  │  │ "Task 'Feature X' is ready for review"      │ │         │
│  │  │                                              │ │         │
│  │  │ - Check Vibe Kanban API for task details    │ │         │
│  │  │ - Check Huly API for issue context          │ │         │
│  │  │ - Review git diff (via tools)               │ │         │
│  │  │ - Provide feedback or approval              │ │         │
│  │  └──────────────────────────────────────────────┘ │         │
│  └────────────────────────────────────────────────────┘         │
│                                     │                            │
│                                     │ Update Issue Status        │
│                                     ↓                            │
│  ┌────────────────────────────────────────────────────┐         │
│  │  Huly Issue Updated                                │         │
│  │  - Status: Done (if approved)                      │         │
│  │  - Comments: Feedback from PM agent                │         │
│  └────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Bidirectional Sync
                                     ↓
                         ┌─────────────────────┐
                         │ Vibe Kanban Task    │
                         │ Status: Done        │
                         └─────────────────────┘
```

### 3.2 Component Breakdown

#### 3.2.1 SSE Event Consumer

**Responsibility:** Maintain persistent connection to Vibe Kanban event stream

**Key Functions:**
- `connectToEventStream()` - Establish SSE connection
- `handleEvent(event)` - Process incoming event patches
- `reconnect()` - Handle connection failures with backoff

**Technologies:**
- `eventsource` npm package for SSE client
- Automatic reconnection logic
- Heartbeat monitoring

#### 3.2.2 Review Notification Service

**Responsibility:** Detect review-worthy events and prepare notifications

**Key Functions:**
- `isReviewEvent(patch)` - Determine if event requires notification
- `enrichTaskContext(taskId)` - Fetch additional task details
- `buildNotificationPayload(task)` - Create message for PM agent
- `routeToAgent(projectId, payload)` - Find and notify correct agent

**Data Sources:**
- Vibe Kanban API (`/api/tasks/{id}`)
- Vibe Kanban API (`/api/task-attempts/{id}`)
- Huly API (for issue context)
- Internal database (for agent mappings)

#### 3.2.3 Notification Queue

**Responsibility:** Ensure reliable delivery with retries

**Key Functions:**
- `enqueue(notification)` - Add to queue
- `process()` - Send notification with retry logic
- `handleFailure(notification, error)` - Move to DLQ after max retries
- `persistState()` - Save queue to disk on shutdown

**Features:**
- Exponential backoff (1s, 2s, 4s, 8s, 16s)
- Max retries: 5 attempts
- Dead letter queue for permanent failures
- Metrics for queue depth and delivery rates

---

## 4. Implementation Plan

### Phase 1: Foundation (Week 1)

**Deliverables:**
- [ ] Create `/lib/ReviewLoopService.js` module
- [ ] Implement SSE event consumer with reconnection logic
- [ ] Add event filtering for task status changes
- [ ] Write unit tests for event parsing

**Acceptance Criteria:**
- SSE connection establishes successfully
- Events are received and parsed correctly
- Connection recovers from failures within 30 seconds
- Test coverage ≥ 90%

### Phase 2: Notification Service (Week 2)

**Deliverables:**
- [ ] Implement review detection logic
- [ ] Create task context enrichment
- [ ] Build notification payload formatter
- [ ] Add agent routing logic
- [ ] Write unit tests for notification service

**Acceptance Criteria:**
- "InReview" status changes are detected correctly
- Task context includes branch, description, attempt ID
- Correct PM agent is identified for each project
- Test coverage ≥ 90%

### Phase 3: Queue and Reliability (Week 2)

**Deliverables:**
- [ ] Implement in-memory notification queue
- [ ] Add retry logic with exponential backoff
- [ ] Create dead letter queue
- [ ] Add disk persistence for queue state
- [ ] Write integration tests

**Acceptance Criteria:**
- Failed notifications retry automatically
- Queue state persists across restarts
- DLQ captures permanent failures
- Test coverage ≥ 85%

### Phase 4: Integration (Week 3)

**Deliverables:**
- [ ] Integrate with existing huly-vibe-sync service
- [ ] Add configuration options to `.env`
- [ ] Update `index.js` to start review loop service
- [ ] Add health check endpoints
- [ ] Write end-to-end tests

**Acceptance Criteria:**
- Service starts automatically with sync service
- Configuration is externalized
- Health checks report status correctly
- E2E tests pass successfully

### Phase 5: Monitoring and Deployment (Week 3)

**Deliverables:**
- [ ] Add Prometheus metrics
- [ ] Create logging for all events
- [ ] Set up alerts for failures
- [ ] Deploy to staging environment
- [ ] Document configuration and operations

**Acceptance Criteria:**
- Metrics are exported correctly
- Logs are structured and searchable
- Alerts fire for connection failures
- Documentation is complete

---

## 5. Test-Driven Development Strategy

### 5.1 Test Pyramid

```
                    ┌──────────────┐
                    │  E2E Tests   │  (5%)
                    │  - 2-3 tests │
                    └──────────────┘
                  ┌──────────────────┐
                  │ Integration Tests│  (20%)
                  │  - 10-15 tests   │
                  └──────────────────┘
              ┌────────────────────────┐
              │     Unit Tests         │  (75%)
              │     - 40-50 tests      │
              └────────────────────────┘
```

### 5.2 Unit Tests

**File:** `tests/unit/ReviewLoopService.test.js`

```javascript
describe('ReviewLoopService', () => {
  describe('Event Parsing', () => {
    it('should parse task status change events correctly', () => {
      const event = {
        op: 'replace',
        path: '/tasks/task-uuid-123',
        value: { status: 'inreview', title: 'Test Task' }
      };
      const result = parseTaskEvent(event);
      expect(result.isReviewEvent).toBe(true);
      expect(result.taskId).toBe('task-uuid-123');
    });

    it('should ignore non-review status changes', () => {
      const event = {
        op: 'replace',
        path: '/tasks/task-uuid-123',
        value: { status: 'todo' }
      };
      const result = parseTaskEvent(event);
      expect(result.isReviewEvent).toBe(false);
    });

    it('should handle malformed events gracefully', () => {
      const event = { invalid: 'data' };
      expect(() => parseTaskEvent(event)).not.toThrow();
    });
  });

  describe('Task Context Enrichment', () => {
    it('should fetch task details from Vibe API', async () => {
      const mockTask = {
        id: 'task-123',
        title: 'Test',
        description: 'Description',
        project_id: 'proj-456'
      };
      
      vibeApi.getTask.mockResolvedValue(mockTask);
      
      const context = await enrichTaskContext('task-123');
      expect(context.task).toEqual(mockTask);
    });

    it('should fetch task attempt information', async () => {
      const mockAttempt = {
        id: 'attempt-789',
        branch: 'vk/123-feature',
        executor: 'CLAUDE_CODE'
      };
      
      vibeApi.getLatestAttempt.mockResolvedValue(mockAttempt);
      
      const context = await enrichTaskContext('task-123');
      expect(context.attempt).toEqual(mockAttempt);
    });

    it('should handle missing attempt gracefully', async () => {
      vibeApi.getLatestAttempt.mockResolvedValue(null);
      
      const context = await enrichTaskContext('task-123');
      expect(context.attempt).toBeNull();
    });
  });

  describe('Agent Routing', () => {
    it('should find correct PM agent for project', async () => {
      const agentId = await findAgentForProject('proj-456');
      expect(agentId).toBe('agent-letta-pm-proj456');
    });

    it('should cache agent lookups', async () => {
      await findAgentForProject('proj-456');
      await findAgentForProject('proj-456');
      
      expect(lettaApi.listAgents).toHaveBeenCalledTimes(1);
    });

    it('should create agent if not found', async () => {
      lettaApi.findAgent.mockResolvedValue(null);
      
      const agentId = await findAgentForProject('proj-789');
      expect(lettaApi.createAgent).toHaveBeenCalled();
    });
  });

  describe('Notification Queue', () => {
    it('should enqueue notifications', () => {
      const notification = { taskId: '123', agentId: '456' };
      queue.enqueue(notification);
      
      expect(queue.size()).toBe(1);
    });

    it('should retry failed notifications', async () => {
      lettaApi.sendMessage.mockRejectedValueOnce(new Error('Timeout'));
      
      await queue.process();
      
      expect(lettaApi.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('should move to DLQ after max retries', async () => {
      lettaApi.sendMessage.mockRejectedValue(new Error('Fatal'));
      
      await queue.process();
      
      expect(queue.deadLetterQueue.size()).toBe(1);
    });
  });
});
```

### 5.3 Integration Tests

**File:** `tests/integration/ReviewLoopIntegration.test.js`

```javascript
describe('Review Loop Integration', () => {
  let reviewService;
  let mockVibeServer;
  let mockLettaServer;

  beforeAll(async () => {
    // Start mock servers
    mockVibeServer = await startMockVibeServer();
    mockLettaServer = await startMockLettaServer();
    
    reviewService = new ReviewLoopService({
      vibeApiUrl: mockVibeServer.url,
      lettaApiUrl: mockLettaServer.url
    });
    
    await reviewService.start();
  });

  afterAll(async () => {
    await reviewService.stop();
    await mockVibeServer.close();
    await mockLettaServer.close();
  });

  it('should handle complete review notification flow', async () => {
    // Simulate task status change
    await mockVibeServer.emitEvent({
      op: 'replace',
      path: '/tasks/task-123',
      value: {
        id: 'task-123',
        status: 'inreview',
        title: 'Implement feature X',
        project_id: 'proj-456'
      }
    });

    // Wait for notification to be sent
    await waitFor(() => 
      mockLettaServer.receivedMessages.length > 0
    );

    // Verify message content
    const message = mockLettaServer.receivedMessages[0];
    expect(message.agentId).toBe('agent-proj-456');
    expect(message.content).toContain('ready for review');
  });

  it('should reconnect after SSE failure', async () => {
    // Simulate connection failure
    await mockVibeServer.disconnect();
    
    // Wait for reconnection
    await waitFor(() => 
      reviewService.isConnected()
    );

    // Verify events still received
    await mockVibeServer.emitEvent({
      op: 'replace',
      path: '/tasks/task-456',
      value: { status: 'inreview' }
    });

    expect(mockLettaServer.receivedMessages).toHaveLength(1);
  });
});
```

### 5.4 End-to-End Tests

**File:** `tests/e2e/ReviewLoop.e2e.test.js`

```javascript
describe('Review Loop E2E', () => {
  it('should complete full workflow from task to review', async () => {
    // 1. Create task in Vibe Kanban
    const task = await vibeApi.createTask({
      title: 'E2E Test Task',
      project_id: testProjectId
    });

    // 2. Start task attempt
    const attempt = await vibeApi.startTaskAttempt({
      task_id: task.id,
      executor: 'CLAUDE_CODE'
    });

    // 3. Update task status to inreview
    await vibeApi.updateTaskStatus(task.id, 'inreview');

    // 4. Wait for PM agent to receive notification
    await waitForAgentMessage(pmAgentId, {
      contains: task.title,
      timeout: 5000
    });

    // 5. Verify notification in Letta
    const messages = await lettaApi.getAgentMessages(pmAgentId);
    const reviewMessage = messages.find(m => 
      m.content.includes(task.title)
    );

    expect(reviewMessage).toBeDefined();
    expect(reviewMessage.content).toContain('ready for review');
  });
});
```

### 5.5 Test Coverage Requirements

| Component | Target Coverage | Critical Paths |
|-----------|----------------|----------------|
| SSE Event Consumer | 95% | Connection, reconnection, parsing |
| Review Notification Service | 90% | Detection, enrichment, routing |
| Notification Queue | 90% | Enqueue, retry, DLQ |
| Integration Layer | 85% | Service startup, shutdown, config |
| Overall | 90% | All code paths |

---

## 6. API Specifications

### 6.1 Vibe Kanban SSE Event Stream

**Endpoint:** `GET http://192.168.50.90:3105/api/events`

**Connection Type:** Server-Sent Events (SSE)

**Event Format:**
```typescript
interface EventMessage {
  event?: string;  // Optional event type
  data: string;    // JSON-encoded EventPatch
  id?: string;     // Optional event ID
}

interface EventPatch {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value: EventPatchInner;
}

interface EventPatchInner {
  db_op: 'INSERT' | 'UPDATE' | 'DELETE';
  record: RecordTypes;
}

type RecordTypes =
  | { type: 'TASK'; data: Task }
  | { type: 'TASK_ATTEMPT'; data: TaskAttempt }
  | { type: 'EXECUTION_PROCESS'; data: ExecutionProcess }
  | { type: 'DELETED_TASK'; data: DeletedTask };

interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: 'todo' | 'inprogress' | 'inreview' | 'done' | 'cancelled';
  created_at: string;
  updated_at: string;
  has_in_progress_attempt: boolean;
  has_merged_attempt: boolean;
  last_attempt_failed: boolean;
}
```

**Example Event:**
```json
{
  "data": {
    "op": "replace",
    "path": "/tasks/a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "value": {
      "db_op": "UPDATE",
      "record": {
        "type": "TASK",
        "data": {
          "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
          "project_id": "proj-456",
          "title": "Implement user authentication",
          "description": "Add OAuth2 login flow",
          "status": "inreview",
          "created_at": "2025-11-17T10:00:00Z",
          "updated_at": "2025-11-17T15:30:00Z",
          "has_in_progress_attempt": false,
          "has_merged_attempt": false,
          "last_attempt_failed": false
        }
      }
    }
  }
}
```

### 6.2 Vibe Kanban REST API

#### Get Task Details
```http
GET /api/tasks/{taskId}

Response 200:
{
  "id": "task-uuid",
  "title": "Task title",
  "description": "Full description",
  "status": "inreview",
  "project_id": "project-uuid",
  "created_at": "2025-11-17T10:00:00Z",
  "updated_at": "2025-11-17T15:30:00Z"
}
```

#### Get Latest Task Attempt
```http
GET /api/tasks/{taskId}/attempts

Response 200:
{
  "attempts": [
    {
      "id": "attempt-uuid",
      "task_id": "task-uuid",
      "branch": "vk/123-feature-name",
      "target_branch": "main",
      "executor": "CLAUDE_CODE",
      "container_ref": "container-ref-123",
      "created_at": "2025-11-17T15:00:00Z"
    }
  ]
}
```

#### Get Execution Processes
```http
GET /api/task-attempts/{attemptId}/processes

Response 200:
{
  "processes": [
    {
      "id": "process-uuid",
      "task_attempt_id": "attempt-uuid",
      "status": "Completed",
      "exit_code": 0,
      "runtime_ms": 45000,
      "created_at": "2025-11-17T15:00:00Z",
      "completed_at": "2025-11-17T15:00:45Z"
    }
  ]
}
```

### 6.3 Letta Agent API

#### Send Message to Agent
```http
POST /v1/agents/{agentId}/messages
Authorization: Bearer {token}
Content-Type: application/json

Request Body:
{
  "messages": [
    {
      "role": "user",
      "content": "Task 'Implement user auth' is ready for review. Branch: vk/123-user-auth. Please review the changes and provide feedback."
    }
  ]
}

Response 200:
{
  "messages": [
    {
      "id": "msg-uuid",
      "role": "assistant",
      "content": "I'll review the authentication implementation now...",
      "created_at": "2025-11-17T15:31:00Z"
    }
  ]
}
```

#### List Agent Messages
```http
GET /v1/agents/{agentId}/messages?limit=10

Response 200:
{
  "messages": [
    {
      "id": "msg-uuid",
      "role": "user",
      "content": "Task ready for review",
      "created_at": "2025-11-17T15:30:00Z"
    }
  ]
}
```

---

## 7. Data Models

### 7.1 Review Notification

```typescript
interface ReviewNotification {
  id: string;                    // Unique notification ID
  taskId: string;                // Vibe Kanban task ID
  projectId: string;             // Vibe Kanban project ID
  agentId: string;               // Letta PM agent ID
  status: NotificationStatus;    // Current status
  attempt: number;               // Retry attempt count
  createdAt: Date;               // When notification was created
  lastAttemptAt?: Date;          // Last retry timestamp
  sentAt?: Date;                 // Successfully sent timestamp
  error?: string;                // Last error message
  metadata: {
    taskTitle: string;
    taskDescription: string;
    branch?: string;
    executor?: string;
    attemptId?: string;
  };
}

enum NotificationStatus {
  PENDING = 'pending',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  DEAD_LETTER = 'dead_letter'
}
```

### 7.2 Queue State

```typescript
interface QueueState {
  pendingNotifications: ReviewNotification[];
  deadLetterQueue: ReviewNotification[];
  lastProcessedAt: Date;
  metrics: {
    totalEnqueued: number;
    totalSent: number;
    totalFailed: number;
    currentQueueDepth: number;
  };
}
```

### 7.3 Configuration

```typescript
interface ReviewLoopConfig {
  // Connection settings
  vibeApiUrl: string;
  vibeEventsUrl: string;
  lettaApiUrl: string;
  lettaApiToken: string;

  // Retry settings
  maxRetries: number;
  retryBackoffMs: number[];
  
  // Queue settings
  queuePersistencePath: string;
  queueFlushInterval: number;
  
  // Feature flags
  enabled: boolean;
  dryRun: boolean;
  
  // Monitoring
  metricsEnabled: boolean;
  loggingLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

---

## 8. Error Handling

### 8.1 Error Categories

| Error Type | Severity | Handling Strategy | Recovery Time |
|------------|----------|-------------------|---------------|
| SSE Connection Failure | High | Reconnect with backoff | < 30s |
| Vibe API Timeout | Medium | Retry 3x, log error | < 10s |
| Letta API Unavailable | High | Queue notification, retry | < 5min |
| Invalid Event Format | Low | Log warning, skip event | Immediate |
| Agent Not Found | Medium | Create agent, retry | < 1min |
| Queue Full | High | Alert, pause processing | Manual |

### 8.2 Retry Logic

```javascript
const RETRY_CONFIG = {
  maxRetries: 5,
  backoffMs: [1000, 2000, 4000, 8000, 16000],  // Exponential backoff
  jitterMs: 500                                  // Random jitter to prevent thundering herd
};

async function sendNotificationWithRetry(notification, attempt = 0) {
  try {
    await lettaApi.sendMessage(notification.agentId, notification.message);
    return { success: true };
  } catch (error) {
    if (attempt >= RETRY_CONFIG.maxRetries) {
      logger.error({ notification, error }, 'Max retries exceeded');
      moveToDeadLetterQueue(notification);
      return { success: false, reason: 'max_retries' };
    }

    const backoff = RETRY_CONFIG.backoffMs[attempt];
    const jitter = Math.random() * RETRY_CONFIG.jitterMs;
    
    logger.warn({ attempt, backoff, error }, 'Retrying notification');
    
    await sleep(backoff + jitter);
    return sendNotificationWithRetry(notification, attempt + 1);
  }
}
```

### 8.3 Circuit Breaker

```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureThreshold = threshold;
    this.resetTimeout = timeout;
    this.failures = 0;
    this.state = 'CLOSED';  // CLOSED, OPEN, HALF_OPEN
    this.lastFailureTime = null;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.error('Circuit breaker opened');
    }
  }
}
```

---

## 9. Monitoring and Observability

### 9.1 Metrics (Prometheus)

```javascript
// Counter metrics
review_notifications_total{status="sent|failed|dead_letter"}
sse_events_received_total{event_type="task|attempt|process"}
sse_connection_failures_total

// Gauge metrics
notification_queue_depth
notification_queue_age_seconds
sse_connection_status{status="connected|disconnected"}
active_pm_agents

// Histogram metrics
notification_latency_seconds{percentile="50|90|99"}
notification_processing_duration_seconds
sse_event_processing_duration_seconds

// Example implementation
const metrics = {
  notificationsSent: new promClient.Counter({
    name: 'review_notifications_sent_total',
    help: 'Total review notifications sent successfully',
    labelNames: ['project_id', 'agent_id']
  }),
  
  notificationLatency: new promClient.Histogram({
    name: 'notification_latency_seconds',
    help: 'Time from task status change to notification sent',
    buckets: [0.1, 0.5, 1, 2, 5, 10]
  }),
  
  queueDepth: new promClient.Gauge({
    name: 'notification_queue_depth',
    help: 'Current number of pending notifications'
  })
};
```

### 9.2 Logging

```javascript
// Structured logging with pino
logger.info({
  event: 'review_notification_sent',
  taskId: 'task-123',
  projectId: 'proj-456',
  agentId: 'agent-789',
  latencyMs: 234,
  attempt: 1
}, 'Review notification sent successfully');

logger.error({
  event: 'notification_failed',
  taskId: 'task-123',
  error: error.message,
  stack: error.stack,
  attempt: 3
}, 'Failed to send review notification');

logger.warn({
  event: 'sse_connection_lost',
  reconnectAttempt: 2,
  backoffMs: 2000
}, 'SSE connection lost, reconnecting...');
```

### 9.3 Health Checks

```http
GET /health/review-loop

Response 200 (Healthy):
{
  "status": "healthy",
  "checks": {
    "sse_connection": "connected",
    "queue_depth": 3,
    "last_notification_sent": "2025-11-17T15:30:00Z",
    "dead_letter_queue_size": 0
  },
  "metrics": {
    "notifications_sent_24h": 42,
    "average_latency_ms": 234,
    "error_rate_24h": 0.02
  }
}

Response 503 (Unhealthy):
{
  "status": "unhealthy",
  "checks": {
    "sse_connection": "disconnected",
    "queue_depth": 150,
    "last_notification_sent": "2025-11-17T10:00:00Z",
    "dead_letter_queue_size": 5
  },
  "errors": [
    "SSE connection failed after 10 attempts",
    "Queue depth exceeds threshold (150 > 100)"
  ]
}
```

### 9.4 Alerts

```yaml
# Prometheus alert rules
groups:
  - name: review_loop_alerts
    interval: 30s
    rules:
      - alert: ReviewLoopDisconnected
        expr: sse_connection_status{status="disconnected"} == 1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Review loop SSE connection is down"
          description: "SSE connection to Vibe Kanban has been down for 2 minutes"

      - alert: HighNotificationFailureRate
        expr: rate(review_notifications_total{status="failed"}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High review notification failure rate"
          description: "More than 10% of notifications are failing"

      - alert: DeadLetterQueueGrowing
        expr: increase(review_notifications_total{status="dead_letter"}[1h]) > 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Dead letter queue is growing"
          description: "More than 10 notifications moved to DLQ in the last hour"

      - alert: QueueBacklog
        expr: notification_queue_depth > 100
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Notification queue backlog"
          description: "Queue depth exceeds 100 notifications"
```

---

## 10. Security Considerations

### 10.1 Authentication

- **Letta API:** Bearer token authentication (stored in environment variable)
- **Vibe API:** No authentication required (internal network)
- **SSE Connection:** No authentication required (internal network)

### 10.2 Authorization

- PM agents can only access their assigned project's tasks
- Notification payloads include only necessary information
- No sensitive data (API keys, passwords) in logs or notifications

### 10.3 Data Privacy

- Task descriptions may contain sensitive information
- Notifications transmitted over internal network only
- No external API calls or data exfiltration
- Logs redact sensitive fields

### 10.4 Input Validation

```javascript
function validateTaskEvent(event) {
  // Validate event structure
  if (!event.op || !event.path || !event.value) {
    throw new ValidationError('Invalid event structure');
  }

  // Validate UUIDs
  if (event.value.data?.id && !isValidUUID(event.value.data.id)) {
    throw new ValidationError('Invalid task UUID');
  }

  // Validate status enum
  const validStatuses = ['todo', 'inprogress', 'inreview', 'done', 'cancelled'];
  if (event.value.data?.status && !validStatuses.includes(event.value.data.status)) {
    throw new ValidationError('Invalid task status');
  }

  return true;
}
```

---

## 11. Rollout Plan

### Phase 1: Development (Week 1-2)

- [ ] Implement core functionality
- [ ] Write comprehensive tests
- [ ] Set up local development environment
- [ ] Code review and QA

### Phase 2: Staging Deployment (Week 3)

- [ ] Deploy to staging environment
- [ ] Run automated test suite
- [ ] Manual testing with real Vibe/Letta instances
- [ ] Load testing with simulated events
- [ ] Monitor metrics and logs

### Phase 3: Canary Rollout (Week 4)

- [ ] Enable for 1-2 pilot projects
- [ ] Monitor for 48 hours
- [ ] Gather feedback from PM agents
- [ ] Fix any issues discovered
- [ ] Validate metrics meet SLAs

### Phase 4: Full Rollout (Week 5)

- [ ] Enable for all projects
- [ ] Monitor system health
- [ ] Document operational procedures
- [ ] Train team on troubleshooting
- [ ] Post-deployment review

### Rollback Plan

If critical issues are discovered:

1. **Immediate:** Set `REVIEW_LOOP_ENABLED=false` in `.env`
2. **Service restarts** without review loop functionality
3. **Investigate issue** in development environment
4. **Fix and redeploy** when ready

---

## 12. Appendices

### Appendix A: Configuration Reference

```bash
# .env configuration

# Review Loop Feature Flag
REVIEW_LOOP_ENABLED=true

# SSE Connection
VIBE_EVENTS_URL=http://192.168.50.90:3105/api/events
SSE_RECONNECT_DELAY_MS=1000
SSE_MAX_RECONNECT_ATTEMPTS=10

# Notification Queue
NOTIFICATION_MAX_RETRIES=5
NOTIFICATION_RETRY_BACKOFF_MS=1000,2000,4000,8000,16000
NOTIFICATION_QUEUE_PERSISTENCE_PATH=/opt/stacks/huly-vibe-sync/logs/notification-queue.json
NOTIFICATION_QUEUE_FLUSH_INTERVAL_MS=5000

# Agent Routing
LETTA_PM_AGENT_PREFIX=Huly-PM-

# Monitoring
REVIEW_LOOP_METRICS_ENABLED=true
REVIEW_LOOP_LOG_LEVEL=info

# Development
REVIEW_LOOP_DRY_RUN=false
```

### Appendix B: File Structure

```
/opt/stacks/huly-vibe-sync/
├── lib/
│   ├── ReviewLoopService.js           # Main service module
│   ├── SSEEventConsumer.js            # SSE connection handler
│   ├── ReviewNotificationService.js   # Notification logic
│   ├── NotificationQueue.js           # Queue with retry logic
│   └── AgentRouter.js                 # PM agent lookup
├── tests/
│   ├── unit/
│   │   ├── ReviewLoopService.test.js
│   │   ├── SSEEventConsumer.test.js
│   │   ├── ReviewNotificationService.test.js
│   │   └── NotificationQueue.test.js
│   ├── integration/
│   │   └── ReviewLoopIntegration.test.js
│   └── e2e/
│       └── ReviewLoop.e2e.test.js
├── docs/
│   ├── PRD_REVIEW_LOOP_INTEGRATION.md  # This document
│   ├── REVIEW_LOOP_OPERATIONS.md       # Operations guide
│   └── REVIEW_LOOP_TROUBLESHOOTING.md  # Troubleshooting guide
└── logs/
    ├── notification-queue.json         # Queue persistence
    └── review-loop.log                 # Service logs
```

### Appendix C: Dependencies

```json
{
  "dependencies": {
    "eventsource": "^2.0.2",           // SSE client
    "pino": "^10.1.0",                 // Structured logging
    "prom-client": "^15.1.3"           // Prometheus metrics
  },
  "devDependencies": {
    "vitest": "^4.0.6",                // Test framework
    "nock": "^14.0.10",                // HTTP mocking
    "@vitest/coverage-v8": "^4.0.6"    // Coverage reporting
  }
}
```

### Appendix D: Glossary

- **SSE:** Server-Sent Events - one-way HTTP connection for real-time updates
- **PM Agent:** Project Manager Letta agent responsible for project oversight
- **DLQ:** Dead Letter Queue - storage for permanently failed notifications
- **Circuit Breaker:** Design pattern to prevent cascading failures
- **Backoff:** Incremental delay between retry attempts
- **Jitter:** Random delay added to prevent synchronized retries

---

## Approval and Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | TBD | | |
| Tech Lead | TBD | | |
| DevOps Lead | TBD | | |
| QA Lead | TBD | | |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-11-17 | System Architecture | Initial PRD creation |

---

**Next Steps:**

1. Review and approve this PRD
2. Create implementation tickets in Huly/Vibe Kanban
3. Assign development resources
4. Begin Phase 1 implementation
5. Schedule weekly sync meetings

---

*For questions or feedback, please contact the development team.*
