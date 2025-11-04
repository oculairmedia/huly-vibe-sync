/**
 * Sync Orchestrator
 * 
 * Orchestrates bidirectional synchronization between Huly and Vibe Kanban
 * Handles project filtering, Phase 1 (Huly→Vibe) and Phase 2 (Vibe→Huly) sync
 */

import { fetchHulyProjects, fetchHulyIssues } from './HulyService.js';
import {
  listVibeProjects,
  createVibeProject,
  listVibeTasks,
  createVibeTask,
  updateVibeTaskStatus,
  updateVibeTaskDescription,
} from './VibeService.js';
import { mapHulyStatusToVibe, normalizeStatus } from './statusMapper.js';
import { extractHulyIdentifier, determineGitRepoPath } from './textParsers.js';
import { processBatch } from './utils.js';
import { createSyncLogger } from './logger.js';
import { recordSyncStats } from './HealthService.js';
import fs from 'fs';

/**
 * Sync task status changes from Vibe back to Huly (bidirectional Phase 2)
 * 
 * @param {Object} hulyClient - Huly client
 * @param {Object} vibeTask - Vibe task object
 * @param {Array} hulyIssues - Array of Huly issues
 * @param {string} projectIdentifier - Project identifier
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @param {Set} phase1UpdatedTasks - Set of task IDs updated in Phase 1
 * @param {Object} log - Logger instance with syncId
 */
async function syncVibeTaskToHuly(
  hulyClient,
  vibeTask,
  hulyIssues,
  projectIdentifier,
  db,
  config,
  phase1UpdatedTasks = new Set(),
  log
) {
  const { updateHulyIssueStatus, updateHulyIssueDescription } = await import('./HulyService.js');
  const { mapVibeStatusToHuly } = await import('./statusMapper.js');
  
  // Skip if this task was just updated in Phase 1
  if (phase1UpdatedTasks.has(vibeTask.id)) {
    log.debug({ taskId: vibeTask.id, title: vibeTask.title }, 'Skipping Phase 2 - task updated in Phase 1');
    return;
  }

  // Extract Huly identifier from task description
  const hulyIdentifier = extractHulyIdentifier(vibeTask.description);

  if (!hulyIdentifier) {
    return; // Not synced from Huly, skip
  }

  // Find corresponding Huly issue
  const hulyIssue = hulyIssues.find(issue => issue.identifier === hulyIdentifier);

  if (!hulyIssue) {
    log.debug({ hulyIdentifier }, 'Huly issue not found, skipping');
    return;
  }

  // Map Vibe status to Huly status
  const vibeStatusMapped = mapVibeStatusToHuly(vibeTask.status);
  const hulyStatusNormalized = hulyIssue.status || 'Backlog';

  // Check database to see if Huly recently changed
  const dbIssue = db.getIssue(hulyIdentifier);
  const lastKnownHulyStatus = dbIssue?.status;

  // Check for description changes (Vibe → Huly)
  const vibeDescWithoutFooter = vibeTask.description?.replace(/\n\n---\nHuly Issue: [A-Z]+-\d+$/,'') || '';
  const hulyDesc = hulyIssue.description || '';
  
  if (vibeDescWithoutFooter !== hulyDesc) {
    const lastKnownHulyDesc = dbIssue?.description;
    const hulyDescChanged = lastKnownHulyDesc && hulyDesc !== lastKnownHulyDesc;
    
    if (!hulyDescChanged) {
      log.info({ identifier: hulyIdentifier, title: vibeTask.title }, 'Vibe→Huly: Updating description');
      await updateHulyIssueDescription(hulyClient, hulyIdentifier, vibeDescWithoutFooter, config);
      
      db.upsertIssue({
        identifier: hulyIdentifier,
        project_identifier: projectIdentifier,
        description: vibeDescWithoutFooter,
      });
    }
  }

  // Only update if statuses differ
  if (vibeStatusMapped !== hulyStatusNormalized) {
    const hulyChanged = lastKnownHulyStatus && hulyIssue.status !== lastKnownHulyStatus;
    
    if (hulyChanged) {
      log.debug({ title: vibeTask.title }, 'Skipping Phase 2 - Huly changed, letting Phase 1 handle it');
      return;
    }
    
    log.info({ 
      identifier: hulyIdentifier, 
      title: vibeTask.title,
      from: hulyStatusNormalized,
      to: vibeStatusMapped
    }, 'Vibe→Huly: Status update');
    const success = await updateHulyIssueStatus(hulyClient, hulyIdentifier, vibeStatusMapped, config);
    
    if (success) {
      db.upsertIssue({
        identifier: hulyIdentifier,
        project_identifier: projectIdentifier,
        status: vibeStatusMapped,
        vibe_task_id: vibeTask.id,
      });
    }
  }
}

/**
 * Main bidirectional sync orchestration
 * 
 * @param {Object} hulyClient - Huly REST client
 * @param {Object} vibeClient - Vibe REST client
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @param {Object} lettaService - Letta service instance (optional)
 */
export async function syncHulyToVibe(hulyClient, vibeClient, db, config, lettaService = null) {
  // Start tracking this sync run
  const syncId = db.startSyncRun();
  const syncStartTime = Date.now();
  
  // Create logger with syncId correlation
  const log = createSyncLogger(syncId);

  log.info({ syncId }, 'Starting bidirectional sync');

  // Get last sync timestamp from database
  const lastSync = db.getLastSync();
  if (lastSync) {
    log.info({ lastSync: new Date(lastSync).toISOString() }, 'Last sync timestamp');
  }

  // Setup heartbeat logging
  const heartbeatInterval = setInterval(() => {
    log.debug('Sync heartbeat - still running');
  }, 30000); // Log every 30 seconds

  try {
    // Fetch Huly projects
    const hulyProjects = await fetchHulyProjects(hulyClient, config);
    if (hulyProjects.length === 0) {
      log.info('No Huly projects found, skipping sync');
      clearInterval(heartbeatInterval);
      return;
    }

    log.info({ count: hulyProjects.length }, 'Fetched Huly projects');

    // Get existing Vibe projects
    const vibeProjects = await listVibeProjects(vibeClient);
    log.info({ count: vibeProjects.length }, 'Fetched existing Vibe projects');
    const vibeProjectsByName = new Map(vibeProjects.map(p => [p.name.toLowerCase(), p]));

    // Filter projects if skip empty is enabled
    let projectsToProcess = hulyProjects;
    if (config.sync.skipEmpty) {
      log.debug('Querying projects to sync (checking for changes and skipping empty projects)');
      
      const { SyncDatabase } = await import('./database.js');
      const descriptionHashes = {};
      for (const project of hulyProjects) {
        const identifier = project.identifier || project.name;
        descriptionHashes[identifier] = SyncDatabase.computeDescriptionHash(project.description);
      }
      
      const projectsNeedingSync = db.getProjectsToSync(300000, descriptionHashes);
      const projectsNeedingSyncSet = new Set(projectsNeedingSync.map(p => p.identifier));

      const activeProjects = hulyProjects.filter(project => {
        const identifier = project.identifier || project.name;
        return projectsNeedingSyncSet.has(identifier);
      });

      const skippedCount = hulyProjects.length - activeProjects.length;
      projectsToProcess = activeProjects;

      if (skippedCount > 0) {
        log.info({ skippedCount }, 'Skipping empty/unchanged projects');
      }
      log.info({ toProcess: projectsToProcess.length }, 'Projects filtered and ready');
    }

    if (projectsToProcess.length === 0 && config.sync.dryRun) {
      log.info('DRY RUN: No projects to process');
      clearInterval(heartbeatInterval);
      return;
    }

    // Process projects
    const processProject = async (hulyProject) => {
      const projectIdentifier = hulyProject.identifier || hulyProject.name;
      log.info({ project: projectIdentifier, name: hulyProject.name }, 'Processing project');

      // Store/update project metadata in database
      db.upsertProject({
        identifier: projectIdentifier,
        name: hulyProject.name,
        description: hulyProject.description,
        status: 'active',
      });

      // Find or create corresponding Vibe project
      let vibeProject = vibeProjectsByName.get(hulyProject.name.toLowerCase());

      if (!vibeProject) {
        // Attempt to create the project
        log.info({ project: hulyProject.name }, 'Vibe project not found, creating');
        const createdProject = await createVibeProject(vibeClient, hulyProject, config);

        if (createdProject) {
          vibeProject = createdProject;
          vibeProjectsByName.set(hulyProject.name.toLowerCase(), vibeProject);
          log.info({ project: hulyProject.name }, 'Vibe project created successfully');
        } else {
          log.warn({ project: hulyProject.name }, 'Failed to create Vibe project, skipping');
          return;
        }
      }

      // Fetch issues from Huly (with incremental sync support)
      const dbProject = db.getProject(projectIdentifier);
      const lastProjectSync = dbProject?.last_sync_at || lastSync;
      const hulyIssues = await fetchHulyIssues(hulyClient, projectIdentifier, config, lastProjectSync);
      const vibeTasks = await listVibeTasks(vibeClient, vibeProject.id);

      // Update Letta PM agent memory with project state
      if (lettaService && !config.sync.dryRun) {
        try {
          const lettaInfo = db.getProjectLettaInfo(projectIdentifier);
          
          if (lettaInfo && lettaInfo.letta_agent_id) {
            const gitRepoPath = determineGitRepoPath(hulyProject);
            const { buildProjectMeta, buildBoardConfig, buildBoardMetrics, buildHotspots, buildBacklogSummary } = 
              await import('./LettaService.js');

            // Build all memory blocks
            const memoryBlocks = [
              { label: 'project', value: buildProjectMeta(hulyProject, vibeProject, gitRepoPath, hulyIssues, vibeTasks) },
              { label: 'board_config', value: buildBoardConfig() },
              { label: 'board_metrics', value: buildBoardMetrics(hulyIssues, vibeTasks) },
              { label: 'hotspots', value: buildHotspots(hulyIssues, vibeTasks) },
              { label: 'backlog_summary', value: buildBacklogSummary(hulyIssues, vibeTasks) },
            ];

            // Upsert memory blocks
            await lettaService.upsertMemoryBlocks(lettaInfo.letta_agent_id, memoryBlocks);
            
            // Update last sync timestamp
            db.setProjectLettaSyncAt(projectIdentifier, Date.now());
          }
        } catch (lettaError) {
          log.error({ err: lettaError, project: projectIdentifier }, 'Letta PM agent memory update failed');
        }
      } else if (config.sync.dryRun) {
        log.debug({ project: projectIdentifier }, 'DRY RUN: Would update Letta PM agent memory');
      }

      // Track which tasks were updated in Phase 1
      const phase1UpdatedTasks = new Set();

      // PHASE 1: Huly → Vibe (source of truth: Huly)
      log.info({ count: hulyIssues.length, phase: 1, project: projectIdentifier }, 'Syncing Huly issues to Vibe');

      for (const hulyIssue of hulyIssues) {
        // Find existing task by Huly identifier
        const existingTask = vibeTasks.find(task => {
          const taskHulyId = extractHulyIdentifier(task.description);
          return taskHulyId === hulyIssue.identifier;
        });

        if (!existingTask) {
          const createdTask = await createVibeTask(vibeClient, vibeProject.id, hulyIssue, config);

          if (createdTask) {
            db.upsertIssue({
              identifier: hulyIssue.identifier,
              project_identifier: projectIdentifier,
              title: hulyIssue.title,
              description: hulyIssue.description,
              status: hulyIssue.status,
              priority: hulyIssue.priority,
              vibe_task_id: createdTask.id,
            });
          }
        } else {
          // Task exists - check for updates from Huly
          const vibeStatus = mapHulyStatusToVibe(hulyIssue.status);
          const dbIssue = db.getIssue(hulyIssue.identifier);
          const lastKnownHulyStatus = dbIssue?.status;
          const lastKnownHulyDesc = dbIssue?.description;
          const lastKnownVibeStatus = dbIssue?.vibe_status;

          const fullHulyDescription = hulyIssue.description
            ? `${hulyIssue.description}\n\n---\nHuly Issue: ${hulyIssue.identifier}`
            : `Synced from Huly: ${hulyIssue.identifier}`;

          // Check description changes
          if (fullHulyDescription !== existingTask.description) {
            const hulyDescChanged = lastKnownHulyDesc && hulyIssue.description !== lastKnownHulyDesc;

            if (hulyDescChanged) {
              log.debug({ identifier: hulyIssue.identifier, title: existingTask.title }, 'Huly→Vibe: Updating description');
              await updateVibeTaskDescription(vibeClient, existingTask.id, fullHulyDescription, config);
              phase1UpdatedTasks.add(existingTask.id);
            }
          }

          // Check status changes
          const statusesMatch = normalizeStatus(existingTask.status) === normalizeStatus(vibeStatus);

          if (!dbIssue) {
            // First time seeing this issue
            if (!statusesMatch) {
              log.info({ 
                identifier: hulyIssue.identifier,
                title: existingTask.title, 
                from: existingTask.status, 
                to: vibeStatus 
              }, 'Huly→Vibe: First sync');
              await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus, config);
            }
          } else {
            // We have history - check what changed
            const hulyChanged = hulyIssue.status !== lastKnownHulyStatus;
            const vibeChanged = existingTask.status !== lastKnownVibeStatus;

            if (hulyChanged && vibeChanged) {
              // Both changed - conflict! Huly wins
              log.warn({ 
                identifier: hulyIssue.identifier,
                title: existingTask.title, 
                hulyStatus: hulyIssue.status 
              }, 'Conflict detected - both systems changed, Huly wins');
              if (!statusesMatch) {
                await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus, config);
                phase1UpdatedTasks.add(existingTask.id);
              }
            } else if (hulyChanged && !vibeChanged) {
              // Only Huly changed - update Vibe
              if (!statusesMatch) {
                log.info({ 
                  identifier: hulyIssue.identifier,
                  title: existingTask.title, 
                  from: existingTask.status, 
                  to: vibeStatus 
                }, 'Huly→Vibe: Status update');
                await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus, config);
                phase1UpdatedTasks.add(existingTask.id);
              }
            }
          }

          // Update database with latest state
          db.upsertIssue({
            identifier: hulyIssue.identifier,
            project_identifier: projectIdentifier,
            title: hulyIssue.title,
            description: hulyIssue.description,
            status: hulyIssue.status,
            priority: hulyIssue.priority,
            vibe_task_id: existingTask.id,
            vibe_status: existingTask.status,
          });
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
      }

      // PHASE 2: Vibe → Huly (check for changes made in Vibe)
      log.info({ count: vibeTasks.length, phase: 2, project: projectIdentifier }, 'Checking Vibe tasks for changes to Huly');

      for (const vibeTask of vibeTasks) {
        await syncVibeTaskToHuly(hulyClient, vibeTask, hulyIssues, projectIdentifier, db, config, phase1UpdatedTasks, log);

        // Small delay
        await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
      }

      // Update project activity (issue count and last sync time)
      db.updateProjectActivity(projectIdentifier, hulyIssues.length);

      log.info({ project: hulyProject.name, issuesCount: hulyIssues.length }, 'Project sync completed');
    };

    // Process projects (parallel or sequential)
    if (config.sync.parallel) {
      log.info({ count: projectsToProcess.length, maxWorkers: config.sync.maxWorkers }, 'Processing projects in parallel');
      await processBatch(projectsToProcess, processProject, config.sync.maxWorkers);
    } else {
      log.info({ count: projectsToProcess.length }, 'Processing projects sequentially');
      for (const project of projectsToProcess) {
        await processProject(project);
      }
    }

    // Complete sync run
    const syncDuration = Date.now() - syncStartTime;
    const projectsProcessed = projectsToProcess.length;
    const issuesSynced = projectsToProcess.reduce((sum, p) => {
      const dbProject = db.getProject(p.identifier || p.name);
      return sum + (dbProject?.issue_count || 0);
    }, 0);

    db.completeSyncRun(syncId, projectsProcessed, issuesSynced);

    // Record metrics
    recordSyncStats(projectsProcessed, issuesSynced);

    log.info({ 
      syncId,
      durationMs: syncDuration,
      durationSeconds: (syncDuration / 1000).toFixed(2),
      projectsProcessed,
      issuesSynced
    }, 'Sync completed successfully');

    clearInterval(heartbeatInterval);
  } catch (error) {
    clearInterval(heartbeatInterval);
    log.error({ syncId, err: error }, 'Sync failed');
    throw error;
  }
}

/**
 * Create a sync orchestrator with bound dependencies
 * Factory pattern for easier testing and dependency injection
 * 
 * @param {Object} db - Database instance
 * @param {Object} config - Configuration object
 * @param {Object} lettaService - Letta service instance (optional)
 * @returns {Object} Orchestrator with bound methods
 */
export function createSyncOrchestrator(db, config, lettaService = null) {
  return {
    sync: (hulyClient, vibeClient) => syncHulyToVibe(hulyClient, vibeClient, db, config, lettaService),
  };
}
