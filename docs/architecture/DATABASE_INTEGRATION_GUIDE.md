# SQLite Database Integration Guide

## 🎯 Goal

Replace the fragile JSON file state management with a proper SQLite database for:
- ✅ Fast, indexed queries
- ✅ Atomic transactions (no corruption)
- ✅ Historical tracking
- ✅ Better observability

## 📦 What's Already Done

1. ✅ Database module created: `lib/database.js`
2. ✅ Package.json updated with `better-sqlite3` dependency
3. ✅ Complete schema with indexes
4. ✅ Migration helper for existing JSON data

## 🔧 Step 1: Install Dependencies

```bash
cd /opt/stacks/vibesync
npm install
```

## 🐳 Step 2: Update Dockerfile

The `better-sqlite3` package requires native compilation. Update the Dockerfile:

```dockerfile
FROM node:20-alpine

LABEL maintainer="Oculair Media"
LABEL description="Legacy to Vibe Kanban bidirectional sync service"

# Install build dependencies for better-sqlite3
RUN apk add --no-cache \
    git \
    curl \
    python3 \
    make \
    g++

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies (includes native compilation)
RUN npm install --production

# Copy application files
COPY index.js ./
COPY lib ./lib
COPY *.md ./

# Create logs directory
RUN mkdir -p /app/logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Run as non-root user
USER node

# Default command
CMD ["node", "index.js"]
```

## 📝 Step 3: Integrate Database into index.js

Replace the JSON state management (lines 45-93) with:

```javascript
import { createSyncDatabase } from './lib/database.js';

// Initialize database
const DB_PATH = path.join(__dirname, 'logs', 'sync-state.db');
const db = createSyncDatabase(DB_PATH);

// Migrate existing JSON data (one-time)
const JSON_STATE_FILE = path.join(__dirname, 'logs', '.sync-state.json');
if (fs.existsSync(JSON_STATE_FILE) && !fs.existsSync(DB_PATH)) {
  console.log('[Migration] Importing data from JSON state file...');
  const oldState = JSON.parse(fs.readFileSync(JSON_STATE_FILE, 'utf8'));
  db.importFromJSON(oldState);

  // Backup old file
  fs.renameSync(JSON_STATE_FILE, `${JSON_STATE_FILE}.backup`);
  console.log('[Migration] ✓ Migration complete, old file backed up');
}

// REMOVE these old functions:
// - loadSyncState()
// - saveSyncState()
// - projectActivityCache Map

// REPLACE with database calls (examples below)
```

### Update: syncLegacyToVibe Function

```javascript
async function syncLegacyToVibe(legacyClient, vibeClient) {
  console.log('\n='.repeat(60));
  console.log(`Starting bidirectional sync at ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  // Start tracking this sync run
  const syncId = db.startSyncRun();
  const syncStartTime = Date.now();

  // Setup heartbeat logging
  const heartbeatInterval = setInterval(() => {
    console.log(`[HEARTBEAT] Sync still running... ${new Date().toISOString()}`);
  }, 30000);

  try {
    // Fetch Legacy projects
    const legacyProjects = await fetchLegacyProjects(legacyClient);
    if (legacyProjects.length === 0) {
      console.log('No Legacy projects found. Skipping sync.');
      clearInterval(heartbeatInterval);
      db.completeSyncRun(syncId, { projectsProcessed: 0, projectsFailed: 0 });
      return;
    }

    console.log(`[Legacy] Found ${legacyProjects.length} projects\n`);

    // Get existing Vibe projects
    const vibeProjects = await listVibeProjects(vibeClient);
    console.log(`[Vibe] Found ${vibeProjects.length} existing projects\n`);
    const vibeProjectsByName = new Map(vibeProjects.map(p => [p.name.toLowerCase(), p]));

    // Filter projects using database
    let projectsToProcess = legacyProjects;
    if (config.sync.skipEmpty) {
      projectsToProcess = db.getProjectsToSync(300000); // 5 minute cache
      console.log(`[DB] Processing ${projectsToProcess.length}/${legacyProjects.length} projects (skipping cached empty)`);
    }

    // Function to process a single project
    const processProject = async (legacyProject) => {
      try {
        console.log(`\n--- Processing Legacy project: ${legacyProject.name} ---`);

        // Upsert project to database
        db.upsertProject({
          identifier: legacyProject.identifier,
          name: legacyProject.name,
          filesystem_path: extractFilesystemPath(legacyProject.description),
        });

        // Check if project exists in Vibe
        let vibeProject = vibeProjectsByName.get(legacyProject.name.toLowerCase());

        if (!vibeProject) {
          console.log(`[Vibe] Project not found, attempting to create: ${legacyProject.name}`);
          const createdProject = await createVibeProject(legacyProject);

          if (createdProject) {
            vibeProject = createdProject;
            vibeProjectsByName.set(legacyProject.name.toLowerCase(), vibeProject);

            // Update database with Vibe ID
            db.upsertProject({
              identifier: legacyProject.identifier,
              vibe_id: vibeProject.id,
            });
          } else {
            console.log(`[Skip] Could not create project: ${legacyProject.name}`);
            return { success: false, project: legacyProject.name };
          }
        } else {
          console.log(`[Vibe] ✓ Found existing project: ${legacyProject.name}`);

          // Update database with Vibe ID
          db.upsertProject({
            identifier: legacyProject.identifier,
            vibe_id: vibeProject.id,
          });
        }

        // Fetch issues (use last sync from database)
        const projectIdentifier = legacyProject.identifier || legacyProject.name;
        const dbProject = db.getProject(projectIdentifier);
        const lastProjectSync = dbProject?.last_sync_at || null;

        const legacyIssues = await fetchLegacyIssues(legacyClient, projectIdentifier, lastProjectSync);
        const vibeTasks = await listVibeTasks(vibeProject.id);

        // Update project activity in database
        db.updateProjectActivity(projectIdentifier, legacyIssues.length);

        console.log(`\n[Sync] Legacy: ${legacyIssues.length} issues, Vibe: ${vibeTasks.length} tasks`);

        // Phase 1: Sync Legacy → Vibe
        console.log('[Phase 1] Syncing Legacy → Vibe...');
        const vibeTasksByTitle = new Map(vibeTasks.map(t => [t.title.toLowerCase(), t]));

        for (const legacyIssue of legacyIssues) {
          // Save issue to database
          db.upsertIssue({
            identifier: legacyIssue.identifier,
            project_identifier: projectIdentifier,
            title: legacyIssue.title,
            description: legacyIssue.description,
            status: legacyIssue.status,
            priority: legacyIssue.priority,
          });

          const existingTask = vibeTasksByTitle.get(legacyIssue.title.toLowerCase());

          if (!existingTask) {
            const createdTask = await createVibeTask(vibeClient, vibeProject.id, legacyIssue);

            if (createdTask) {
              // Update database with Vibe task ID
              db.upsertIssue({
                identifier: legacyIssue.identifier,
                project_identifier: projectIdentifier,
                vibe_task_id: createdTask.id,
              });
            }
          } else {
            // Update status if changed
            const vibeStatus = mapLegacyStatusToVibe(legacyIssue.status);
            if (vibeStatus !== existingTask.status) {
              console.log(`[Vibe] Updating task "${existingTask.title}" status: ${existingTask.status} → ${vibeStatus}`);
              await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus);
            }

            // Update database with Vibe task ID
            db.upsertIssue({
              identifier: legacyIssue.identifier,
              project_identifier: projectIdentifier,
              vibe_task_id: existingTask.id,
            });
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Phase 2: Sync Vibe → Legacy
        console.log('[Phase 2] Syncing Vibe → Legacy...');
        for (const vibeTask of vibeTasks) {
          await syncVibeTaskToLegacy(legacyClient, vibeTask, legacyIssues);
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        return { success: true, project: legacyProject.name };
      } catch (error) {
        console.error(`\n[ERROR] Failed to process project ${legacyProject.name}:`, error.message);
        return { success: false, project: legacyProject.name, error: error.message };
      }
    };

    // Process projects
    let results;
    if (config.sync.parallel) {
      console.log(`[Sync] Processing ${projectsToProcess.length} projects in parallel (max ${config.sync.maxWorkers} workers)...`);
      results = await processBatch(projectsToProcess, config.sync.maxWorkers, processProject);
    } else {
      console.log(`[Sync] Processing ${projectsToProcess.length} projects sequentially...`);
      results = [];
      for (const project of projectsToProcess) {
        const result = await processProject(project);
        results.push({ status: 'fulfilled', value: result });
      }
    }

    // Calculate stats
    const projectsProcessed = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const projectsFailed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
    const errors = results
      .filter(r => r.value?.error)
      .map(r => ({ project: r.value.project, error: r.value.error }));

    console.log('\n' + '='.repeat(60));
    console.log(`Bidirectional sync completed at ${new Date().toISOString()}`);
    console.log(`Processed ${projectsProcessed}/${projectsToProcess.length} projects successfully`);
    if (projectsFailed > 0) {
      console.log(`Failed: ${projectsFailed} projects`);
    }
    console.log('='.repeat(60));

    // Save to database
    db.setLastSync(syncStartTime);
    db.completeSyncRun(syncId, {
      projectsProcessed,
      projectsFailed,
      issuesSynced: 0, // Could track this
      errors,
      durationMs: Date.now() - syncStartTime,
    });

    // Show stats
    const dbStats = db.getStats();
    console.log(`[DB] Stats: ${dbStats.activeProjects} active, ${dbStats.emptyProjects} empty, ${dbStats.totalIssues} total issues`);

  } catch (error) {
    console.error('\n[ERROR] Sync failed:', error);
    db.completeSyncRun(syncId, {
      projectsProcessed: 0,
      projectsFailed: 0,
      errors: [{ error: error.message }],
      durationMs: Date.now() - syncStartTime,
    });
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

## 🧪 Step 4: Test

```bash
# Run locally first
npm run dev

# Check database
sqlite3 logs/sync-state.db "SELECT * FROM projects LIMIT 5;"
sqlite3 logs/sync-state.db "SELECT * FROM sync_history ORDER BY started_at DESC LIMIT 5;"

# Get stats
sqlite3 logs/sync-state.db "SELECT COUNT(*) as total, SUM(issue_count) as issues FROM projects;"
```

## 🚀 Step 5: Deploy

```bash
# Rebuild Docker image
docker-compose build

# Stop old container
docker-compose down

# Start with new code
docker-compose up -d

# Watch logs
docker-compose logs -f
```

## 📊 Benefits You'll See Immediately

### 1. Fast Queries
```javascript
// Get all projects with issues (instant, indexed)
const activeProjects = db.getActiveProjects();

// Get project history
const project = db.getProject('HULLY');
console.log(`Last synced: ${new Date(project.last_sync_at).toISOString()}`);
console.log(`Issue count: ${project.issue_count}`);
```

### 2. Historical Tracking
```javascript
// See last 10 sync runs
const history = db.getRecentSyncs(10);
history.forEach(run => {
  console.log(`${new Date(run.started_at).toISOString()}: ${run.projects_processed} projects, ${run.duration_ms}ms`);
});
```

### 3. Analytics
```javascript
const stats = db.getStats();
// {
//   totalProjects: 44,
//   activeProjects: 8,
//   emptyProjects: 36,
//   totalIssues: 342,
//   lastSync: '2025-01-27T10:30:00.000Z'
// }
```

### 4. No More Corruption
- No more race conditions
- No more partial writes
- Automatic rollback on errors

## 🔍 Troubleshooting

### Error: "Cannot find module 'better-sqlite3'"
```bash
npm install
docker-compose build --no-cache
```

### Error: "database is locked"
- SQLite WAL mode should prevent this
- Check that only one sync process is running

### Migration failed
- Check `logs/.sync-state.json.backup` exists
- Manually inspect database: `sqlite3 logs/sync-state.db .schema`

## 📈 Next Steps After Database Integration

1. ✅ Add structured logging (`lib/logger.js`)
2. ✅ Add retry logic (`lib/retry.js`)
3. ✅ Extract constants (`lib/constants.js`)
4. ✅ Add config validation
5. ✅ Break down large functions
6. ✅ Add metrics dashboard endpoint

---

**Ready to integrate? Let me know if you want me to:**
1. Update the Dockerfile
2. Create the integrated index.js
3. Write a migration script
4. Something else?
