# VibeSync Flow Diagrams

Visual documentation of the bidirectional sync system.

## Overview

```mermaid
flowchart TB
    subgraph Sources["Event Sources"]
        HW[Huly Webhook]
        VS[Vibe SSE]
        BF[Beads File Watcher]
        SC[Scheduled Sync]
    end

    subgraph Temporal["Temporal Workflows"]
        OW[FullOrchestrationWorkflow]
        BW[BidirectionalSyncWorkflow]
        HWW[HulyWebhookChangeWorkflow]
        VWW[VibeSSEChangeWorkflow]
        BFW[BeadsFileChangeWorkflow]
    end

    subgraph Systems["External Systems"]
        H[(Huly)]
        V[(Vibe Kanban)]
        B[(Beads/Git)]
    end

    HW --> HWW
    VS --> VWW
    BF --> BFW
    SC --> OW

    OW --> BW
    HWW --> BW
    VWW --> BW
    BFW --> BW

    BW <--> H
    BW <--> V
    BW <--> B
```

## Full Orchestration Workflow

Scheduled every 10 seconds. Syncs all projects.

```mermaid
flowchart TD
    Start([Start]) --> FetchProjects[Fetch Huly + Vibe Projects]

    FetchProjects --> BulkPrefetch[Bulk Prefetch All Issues]
    BulkPrefetch --> Loop{For Each Project}

    Loop --> CB{Circuit Breaker\n3+ failures?}
    CB -->|Yes| Skip[Skip Project]
    CB -->|No| EnsureVibe[Ensure Vibe Project Exists]

    EnsureVibe --> Phase1[Phase 1: Huly to Vibe]
    Phase1 --> Phase2[Phase 2: Vibe to Huly]
    Phase2 --> HasBeads{Has Git Repo?}

    HasBeads -->|Yes| Phase3a[Phase 3a: Huly to Beads]
    Phase3a --> Phase3b[Phase 3b: Beads to Huly]
    Phase3b --> Commit[Git Commit Changes]
    HasBeads -->|No| SkipBeads[Skip Beads Sync]

    Commit --> RecordMetrics
    SkipBeads --> RecordMetrics[Record Metrics]
    Skip --> NextProject
    RecordMetrics --> NextProject{More Projects?}

    NextProject -->|Yes| CheckContinue{Processed 3+?}
    CheckContinue -->|Yes| ContinueAsNew[continueAsNew]
    CheckContinue -->|No| Loop
    NextProject -->|No| UpdateLetta[Update Letta Memory]

    UpdateLetta --> Done([Done])
    ContinueAsNew --> Start
```

## Bidirectional Sync Workflow

Handles single issue sync from any source.

```mermaid
flowchart TD
    Start([Issue Changed]) --> DetectSource{Source System?}

    DetectSource -->|Huly| FetchHuly[Fetch Huly Issue]
    DetectSource -->|Vibe| FetchVibe[Fetch Vibe Task]
    DetectSource -->|Beads| FetchBeads[Fetch Beads Issue]

    FetchHuly --> SyncToVibe[Sync to Vibe]
    SyncToVibe --> HasBeads1{Has Git Repo?}
    HasBeads1 -->|Yes| SyncToBeads1[Sync to Beads]
    HasBeads1 -->|No| Done1([Done])
    SyncToBeads1 --> CommitBeads1[Commit Beads]
    CommitBeads1 --> Done1

    FetchVibe --> ConflictCheck1{Conflict?\nMost Recent Wins}
    ConflictCheck1 -->|Vibe Newer| SyncToHuly[Sync to Huly]
    ConflictCheck1 -->|Huly Newer| SkipSync1[Skip - Huly Wins]
    SyncToHuly --> HasBeads2{Has Git Repo?}
    HasBeads2 -->|Yes| SyncToBeads2[Sync to Beads]
    HasBeads2 -->|No| Done2([Done])
    SyncToBeads2 --> CommitBeads2[Commit Beads]
    CommitBeads2 --> Done2
    SkipSync1 --> Done2

    FetchBeads --> ConflictCheck2{Conflict?\nMost Recent Wins}
    ConflictCheck2 -->|Beads Newer| SyncBeadsToHuly[Sync to Huly]
    ConflictCheck2 -->|Other Newer| SkipSync2[Skip - Other Wins]
    SyncBeadsToHuly --> SyncBeadsToVibe[Sync to Vibe]
    SyncBeadsToVibe --> Done3([Done])
    SkipSync2 --> Done3
```

## Webhook/SSE Event Flow

Real-time sync triggered by external events.

```mermaid
sequenceDiagram
    participant H as Huly
    participant HW as Huly Webhook
    participant T as Temporal
    participant V as Vibe
    participant B as Beads

    Note over H,B: Huly Change Event
    H->>HW: Issue Updated
    HW->>T: Start HulyWebhookChangeWorkflow
    T->>T: Deduplicate (workflow ID)
    T->>V: Sync to Vibe
    V-->>T: OK
    T->>B: Sync to Beads
    B-->>T: OK
    T->>B: Git Commit

    Note over H,B: Vibe Change Event (SSE)
    V->>T: SSE Event
    T->>T: Start VibeSSEChangeWorkflow
    T->>T: Extract Huly ID from description
    T->>H: Sync to Huly
    H-->>T: OK
    T->>B: Sync to Beads
    B-->>T: OK
```

## Conflict Resolution

"Most recent change wins" strategy.

```mermaid
flowchart TD
    Change([Change Detected]) --> GetTimestamps[Get modifiedAt from all systems]

    GetTimestamps --> Compare{Compare Timestamps}

    Compare -->|Source is newest| Propagate[Propagate to other systems]
    Compare -->|Other system newer| Skip[Skip sync - other system wins]
    Compare -->|Same timestamp| SourceWins[Source system wins ties]

    Propagate --> UpdateTargets[Update Huly/Vibe/Beads]
    SourceWins --> UpdateTargets

    UpdateTargets --> RecordSync[Record sync in DB]
    Skip --> LogSkip[Log skip reason]

    RecordSync --> Done([Done])
    LogSkip --> Done
```

## Retry Policy

All Temporal activities use exponential backoff.

```mermaid
flowchart LR
    Attempt1[Attempt 1] -->|Fail| Wait1[Wait 2s]
    Wait1 --> Attempt2[Attempt 2]
    Attempt2 -->|Fail| Wait2[Wait 4s]
    Wait2 --> Attempt3[Attempt 3]
    Attempt3 -->|Fail| Wait3[Wait 8s]
    Wait3 --> Attempt4[Attempt 4]
    Attempt4 -->|Fail| Wait4[Wait 16s]
    Wait4 --> Attempt5[Attempt 5]
    Attempt5 -->|Fail| Failed([Failed - Non-retryable])

    Attempt1 -->|Success| Done([Done])
    Attempt2 -->|Success| Done
    Attempt3 -->|Success| Done
    Attempt4 -->|Success| Done
    Attempt5 -->|Success| Done
```

**Non-retryable errors** (fail immediately):

- `ValidationError` - Invalid data format
- `NotFoundError` - Issue/task doesn't exist
- `ConflictError` - Unresolvable conflict

## System Counts (Current)

| System | Count | Notes                      |
| ------ | ----- | -------------------------- |
| Huly   | 178   | Source of truth for issues |
| Vibe   | 174   | Kanban board tasks         |
| Beads  | 171   | Git-tracked local issues   |

_Last verified: 2026-01-31_
