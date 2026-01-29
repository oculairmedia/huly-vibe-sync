# Self-Improving Multi-Agent Network Architecture

> **Date**: January 2026
> **Status**: Architectural Design Document
> **Scope**: Recursive self-improvement for a 38-agent PM network with developer agents, director oversight, and durable scheduling infrastructure.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Wake-Up Problem](#2-the-wake-up-problem)
3. [Pressure Design](#3-pressure-design)
4. [The Self-Improvement Loop](#4-the-self-improvement-loop)
5. [Safety & Stability](#5-safety--stability)
6. [Biological Analogies](#6-biological-analogies)
7. [What to Build First](#7-what-to-build-first)
8. [Appendix: Existing System Inventory](#appendix-existing-system-inventory)

---

## 1. Executive Summary

The goal is to transform a currently **reactive** multi-agent network (agents act when humans trigger them) into a **proactively self-improving** system that autonomously identifies friction, files improvement work, executes it, validates results, and propagates successful patterns — all without human intervention in the steady state.

### The Core Insight

The system already generates the **raw material** for self-improvement:

- **Quality signals** (`codebase_ast` blocks) with doc gaps, untested modules, complexity hotspots — pushed to 38 PM agents every 15-60 minutes
- **Health metrics** (Prometheus) with sync success rates, API latencies, error counts
- **Huly backlogs** with issues, priorities, and status tracking
- **Graphiti knowledge graph** with cross-project structural memory
- **Matrix communication** enabling agent-to-agent coordination
- **Temporal workflows** providing durable, crash-resilient scheduling

What's missing is the **closed loop**: the mechanism that reads these signals, decides what to improve, dispatches work, validates outcomes, and feeds results back into the signal stream.

### The Minimal Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     THE SELF-IMPROVEMENT LOOP                       │
│                                                                     │
│   ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌────────────┐  │
│   │  SENSE   │───▶│  DECIDE   │───▶│   ACT    │───▶│  EVALUATE  │  │
│   │          │    │           │    │          │    │            │  │
│   │ Quality  │    │ Meridian  │    │ Dev Agent│    │ Quality    │  │
│   │ Signals  │    │ + PM      │    │ executes │    │ Signals    │  │
│   │ Health   │    │ Agents    │    │ fix/     │    │ (after)    │  │
│   │ Metrics  │    │ triage    │    │ improve  │    │ vs before  │  │
│   └──────────┘    └───────────┘    └──────────┘    └─────┬──────┘  │
│        ▲                                                  │         │
│        └──────────────────────────────────────────────────┘         │
│                          FEEDBACK                                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  TEMPORAL CLOCK   │
                    │  (external timer) │
                    └───────────────────┘
```

---

## 2. The Wake-Up Problem

### The Fundamental Constraint

Letta agents (including sleeptime agents) **cannot self-schedule time-based wake-ups**. Sleeptime agents are triggered by step counts (every 5 conversation steps), not by wall-clock time. No agent in the system can say "wake me up in 4 hours."

This means the network requires an **external heartbeat** — a clock that is not an agent, that ticks reliably regardless of whether any agent is running.

### Solution: Temporal as the Heartbeat

Temporal is already in production for sync orchestration. The system already has:

- `ScheduledSyncWorkflow` — a long-running workflow that executes syncs at intervals
- `startScheduledSync()` / `stopScheduledSync()` / `restartScheduledSync()` — schedule management API
- `FullOrchestrationWorkflow` — durable multi-project sync with `continueAsNew` for history management
- Worker running on `vibesync-queue` with 20+ registered workflow types

**The minimal viable heartbeat** is a new Temporal Schedule (not a workflow-as-cron, but a proper Temporal Schedule object) that ticks at defined intervals:

```typescript
// Three heartbeat frequencies, aligned with biological circadian rhythms:

const SCHEDULES = {
  // Frequent pulse — check for acute issues (like a heartbeat)
  pulse: {
    schedule: { interval: '15m' },
    action: 'PulseCheckWorkflow',
    // Reads: health metrics, error rates, stalled syncs
    // Produces: alerts, auto-restart of failed services
  },

  // Triage cycle — review quality signals (like waking hours)
  triage: {
    schedule: { interval: '4h' },
    action: 'TriageCycleWorkflow',
    // Reads: codebase_ast quality_signals across all 38 projects
    // Produces: prioritized improvement tickets in Huly
  },

  // Retrospective — evaluate improvement outcomes (like sleep/dreaming)
  retrospective: {
    schedule: { calendar: { hour: 3 } },  // 3 AM daily
    action: 'RetrospectiveWorkflow',
    // Reads: tickets completed yesterday, quality signal deltas
    // Produces: effectiveness scores, strategy adjustments in Graphiti
  },
};
```

### Why Three Frequencies?

| Frequency | Analogy | Purpose | Existing Hook |
|-----------|---------|---------|---------------|
| **15 min** (Pulse) | Heartbeat | Detect failures, restart stalled processes | `HealthService.getHealthMetrics()` already produces this data |
| **4 hours** (Triage) | Waking review | Analyze quality signals, file improvement work | `AstSummaryService` already pushes quality_signals every 15-60m |
| **Daily** (Retro) | Sleep/dreaming | Evaluate outcomes, adjust strategy, prune | `Graphiti` already stores cross-project memory |

### What "Wake Up" Actually Means

An agent wake-up in this system means:

1. **Temporal Schedule fires** → starts a workflow
2. **Workflow activity calls Letta API** → sends a message to the PM agent with context
3. **PM agent processes message** → reads its memory blocks, reasons, produces output
4. **Output routed back** → via Matrix or direct API call to create Huly issues, update blocks, message other agents

The PM agent doesn't need to be "running" between ticks. It's stateless between invocations. Its state lives in its memory blocks (which are already being updated continuously by the sync service).

---

## 3. Pressure Design

Pressure without purpose is just noise. Every pressure mechanism must have a **clear signal**, a **threshold**, and an **action**.

### 3.1 Quality Debt Pressure (Already Exists — Needs Activation)

The `codebase_ast` quality_signals block already tracks:

```json
{
  "quality_signals": {
    "doc_gaps": [
      { "file": "lib/SyncOrchestrator.js", "functions": 12, "documented": 1 }
    ],
    "untested_modules": [
      "lib/AstMemorySync.js",
      "lib/CodePerceptionWatcher.js"
    ],
    "complexity_hotspots": [
      { "file": "lib/BeadsService.js", "functions": 15, "async": 12 }
    ]
  }
}
```

**Pressure mechanism**: When `doc_gaps` exceeds a threshold (e.g., >5 files with <25% documentation), the triage cycle automatically files a Huly issue:

```
Title: [AUTO] Reduce documentation debt in lib/ (8 files < 25% documented)
Priority: Medium
Labels: auto-improvement, doc-debt
Description:
  Quality signals detected 8 lib files with <25% function documentation.
  Worst offenders:
  - lib/SyncOrchestrator.js: 12 functions, 1 documented (8%)
  - lib/BeadsService.js: 15 functions, 2 documented (13%)
  ...
  Acceptance criteria: All files above 50% documentation coverage.
```

**Why this works**: The signal is already being generated. The threshold is measurable. The action (file issue → dev agent picks up → quality signal improves) closes the loop.

### 3.2 Staleness Pressure (Time-Based Decay)

Issues that sit in backlogs without progress should generate increasing pressure. This is the agent equivalent of biological hunger — the longer you don't eat, the more urgent eating becomes.

**Mechanism**: Each Huly issue has `modifiedOn` timestamps. The triage cycle calculates:

```
staleness_score = days_since_last_update * priority_weight
  where priority_weight = { Urgent: 4, High: 3, Medium: 2, Low: 1 }
```

**Threshold**: When a project's aggregate staleness score exceeds its historical average by 2σ (standard deviations), the PM agent is notified:

```
[Triage → PM Agent via Matrix]
"Your backlog staleness score is 47 (avg: 22, threshold: 35).
3 high-priority issues have been untouched for >7 days:
- HVSYN-142: Fix Beads sync race condition (9 days stale)
- HVSYN-138: Add retry logic to GraphitiClient (8 days stale)
- HVSYN-145: Update AGENTS.md templates (7 days stale)
Recommend: Dispatch developer agent for HVSYN-142 (highest priority × staleness)."
```

**Action**: PM agent can autonomously dispatch developer work via `talk_to_opencode` or escalate to Meridian.

### 3.3 Error Rate Pressure (Homeostatic)

The system already tracks error rates via Prometheus (`sync_runs_total{status="error"}`). Currently this is just monitored — nobody acts on it.

**Mechanism**: The pulse check (every 15 min) reads error rates. If error rate exceeds 5% over a rolling 1-hour window:

1. **Mild (5-15%)**: Log warning, increment project's `pressure_score` in Graphiti
2. **Moderate (15-30%)**: File auto-diagnostic issue, message PM agent
3. **Severe (>30%)**: Message Meridian directly, pause non-essential operations

This is **homeostatic regulation** — the system has a setpoint (error rate ≈ 0%) and acts to restore it when deviation is detected.

### 3.4 Cross-Project Competition (Selection Pressure)

With 38 projects, relative performance creates natural selection pressure.

**Mechanism**: The daily retrospective computes a **Project Health Score** per project:

```
health_score = (
  0.3 * test_coverage_signal +      // from quality_signals.untested_modules
  0.2 * documentation_signal +       // from quality_signals.doc_gaps
  0.2 * backlog_velocity +           // issues closed / issues opened, 7-day rolling
  0.2 * (1 - error_rate) +           // from Prometheus
  0.1 * freshness                    // inverse of avg staleness
)
```

**Ranking**: Projects are ranked. Bottom quartile projects get **priority attention** in the next triage cycle. Top quartile strategies are **propagated** — their PM agent personas, workflow patterns, and tool configurations are studied for what works.

**Where this lives**: Graphiti knowledge graph. Each retrospective writes:

```
Entity: ProjectHealth:HVSYN
Summary: "Health score: 0.73 (rank 12/38). Strengths: low error rate, good velocity. Weaknesses: documentation debt (8 undocumented files), 3 untested modules."
```

This creates a **fitness landscape** that agents can navigate — and that evolves as the system improves.

### 3.5 Resource Scarcity Pressure

Developer agent time is the scarce resource. Only N developer agents can run simultaneously (constrained by compute, API rate limits, and safety).

**Mechanism**: A **work queue** with priority scheduling:

```
work_priority = (
  urgency_from_staleness +
  severity_from_error_rate +
  impact_from_health_score_delta  // "how much would fixing this improve the project score?"
)
```

Projects compete for developer agent slots based on their work queue priority. This naturally channels effort toward the highest-impact improvements.

---

## 4. The Self-Improvement Loop

### 4.1 Loop Architecture

```
                        ┌───────────────────────────────────┐
                        │        TEMPORAL SCHEDULES          │
                        │   Pulse(15m) Triage(4h) Retro(1d) │
                        └───────────┬───────────────────────┘
                                    │ triggers
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          SENSE PHASE                                    │
│                                                                         │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │  Health Metrics  │  │  Quality Signals │  │   Backlog Analysis    │  │
│  │  (Prometheus)    │  │  (codebase_ast)  │  │   (Huly REST API)    │  │
│  │                  │  │                  │  │                       │  │
│  │  • Error rates   │  │  • Doc gaps      │  │  • Stale issues      │  │
│  │  • Sync latency  │  │  • Untested      │  │  • Blocked items     │  │
│  │  • API health    │  │  • Complexity    │  │  • WIP aging         │  │
│  │  • Memory usage  │  │  • Recent delta  │  │  • Velocity trend    │  │
│  └────────┬────────┘  └────────┬─────────┘  └──────────┬────────────┘  │
│           └────────────────────┼────────────────────────┘               │
│                                │ aggregated into                        │
│                                ▼                                        │
│                     ┌─────────────────────┐                            │
│                     │  System State        │                            │
│                     │  Snapshot            │                            │
│                     │  (per-project +      │                            │
│                     │   network-wide)      │                            │
│                     └──────────┬──────────┘                            │
└────────────────────────────────┼────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          DECIDE PHASE                                   │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Triage Agent (Meridian or dedicated triage workflow)              │ │
│  │                                                                    │ │
│  │  Input: System state snapshot                                      │ │
│  │  Process:                                                          │ │
│  │    1. Rank projects by health score                                │ │
│  │    2. Identify highest-impact improvements                         │ │
│  │    3. Check Huly for existing issues (avoid duplicates)            │ │
│  │    4. Estimate effort vs. impact for each candidate                │ │
│  │    5. Select top-N items that fit available capacity               │ │
│  │                                                                    │ │
│  │  Output: Prioritized work items                                    │ │
│  │    - New Huly issues (auto-filed with [AUTO] prefix)               │ │
│  │    - Updated priorities on existing issues                         │ │
│  │    - PM agent notifications via Matrix                             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Decision Rules:                                                        │
│  • Max 3 auto-generated issues per project per triage cycle             │
│  • Never auto-generate issues with priority > Medium                    │
│  • Always check for existing similar issues first                       │
│  • Escalate to Meridian if system-wide error rate > 20%                 │
│  • Escalate to human if >10 auto-issues filed in 24h                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           ACT PHASE                                     │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  PM Agent receives work assignment via Matrix                      │ │
│  │                                                                    │ │
│  │  PM Agent:                                                         │ │
│  │    1. Reviews issue context (reads codebase_ast block)             │ │
│  │    2. Breaks down into concrete tasks                              │ │
│  │    3. Dispatches to developer agent via talk_to_opencode           │ │
│  │    4. Monitors progress (4-hour follow-up rule already exists)     │ │
│  │                                                                    │ │
│  │  Developer Agent (Claude Code):                                    │ │
│  │    1. Reads AGENTS.md for project context                          │ │
│  │    2. Implements fix/improvement                                   │ │
│  │    3. Runs tests (quality gate)                                    │ │
│  │    4. Commits and pushes                                           │ │
│  │    5. Reports back to PM agent via Matrix                          │ │
│  │    6. Closes Huly issue                                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Capacity Management:                                                   │
│  • Max 2 developer agents active simultaneously                         │
│  • Token budget per improvement cycle (prevent runaway costs)           │
│  • Time budget per task (escalate if >2h without progress)              │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EVALUATE PHASE                                  │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  After action completes (or next triage cycle):                    │ │
│  │                                                                    │ │
│  │  Compare quality signals BEFORE vs AFTER:                          │ │
│  │    • Did doc_gaps shrink?                                          │ │
│  │    • Did untested_modules decrease?                                │ │
│  │    • Did error_rate improve?                                       │ │
│  │    • Did health_score increase?                                    │ │
│  │                                                                    │ │
│  │  Score the improvement:                                            │ │
│  │    effectiveness = Δ(health_score) / effort_spent                  │ │
│  │                                                                    │ │
│  │  Record in Graphiti:                                               │ │
│  │    Entity: Improvement:HVSYN-142                                   │ │
│  │    Summary: "Documentation fix. Health delta: +0.05.               │ │
│  │             Cost: 45 min dev time. Effectiveness: 0.067/min."      │ │
│  │    Tags: [effective, documentation, auto-generated]                 │ │
│  │                                                                    │ │
│  │  Propagation:                                                      │ │
│  │    If effectiveness > threshold:                                   │ │
│  │      → Record pattern in Graphiti for cross-project reuse          │ │
│  │      → Adjust triage weights to favor this improvement type        │ │
│  │    If effectiveness < threshold:                                   │ │
│  │      → Reduce priority for similar improvements                    │ │
│  │      → Flag for human review                                       │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Information Flow: Concrete Example

**Scenario**: `lib/BeadsService.js` has 15 functions but only 2 are documented.

1. **T=0**: `AstSummaryService` pushes `codebase_ast` block to HVSYN PM agent. Quality signals include `doc_gaps: [{file: "lib/BeadsService.js", functions: 15, documented: 2}]`.

2. **T=4h**: Triage cycle fires. Workflow reads all 38 PM agents' `codebase_ast` blocks. HVSYN has a doc_gap score of 13/15 = 87% undocumented for BeadsService.js. This exceeds the threshold (>75% undocumented + >10 functions).

3. **T=4h+30s**: Triage workflow queries Huly API: `GET /api/issues?project=HVSYN&title=*BeadsService*documentation*`. No existing issue found. Triage creates:
   ```
   POST /api/issues
   {
     project: "HVSYN",
     title: "[AUTO] Add JSDoc to lib/BeadsService.js (2/15 functions documented)",
     priority: "Medium",
     labels: ["auto-improvement", "documentation"],
     description: "Quality signals detected lib/BeadsService.js has 15 functions but only 2 documented..."
   }
   ```

4. **T=4h+1m**: Triage sends Matrix message to HVSYN PM agent:
   ```
   "New auto-improvement issue HVSYN-157 filed: Add JSDoc to BeadsService.js.
   Your project health score is 0.68 (rank 24/38). Documentation is the top improvement lever."
   ```

5. **T=4h+2m**: PM agent processes message, reads its `codebase_ast` block to understand the codebase, and dispatches to developer agent:
   ```
   talk_to_opencode(target="huly-vibe-sync", message="Please work on HVSYN-157...")
   ```

6. **T=4h+30m**: Developer agent adds JSDoc to all 15 functions in BeadsService.js. Pushes commit. Reports to PM agent. Closes HVSYN-157.

7. **T=5h**: Next `AstSummaryService` push. `codebase_ast` now shows `doc_gaps: []` for BeadsService.js. Quality signal improved.

8. **T=next day 3am**: Retrospective workflow runs. Compares HVSYN health_score before (0.68) and after (0.73). Records:
   ```
   Entity: Improvement:HVSYN-157
   Summary: "Doc improvement for BeadsService.js. Health delta: +0.05. Time: 28 min. Effective."
   ```

9. **T=next triage**: Triage workflow queries Graphiti for recent effective improvements. Sees documentation fixes have high ROI. Increases weight for documentation improvements in other projects with similar gaps.

### 4.3 The Agent Roles (Concrete)

| Agent | Role in Loop | Trigger | Output |
|-------|-------------|---------|--------|
| **Temporal Schedule** | External clock | Wall-clock time | Starts workflows |
| **Pulse Workflow** | Health monitor | Every 15 min | Alerts, auto-restarts |
| **Triage Workflow** | Signal analyzer | Every 4 hours | Huly issues, PM notifications |
| **Retro Workflow** | Outcome evaluator | Daily at 3 AM | Effectiveness scores, strategy updates |
| **PM Agent (×38)** | Project owner | Matrix message | Task breakdown, dev dispatching |
| **Meridian** | Network overseer | Escalations | Cross-project coordination, strategy |
| **Dev Agent** | Code executor | PM dispatch | Code changes, test runs, commits |
| **Graphiti** | Memory store | API calls | Cross-project patterns, improvement history |

---

## 5. Safety & Stability

### 5.1 The Runaway Problem

Self-improving systems risk:
- **Infinite loops**: Improvement A creates issue B, which creates improvement C, which recreates A
- **Cascading modifications**: Agent modifies its own instructions, losing safety constraints
- **Resource exhaustion**: Unbounded autonomous work burns tokens/compute
- **Quality degradation**: Autonomous changes that pass tests but degrade overall quality

### 5.2 Guardrails (Layered Defense)

#### Layer 1: Rate Limits (Hard Caps)

```yaml
rate_limits:
  auto_issues_per_project_per_day: 3
  auto_issues_network_wide_per_day: 20
  developer_agents_concurrent: 2
  token_budget_per_improvement: 50000
  max_improvement_duration: 2h
  max_files_modified_per_improvement: 10
```

These are enforced by Temporal workflow logic, not by agent self-restraint. The workflow **refuses to create** the 4th auto-issue, regardless of what any agent says.

#### Layer 2: Scope Boundaries (What Can Be Modified)

```yaml
autonomous_modification_scope:
  allowed:
    - documentation (JSDoc, README, inline comments)
    - test files (new tests only, not modifying existing)
    - configuration (non-breaking, additive only)
    - issue management (create, prioritize, close)
    - agent memory blocks (non-persona blocks only)

  requires_human_approval:
    - production code logic changes
    - dependency additions/removals
    - infrastructure changes
    - agent persona modifications
    - security-related files
    - anything touching .env, credentials, or keys

  forbidden:
    - modifying safety guardrails themselves
    - modifying Temporal schedule configurations
    - deleting existing tests
    - force-pushing to any branch
    - modifying other agents' persona blocks
```

#### Layer 3: Circuit Breakers

```typescript
// Already exists in FullOrchestrationWorkflow — extend pattern:
const circuitBreakers = {
  // If an auto-improvement causes test failures, halt
  testFailureBreaker: {
    threshold: 2,  // 2 consecutive auto-improvements that fail tests
    action: 'pause_autonomous_improvements',
    recovery: 'human_review_required',
  },

  // If health score drops after improvement, halt
  healthRegressionBreaker: {
    threshold: -0.05,  // Health score drops by 5%
    action: 'revert_last_improvement',
    recovery: 'escalate_to_meridian',
  },

  // If error rate spikes after change, halt
  errorSpikeBreaker: {
    threshold: 2.0,  // 2x normal error rate
    action: 'pause_all_autonomous_work',
    recovery: 'human_review_required',
  },
};
```

#### Layer 4: Audit Trail

Every autonomous action is recorded in multiple places:
- **Huly issues** with `[AUTO]` prefix and `auto-improvement` label
- **Git commits** with `[auto]` prefix in commit message
- **Graphiti entities** with improvement effectiveness scores
- **Temporal workflow history** (immutable, queryable)
- **Matrix messages** (visible to Emmanuel in Element)

A human can query: "Show me everything the system did autonomously in the last 24 hours" and get a complete answer from any of these four sources.

#### Layer 5: Human Override

```yaml
override_mechanisms:
  # Any human can stop everything immediately
  emergency_stop:
    - "bd close --label auto-improvement"  # Closes all auto issues
    - Temporal UI: Pause all schedules
    - Matrix: "@meridian pause autonomous work"

  # Gradual control
  dial_controls:
    autonomous_aggressiveness: 0.0 - 1.0  # 0 = fully manual, 1 = full auto
    # Start at 0.2 (only documentation and tests)
    # Increase as confidence builds
```

### 5.3 The Gödel Limit

A critical safety principle: **the self-improvement system must not be able to modify itself**.

The triage workflow, retrospective workflow, and Temporal schedules are infrastructure, not agent-modifiable code. Agents can suggest changes to these systems (by filing issues), but only a human can approve modifications to the improvement loop itself.

This is analogous to the separation between the **constitution** and **legislation** in governance — the meta-rules that govern rule-making are harder to change than ordinary rules.

---

## 6. Biological Analogies

The user asked specifically about replicating life's pressure mechanisms. This section maps biological systems to concrete network components.

### 6.1 Homeostasis → Error Rate Regulation

**Biology**: Body temperature maintained at 37°C. Sensors detect deviation. Effectors (sweating, shivering) restore setpoint.

**Network**: System error rate maintained near 0%. Health metrics detect deviation. Pulse check triggers corrective action (restart service, file diagnostic issue, escalate).

```
Setpoint:     error_rate = 0%
Sensor:       Prometheus sync_runs_total{status="error"}
Controller:   PulseCheckWorkflow (every 15 min)
Effector:     Auto-restart, diagnostic issue, escalation
Feedback:     Error rate measurement after correction
```

**Key insight**: Homeostasis doesn't optimize — it **maintains**. The pulse check isn't trying to make things better; it's trying to prevent things from getting worse. This is the foundation layer.

### 6.2 Allostasis → Predictive Workload Management

**Biology**: Unlike homeostasis (reactive), allostasis **anticipates** needs. Your body releases cortisol before you wake up, preparing for the day's demands.

**Network**: The triage cycle doesn't just react to problems — it **predicts** where problems will emerge:

- A module with growing complexity but no tests → file test issue **before** bugs appear
- A project with decelerating velocity → investigate blockers **before** they stall
- A dependency nearing EOL → plan migration **before** security vulnerability hits

```
Prediction model (simple, rules-based initially):

IF complexity_hotspot.functions > 10
   AND untested_modules CONTAINS hotspot_file
   AND recent_changes.any(file == hotspot_file)
THEN
   predict_risk("High complexity module under active development without tests")
   file_preventive_issue("Add test coverage for {file} before next refactor")
```

**Evolution**: Start with rules. As Graphiti accumulates improvement effectiveness data, the triage cycle can learn which types of preventive work actually pay off (by checking if projects that got preventive work had fewer incidents later).

### 6.3 Fitness Landscape → Project Health Scores

**Biology**: Evolution operates on a fitness landscape — a multi-dimensional surface where each point represents a genome and its height represents fitness. Populations move uphill through mutation and selection.

**Network**: Each project exists on a health landscape:

```
            ▲ Health Score
            │
       1.0  │                    ★ (ideal)
            │               ╱
            │          ╱───╱
            │     ╱───╱        Projects climb
            │╱───╱             toward higher health
       0.5  ├─────────────────────────────────
            │         ↑ threshold for concern
            │    ╲
            │     ╲───╲
            │          ╲───╲
       0.0  │               ╲  (neglected project)
            └────────────────────────────────▶ Time
```

Dimensions of the landscape:
- **Test coverage** (x-axis)
- **Documentation quality** (y-axis)
- **Error rate** (z-axis)
- **Backlog velocity** (w-axis)
- **Code complexity** (v-axis)

The improvement loop moves projects "uphill" on this landscape. The retrospective evaluates whether the gradient was actually followed (did improvements improve the right things?).

### 6.4 Natural Selection → Strategy Propagation

**Biology**: Organisms with higher fitness reproduce more, spreading their genes. No central planner — local fitness drives global adaptation.

**Network**: When a PM agent's project achieves high health scores, its patterns propagate:

1. **What gets propagated**: Not the agent itself, but its **strategies** — which types of improvements it prioritized, how it broke down work, which developer patterns it used.

2. **Propagation mechanism**: Graphiti stores effectiveness data per improvement type. The triage workflow queries: "What improvement strategies have been most effective across all projects?" and applies those strategies to underperforming projects.

3. **Example**: Project A's PM agent discovered that running `eslint --fix` before documentation work reduces subsequent bugs. This pattern gets recorded in Graphiti. Next triage cycle, other projects with similar codebases get the same pre-fix step added to their improvement playbook.

This is **cultural evolution** (memetics), not genetic evolution. Ideas spread, not organisms. More practical for a software system.

### 6.5 Circadian Rhythm → Schedule Design

**Biology**: 24-hour cycle with distinct phases: waking (active metabolism), sleep (consolidation, repair, memory formation), dawn (transition/preparation).

**Network**:

| Time | Phase | Agent Activity | Biology Parallel |
|------|-------|---------------|------------------|
| 06:00-22:00 | **Active** | Pulse checks, triage cycles, dev work | Waking metabolism |
| 22:00-02:00 | **Wind-down** | Complete in-progress work, no new dispatches | Evening cortisol decline |
| 02:00-03:00 | **Consolidation** | Retrospective workflow runs | REM sleep (memory consolidation) |
| 03:00-05:00 | **Repair** | Graphiti graph maintenance, stale entity pruning | Deep sleep (tissue repair) |
| 05:00-06:00 | **Preparation** | Pre-compute triage data for the day | Pre-dawn cortisol surge |

**Why this matters**: Running improvement work 24/7 would exhaust resources and create noise. The circadian pattern concentrates active improvement work in "waking hours" and uses "sleep" for consolidation and evaluation — exactly when human reviewers are likely to check in the morning.

### 6.6 Immune System → Anomaly Detection

**Biology**: The immune system distinguishes self from non-self and attacks threats while tolerating normal variation.

**Network**: The system needs to distinguish:
- **Normal variation**: Sync takes 5s instead of 3s → ignore
- **Anomaly**: Sync takes 60s → investigate
- **Threat**: Error rate jumps from 2% to 40% → immediate response
- **Autoimmune risk**: The improvement system itself causing problems → circuit breaker

**Implementation**: Baseline statistical profiles per metric, with anomaly detection using simple z-score thresholds. The pulse check serves as the immune system's sentinel — constantly scanning for threats.

---

## 7. What to Build First

### Phase 0: Foundation (Already Complete ✅)

Everything listed here exists in production today:

- [x] 38 PM agents with `codebase_ast` quality signal blocks
- [x] Temporal worker with 20+ workflow types
- [x] `ScheduledSyncWorkflow` with start/stop/restart
- [x] Health metrics via Prometheus
- [x] Matrix agent-to-agent messaging
- [x] Graphiti knowledge graph
- [x] Beads watchers on 30+ directories
- [x] `talk_to_agent` and `talk_to_opencode` working

### Phase 1: The Heartbeat (Effort: Short — 1-4 hours)

**Build**: Three Temporal Schedules (pulse, triage, retro) as proper `ScheduleClient.create()` objects.

**Concrete deliverable**:

```typescript
// temporal/schedules/self-improvement.ts

export async function createImprovementSchedules(client: Client) {
  // Pulse: every 15 minutes
  await client.schedule.create({
    scheduleId: 'self-improvement-pulse',
    spec: { intervals: [{ every: '15m' }] },
    action: {
      type: 'startWorkflow',
      workflowType: 'PulseCheckWorkflow',
      taskQueue: TASK_QUEUE,
    },
    policies: {
      overlap: ScheduleOverlapPolicy.SKIP,
      catchupWindow: '5m',
      pauseOnFailure: true,
    },
  });

  // Triage: every 4 hours during active hours (6am-10pm)
  await client.schedule.create({
    scheduleId: 'self-improvement-triage',
    spec: {
      calendars: [{
        hour: [6, 10, 14, 18, 22],
        minute: [0],
      }],
    },
    action: {
      type: 'startWorkflow',
      workflowType: 'TriageCycleWorkflow',
      taskQueue: TASK_QUEUE,
    },
    policies: {
      overlap: ScheduleOverlapPolicy.SKIP,
      pauseOnFailure: true,
    },
  });

  // Retrospective: daily at 3am
  await client.schedule.create({
    scheduleId: 'self-improvement-retro',
    spec: {
      calendars: [{ hour: [3], minute: [0] }],
    },
    action: {
      type: 'startWorkflow',
      workflowType: 'RetrospectiveWorkflow',
      taskQueue: TASK_QUEUE,
    },
    policies: {
      overlap: ScheduleOverlapPolicy.SKIP,
      pauseOnFailure: true,
    },
  });
}
```

**Why first**: Without the heartbeat, nothing else works. This is the external clock that makes autonomous operation possible.

### Phase 2: Sense (Effort: Short — 2-4 hours)

**Build**: `PulseCheckWorkflow` and `SystemStateSnapshot` activity.

The pulse check aggregates:
1. Health metrics from `HealthService.getHealthMetrics()` (already exists)
2. Quality signals from all PM agents' `codebase_ast` blocks (already being pushed)
3. Backlog stats from Huly REST API (already have client)

**Concrete deliverable**: A workflow activity that produces a `SystemStateSnapshot`:

```typescript
interface SystemStateSnapshot {
  timestamp: string;
  projects: Array<{
    identifier: string;
    healthScore: number;
    qualitySignals: {
      docGapCount: number;
      untestedModuleCount: number;
      complexityHotspotCount: number;
    };
    backlog: {
      totalIssues: number;
      staleIssues: number;  // >7 days no update
      avgStaleness: number;
      velocity7d: number;   // issues closed per day
    };
    errorRate: number;
  }>;
  networkHealth: {
    avgHealthScore: number;
    worstProjects: string[];
    bestProjects: string[];
    totalAutoIssuesLast24h: number;
  };
}
```

**Why second**: The loop needs input before it can decide anything. This activity reads existing signals — no new data sources needed.

### Phase 3: Decide (Effort: Medium — 1-2 days)

**Build**: `TriageCycleWorkflow` that reads the system state snapshot and produces improvement work items.

Start with **rules-based triage** (not LLM-based):

```typescript
function triageProject(project: ProjectState): ImprovementCandidate[] {
  const candidates: ImprovementCandidate[] = [];

  // Rule 1: Documentation debt
  if (project.qualitySignals.docGapCount > 3) {
    candidates.push({
      type: 'documentation',
      priority: 'medium',
      title: `[AUTO] Reduce documentation debt (${project.qualitySignals.docGapCount} files)`,
      estimatedImpact: project.qualitySignals.docGapCount * 0.01, // health score delta
    });
  }

  // Rule 2: Test coverage
  if (project.qualitySignals.untestedModuleCount > 2) {
    candidates.push({
      type: 'testing',
      priority: 'medium',
      title: `[AUTO] Add tests for ${project.qualitySignals.untestedModuleCount} untested modules`,
      estimatedImpact: project.qualitySignals.untestedModuleCount * 0.015,
    });
  }

  // Rule 3: Stale backlog
  if (project.backlog.staleIssues > 5) {
    candidates.push({
      type: 'backlog-grooming',
      priority: 'low',
      title: `[AUTO] Triage ${project.backlog.staleIssues} stale issues`,
      estimatedImpact: 0.02,
    });
  }

  return candidates;
}
```

**Why rules first, not LLM**: Rules are predictable, auditable, and cheap. They won't hallucinate issues. Once the loop is running and collecting effectiveness data, you can introduce LLM-based triage (having Meridian or PM agents reason about the snapshot) — but you need the measurement infrastructure first.

### Phase 4: Act + Evaluate (Effort: Medium — 1-2 days)

**Build**: Integration between triage output and PM agent dispatch.

This is the riskiest phase. Start with **dry-run mode**:

1. Triage workflow produces candidates but only **logs them** (doesn't create issues)
2. Human reviews logged candidates for 1-2 weeks
3. If candidate quality is high, enable Huly issue creation
4. If issue quality is high, enable PM agent notification
5. If PM agent dispatches are sound, enable developer agent execution

**Evaluate**: The retrospective workflow compares before/after quality signals for each completed auto-improvement. This data feeds back into Phase 3's triage weights.

### Phase 5: Close the Loop (Effort: Short — 2-4 hours)

**Build**: `RetrospectiveWorkflow` that:
1. Queries Huly for `[AUTO]` issues completed in last 24h
2. Compares quality signals before vs. after
3. Computes effectiveness scores
4. Writes to Graphiti
5. Adjusts triage weights for next cycle

### Timeline Summary

| Phase | What | Effort | Depends On |
|-------|------|--------|-----------|
| **Phase 1** | Temporal Schedules (heartbeat) | 1-4h | Nothing new |
| **Phase 2** | System State Snapshot | 2-4h | Phase 1 |
| **Phase 3** | Rules-Based Triage | 1-2d | Phase 2 |
| **Phase 4** | Act + Evaluate (dry-run first) | 1-2d | Phase 3 |
| **Phase 5** | Retrospective + Feedback Loop | 2-4h | Phase 4 |

**Total to minimal viable loop: ~1 week of focused work.**

After Phase 5, you have a closed loop that:
- Wakes up on its own (Temporal)
- Reads existing quality signals
- Files improvement issues
- Dispatches developer work
- Measures outcomes
- Adjusts strategy

Everything after this is refinement: better triage rules, LLM-based reasoning, cross-project pattern propagation, expanded scope of autonomous modifications.

---

## Appendix: Existing System Inventory

### Temporal Workflows (20+ registered)

| Workflow | Purpose | Schedule |
|----------|---------|----------|
| `FullOrchestrationWorkflow` | Multi-project bidirectional sync | On-demand / Scheduled |
| `ScheduledSyncWorkflow` | Periodic sync runner | Configurable interval |
| `ProjectSyncWorkflow` | Single project sync with continueAsNew | Child of orchestration |
| `BidirectionalSyncWorkflow` | Single issue bidirectional sync | Event-triggered |
| `BeadsFileChangeWorkflow` | React to .beads file changes | File watcher |
| `VibeSSEChangeWorkflow` | React to Vibe SSE events | SSE stream |
| `HulyWebhookChangeWorkflow` | React to Huly webhooks | Webhook |
| `MemoryUpdateWorkflow` | Single agent memory block update | On-demand |
| `BatchMemoryUpdateWorkflow` | Batch memory updates | On-demand |
| `ProvisionAgentsWorkflow` | Create/configure PM agents | On-demand |
| `IssueSyncWorkflow` | Single issue sync | On-demand |

### Quality Signal Sources

| Signal | Source | Frequency | Destination |
|--------|--------|-----------|-------------|
| `codebase_ast` | `AstSummaryService` | 15-60 min | PM agent memory blocks |
| `quality_signals.doc_gaps` | `AstSummaryService._buildQualitySignals()` | With codebase_ast | PM agent memory |
| `quality_signals.untested_modules` | Same | Same | Same |
| `quality_signals.complexity_hotspots` | Same | Same | Same |
| Health metrics | `HealthService` | Continuous | Prometheus |
| Sync metrics | `recordSyncMetrics()` activity | Per sync cycle | Temporal + Prometheus |
| File change events | `CodePerceptionWatcher` | Real-time (2s debounce) | Graphiti |
| AST function data | `ASTParser` | With file changes | Graphiti + ASTCache |

### Communication Channels

| Channel | Mechanism | Used By |
|---------|-----------|---------|
| Matrix `talk_to_agent` | Matrix bridge → Letta | PM agents, Meridian, Dev agents |
| Matrix `talk_to_opencode` | Matrix bridge → OpenCode | PM agents dispatching dev work |
| Huly REST API | Direct HTTP | Triage (create issues), sync (read/write) |
| Temporal signals | Workflow signals | Cancel, progress queries |
| Graphiti API | Entity/edge operations | CodePerceptionWatcher, retrospective |
| Letta memory blocks | Block API | AstBlockUpdater, LettaMemoryBuilders |

### Key Files for Implementation

| File | Extend For |
|------|-----------|
| `temporal/workflows/orchestration.ts` | Add `PulseCheckWorkflow`, `TriageCycleWorkflow`, `RetrospectiveWorkflow` |
| `temporal/client.ts` | Add schedule management functions |
| `temporal/worker.ts` | Register new workflows |
| `temporal/activities/orchestration.ts` | Add `buildSystemStateSnapshot`, `createAutoIssue`, `evaluateImprovement` activities |
| `lib/AstSummaryService.js` | Health score computation (extend `_buildQualitySignals`) |
| `lib/HealthService.js` | Expose error rate for triage consumption |
| `lib/GraphitiClient.js` | Improvement tracking entities |

---

*This document describes a system that can be built incrementally, starting with a Temporal heartbeat and ending with a fully closed self-improvement loop. Every component leverages existing infrastructure. The biological analogies aren't metaphors — they're design patterns that have been refined by 3.8 billion years of evolution for exactly this class of problem: how to make a distributed system that improves itself while remaining stable.*
