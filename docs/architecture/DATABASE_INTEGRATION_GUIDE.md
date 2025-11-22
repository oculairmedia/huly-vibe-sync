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
cd /opt/stacks/huly-vibe-sync
npm install
```

## 🐳 Step 2: Update Dockerfile

The `better-sqlite3` package requires native compilation. Update the Dockerfile:

```dockerfile
FROM node:20-alpine

LABEL maintainer="Oculair Media"
LABEL description="Huly to Vibe Kanban bidirectional sync service"

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

### Update: syncHulyToVibe Function

```javascript
async function syncHulyToVibe(hulyClient, vibeClient) {
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
    // Fetch Huly projects
    const hulyProjects = await fetchHulyProjects(hulyClient);
    if (hulyProjects.length === 0) {
      console.log('No Huly projects found. Skipping sync.');
      clearInterval(heartbeatInterval);
      db.completeSyncRun(syncId, { projectsProcessed: 0, projectsFailed: 0 });
      return;
    }

    console.log(`[Huly] Found ${hulyProjects.length} projects\n`);

    // Get existing Vibe projects
    const vibeProjects = await listVibeProjects(vibeClient);
    console.log(`[Vibe] Found ${vibeProjects.length} existing projects\n`);
    const vibeProjectsByName = new Map(vibeProjects.map(p => [p.name.toLowerCase(), p]));

    // Filter projects using database
    let projectsToProcess = hulyProjects;
    if (config.sync.skipEmpty) {
      projectsToProcess = db.getProjectsToSync(300000); // 5 minute cache
      console.log(`[DB] Processing ${projectsToProcess.length}/${hulyProjects.length} projects (skipping cached empty)`);
    }

    // Function to process a single project
    const processProject = async (hulyProject) => {
      try {
        console.log(`\n--- Processing Huly project: ${hulyProject.name} ---`);

        // Upsert project to database
        db.upsertProject({
          identifier: hulyProject.identifier,
          name: hulyProject.name,
          filesystem_path: extractFilesystemPath(hulyProject.description),
        });

        // Check if project exists in Vibe
        let vibeProject = vibeProjectsByName.get(hulyProject.name.toLowerCase());

        if (!vibeProject) {
          console.log(`[Vibe] Project not found, attempting to create: ${hulyProject.name}`);
          const createdProject = await createVibeProject(hulyProject);

          if (createdProject) {
            vibeProject = createdProject;
            vibeProjectsByName.set(hulyProject.name.toLowerCase(), vibeProject);
            
            // Update database with Vibe ID
            db.upsertProject({
              identifier: hulyProject.identifier,
              vibe_id: vibeProject.id,
            });
          } else {
            console.log(`[Skip] Could not create project: ${hulyProject.name}`);
            return { success: false, project: hulyProject.name };
          }
        } else {
          console.log(`[Vibe] ✓ Found existing project: ${hulyProject.name}`);
          
          // Update database with Vibe ID
          db.upsertProject({
            identifier: hulyProject.identifier,
            vibe_id: vibeProject.id,
          });
        }

        // Fetch issues (use last sync from database)
        const projectIdentifier = hulyProject.identifier || hulyProject.name;
        const dbProject = db.getProject(projectIdentifier);
        const lastProjectSync = dbProject?.last_sync_at || null;
        
        const hulyIssues = await fetchHulyIssues(hulyClient, projectIdentifier, lastProjectSync);
        const vibeTasks = await listVibeTasks(vibeProject.id);

        // Update project activity in database
        db.updateProjectActivity(projectIdentifier, hulyIssues.length);

        console.log(`\n[Sync] Huly: ${hulyIssues.length} issues, Vibe: ${vibeTasks.length} tasks`);

        // Phase 1: Sync Huly → Vibe
        console.log('[Phase 1] Syncing Huly → Vibe...');
        const vibeTasksByTitle = new Map(vibeTasks.map(t => [t.title.toLowerCase(), t]));

        for (const hulyIssue of hulyIssues) {
          // Save issue to database
          db.upsertIssue({
            identifier: hulyIssue.identifier,
            project_identifier: projectIdentifier,
            title: hulyIssue.title,
            description: hulyIssue.description,
            status: hulyIssue.status,
            priority: hulyIssue.priority,
          });

          const existingTask = vibeTasksByTitle.get(hulyIssue.title.toLowerCase());

          if (!existingTask) {
            const createdTask = await createVibeTask(vibeClient, vibeProject.id, hulyIssue);
            
            if (createdTask) {
              // Update database with Vibe task ID
              db.upsertIssue({
                identifier: hulyIssue.identifier,
                project_identifier: projectIdentifier,
                vibe_task_id: createdTask.id,
              });
            }
          } else {
            // Update status if changed
            const vibeStatus = mapHulyStatusToVibe(hulyIssue.status);
            if (vibeStatus !== existingTask.status) {
              console.log(`[Vibe] Updating task "${existingTask.title}" status: ${existingTask.status} → ${vibeStatus}`);
              await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus);
            }
            
            // Update database with Vibe task ID
            db.upsertIssue({
              identifier: hulyIssue.identifier,
              project_identifier: projectIdentifier,
              vibe_task_id: existingTask.id,
            });
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Phase 2: Sync Vibe → Huly
        console.log('[Phase 2] Syncing Vibe → Huly...');
        for (const vibeTask of vibeTasks) {
          await syncVibeTaskToHuly(hulyClient, vibeTask, hulyIssues);
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        return { success: true, project: hulyProject.name };
      } catch (error) {
        console.error(`\n[ERROR] Failed to process project ${hulyProject.name}:`, error.message);
        return { success: false, project: hulyProject.name, error: error.message };
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
