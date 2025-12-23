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
    log.debug(
      { taskId: vibeTask.id, title: vibeTask.title },
      'Skipping Phase 2 - task updated in Phase 1'
    );
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

  // Simple status comparison - no timestamp logic (Oct 27 working version)
  if (vibeStatusMapped !== hulyStatusNormalized) {
    log.info(
      {
        identifier: hulyIdentifier,
        title: vibeTask.title,
        from: hulyStatusNormalized,
        to: vibeStatusMapped,
      },
      'Vibe→Huly: Status update'
    );

    const success = await updateHulyIssueStatus(
      hulyClient,
      hulyIdentifier,
      vibeStatusMapped,
      config
    );

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
export async function syncHulyToVibe(
  hulyClient,
  vibeClient,
  db,
  config,
  lettaService = null,
  projectId = null
) {
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

    // Optional project-scoped sync (used by /api/sync/trigger)
    let projectsToProcess = hulyProjects;
    if (projectId) {
      projectsToProcess = hulyProjects.filter(project => {
        const identifier = project.identifier || project.name;
        return identifier === projectId;
      });

      if (projectsToProcess.length === 0) {
        log.warn({ projectId }, 'Requested project not found, skipping');
        clearInterval(heartbeatInterval);
        return;
      }

      log.info({ projectId, count: projectsToProcess.length }, 'Project-scoped sync');
    }

    // Get existing Vibe projects
    const vibeProjects = await listVibeProjects(vibeClient);
    log.info({ count: vibeProjects.length }, 'Fetched existing Vibe projects');
    const vibeProjectsByName = new Map(vibeProjects.map(p => [p.name.toLowerCase(), p]));

    // Filter projects if skip empty is enabled
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
    const processProject = async hulyProject => {
      const projectIdentifier = hulyProject.identifier || hulyProject.name;
      log.info({ project: projectIdentifier, name: hulyProject.name }, 'Processing project');

      // Extract filesystem path from description
      const filesystemPath = determineGitRepoPath(hulyProject);
      if (!filesystemPath && hulyProject.description) {
        log.debug({ project: projectIdentifier, description: hulyProject.description }, 'No filesystem path found in description');
      }

      // Store/update project metadata in database
      db.upsertProject({
        identifier: projectIdentifier,
        name: hulyProject.name,
        description: hulyProject.description,
        filesystem_path: filesystemPath,
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
      const hulyIssues = await fetchHulyIssues(
        hulyClient,
        projectIdentifier,
        config,
        lastProjectSync
      );
      const vibeTasks = await listVibeTasks(vibeClient, vibeProject.id);

      // Ensure Letta PM agent exists and update memory with project state
      if (lettaService && !config.sync.dryRun) {
        try {
          let lettaInfo = db.getProjectLettaInfo(projectIdentifier);

          // Create agent if it doesn't exist
          if (!lettaInfo || !lettaInfo.letta_agent_id) {
            log.info({ project: projectIdentifier }, 'Creating Letta PM agent');
            const agent = await lettaService.ensureAgent(projectIdentifier, hulyProject.name);

            // Persist to database
            db.setProjectLettaAgent(projectIdentifier, { agentId: agent.id });
            lettaService.saveAgentId(projectIdentifier, agent.id);

            // Save to project-specific .letta folder
            const projectPath = determineGitRepoPath(hulyProject);
            if (projectPath) {
              lettaService.saveAgentIdToProjectFolder(projectPath, agent.id, {
                identifier: projectIdentifier,
                name: hulyProject.name,
              });
            }

            log.info({ project: projectIdentifier, agentId: agent.id }, 'Letta PM agent created');

            // Refresh lettaInfo after creation
            lettaInfo = db.getProjectLettaInfo(projectIdentifier);
          }

          if (lettaInfo && lettaInfo.letta_agent_id) {
            const gitRepoPath = determineGitRepoPath(hulyProject);
            const {
              buildProjectMeta,
              buildBoardConfig,
              buildBoardMetrics,
              buildHotspots,
              buildBacklogSummary,
            } = await import('./LettaService.js');

            // Build all memory blocks
            const memoryBlocks = [
              {
                label: 'project',
                value: buildProjectMeta(
                  hulyProject,
                  vibeProject,
                  gitRepoPath,
                  hulyIssues,
                  vibeTasks
                ),
              },
              { label: 'board_config', value: buildBoardConfig() },
              { label: 'board_metrics', value: buildBoardMetrics(hulyIssues, vibeTasks) },
              { label: 'hotspots', value: buildHotspots(hulyIssues, vibeTasks) },
              { label: 'backlog_summary', value: buildBacklogSummary(hulyIssues, vibeTasks) },
            ];

            // Upsert memory blocks
            await lettaService.upsertMemoryBlocks(lettaInfo.letta_agent_id, memoryBlocks);

            // Ensure folder exists and is attached to agent (for file search capability)
            if (gitRepoPath && process.env.LETTA_UPLOAD_PROJECT_FILES === 'true') {
              try {
                // Create or get existing folder
                if (!lettaInfo.letta_folder_id) {
                  log.info({ project: projectIdentifier }, 'Creating Letta folder for project files');
                  const folder = await lettaService.ensureFolder(projectIdentifier, gitRepoPath);
                  
                  // Attach folder to agent
                  await lettaService.attachFolderToAgent(lettaInfo.letta_agent_id, folder.id);
                  
                  // Persist folder ID to database
                  db.setProjectLettaAgent(projectIdentifier, {
                    agentId: lettaInfo.letta_agent_id,
                    folderId: folder.id,
                  });
                  
                  // Upload project files (only on first folder creation)
                  // Use LETTA_UPLOAD_FULL_SOURCE=true to include all source code files
                  const uploadFullSource = process.env.LETTA_UPLOAD_FULL_SOURCE === 'true';
                  const files = await lettaService.discoverProjectFiles(gitRepoPath, { 
                    docsOnly: !uploadFullSource,
                    maxFiles: parseInt(process.env.LETTA_MAX_FILES_PER_PROJECT || '500', 10)
                  });
                  if (files.length > 0) {
                    log.info({ project: projectIdentifier, fileCount: files.length, fullSource: uploadFullSource }, 'Uploading project files to Letta');
                    await lettaService.uploadProjectFiles(folder.id, gitRepoPath, files);
                  }
                  
                  // Close all files by default (agent can still search via passages)
                  await lettaService.closeAllFiles(lettaInfo.letta_agent_id);
                  
                  // Attach search_folder_passages tool so agent can search uploaded files
                  await lettaService.attachSearchFolderPassagesTool(lettaInfo.letta_agent_id);
                  
                  // Set LETTA_AGENT_ID env var so tools can auto-detect attached folders
                  await lettaService.setAgentIdEnvVar(lettaInfo.letta_agent_id);
                  
                  log.info({ project: projectIdentifier, folderId: folder.id }, 'Letta folder created and attached (files closed)');
                } else {
                  // Folder exists - do incremental sync if enabled
                  const uploadFullSource = process.env.LETTA_UPLOAD_FULL_SOURCE === 'true';
                  const incrementalSync = process.env.LETTA_INCREMENTAL_SYNC === 'true';
                  
                  if (uploadFullSource && incrementalSync) {
                    // Incremental sync - only upload changed files
                    log.info({ project: projectIdentifier, folderId: lettaInfo.letta_folder_id }, 'Running incremental file sync');
                    const files = await lettaService.discoverProjectFiles(gitRepoPath, {
                      docsOnly: false,
                      maxFiles: parseInt(process.env.LETTA_MAX_FILES_PER_PROJECT || '500', 10)
                    });
                    if (files.length > 0) {
                      const syncStats = await lettaService.syncProjectFilesIncremental(
                        lettaInfo.letta_folder_id, 
                        gitRepoPath, 
                        files, 
                        db, 
                        projectIdentifier
                      );
                      log.info({ project: projectIdentifier, ...syncStats }, 'Incremental sync complete');
                    }
                  } else {
                    // Check if folder is empty and retry file upload if needed
                    const existingFiles = await lettaService.listFolderFiles(lettaInfo.letta_folder_id);
                    if (existingFiles.length === 0) {
                      log.info({ project: projectIdentifier, folderId: lettaInfo.letta_folder_id }, 'Folder exists but empty, uploading files');
                      const files = await lettaService.discoverProjectFiles(gitRepoPath, {
                        docsOnly: !uploadFullSource,
                        maxFiles: parseInt(process.env.LETTA_MAX_FILES_PER_PROJECT || '500', 10)
                      });
                      if (files.length > 0) {
                        log.info({ project: projectIdentifier, fileCount: files.length, fullSource: uploadFullSource }, 'Uploading project files to Letta');
                        await lettaService.uploadProjectFiles(lettaInfo.letta_folder_id, gitRepoPath, files);
                      }
                    }
                  }
                  
                  // Ensure search_folder_passages tool is attached (idempotent)
                  await lettaService.attachSearchFolderPassagesTool(lettaInfo.letta_agent_id);
                  
                  // Ensure LETTA_AGENT_ID env var is set (idempotent)
                  await lettaService.setAgentIdEnvVar(lettaInfo.letta_agent_id);
                }
              } catch (folderError) {
                log.warn(
                  { err: folderError, project: projectIdentifier },
                  'Letta folder setup failed (non-fatal)'
                );
              }
            }

            // Update last sync timestamp
            db.setProjectLettaSyncAt(projectIdentifier, Date.now());
          }
        } catch (lettaError) {
          log.error(
            { err: lettaError, project: projectIdentifier },
            'Letta PM agent memory update failed'
          );
        }
      } else if (config.sync.dryRun) {
        log.debug({ project: projectIdentifier }, 'DRY RUN: Would update Letta PM agent memory');
      }

      // Track which tasks were updated in Phase 1
      const phase1UpdatedTasks = new Set();

      // PHASE 1: Huly → Vibe (source of truth: Huly)
      log.info(
        { count: hulyIssues.length, phase: 1, project: projectIdentifier },
        'Syncing Huly issues to Vibe'
      );

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
               huly_modified_at: hulyIssue.modifiedOn ?? null,

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

          // Track whether we actually updated Vibe during this pass
          let vibeStatusUpdated = false;
          let vibeDescriptionUpdated = false;

          // Capture current Vibe timestamp from API response (if provided)
          const currentVibeTimestamp = existingTask.updated_at
            ? new Date(existingTask.updated_at).getTime()
            : null;

          // Check description changes
          if (fullHulyDescription !== existingTask.description) {
            const hulyDescChanged =
              lastKnownHulyDesc !== undefined && hulyIssue.description !== lastKnownHulyDesc;

            if (hulyDescChanged) {
              log.debug(
                { identifier: hulyIssue.identifier, title: existingTask.title },
                'Huly→Vibe: Updating description'
              );
              await updateVibeTaskDescription(
                vibeClient,
                existingTask.id,
                fullHulyDescription,
                config
              );
              phase1UpdatedTasks.add(existingTask.id);
              vibeDescriptionUpdated = true;
            }
          }

          // Check status changes
          const statusesMatch =
            normalizeStatus(existingTask.status) === normalizeStatus(vibeStatus);

          if (!dbIssue) {
            // First time seeing this issue
            if (!statusesMatch) {
              log.info(
                {
                  identifier: hulyIssue.identifier,
                  title: existingTask.title,
                  from: existingTask.status,
                  to: vibeStatus,
                },
                'Huly→Vibe: First sync'
              );
              await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus, config);
              phase1UpdatedTasks.add(existingTask.id);
              vibeStatusUpdated = true;
            }
          } else {
            // We have history - check what changed
            const hulyChanged = hulyIssue.status !== lastKnownHulyStatus;
            const vibeChanged = existingTask.status !== lastKnownVibeStatus;

            if (hulyChanged && vibeChanged) {
              // Both changed - conflict! Huly wins
              log.warn(
                {
                  identifier: hulyIssue.identifier,
                  title: existingTask.title,
                  hulyStatus: hulyIssue.status,
                },
                'Conflict detected - both systems changed, Huly wins'
              );
              if (!statusesMatch) {
                await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus, config);
                phase1UpdatedTasks.add(existingTask.id);
                vibeStatusUpdated = true;
              }
            } else if (hulyChanged && !vibeChanged) {
              // Only Huly changed - update Vibe
              if (!statusesMatch) {
                log.info(
                  {
                    identifier: hulyIssue.identifier,
                    title: existingTask.title,
                    from: existingTask.status,
                    to: vibeStatus,
                  },
                  'Huly→Vibe: Status update'
                );
                await updateVibeTaskStatus(vibeClient, existingTask.id, vibeStatus, config);
                phase1UpdatedTasks.add(existingTask.id);
                vibeStatusUpdated = true;
              }
            }
          }

          // Capture the status/timestamp we will persist to the sync database
          const storedVibeStatus = vibeStatusUpdated ? vibeStatus : existingTask.status;
          const storedVibeModifiedAt =
            vibeStatusUpdated || vibeDescriptionUpdated ? Date.now() : currentVibeTimestamp;

          // Update database with latest state including timestamp
          db.upsertIssue({
            identifier: hulyIssue.identifier,
            project_identifier: projectIdentifier,
            title: hulyIssue.title,
            description: hulyIssue.description,
            status: hulyIssue.status,
            priority: hulyIssue.priority,
            vibe_task_id: existingTask.id,
            vibe_status: storedVibeStatus,
             huly_modified_at: hulyIssue.modifiedOn ?? null,

            vibe_modified_at: storedVibeModifiedAt || null,
          });
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
      }

      // PHASE 2: Vibe → Huly (check for changes made in Vibe)
      log.info(
        { count: vibeTasks.length, phase: 2, project: projectIdentifier },
        'Checking Vibe tasks for changes to Huly'
      );

      for (const vibeTask of vibeTasks) {
        await syncVibeTaskToHuly(
          hulyClient,
          vibeTask,
          hulyIssues,
          projectIdentifier,
          db,
          config,
          phase1UpdatedTasks,
          log
        );

        // Small delay
        await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
      }

      // PHASE 3: Beads ↔ Huly (bidirectional sync with beads if enabled)
      if (config.beads?.enabled) {
        const { listBeadsIssues, syncHulyIssueToBeads, syncBeadsIssueToHuly, ensureBeadsInitialized, syncBeadsToGit } = await import(
          './BeadsService.js'
        );

        const gitRepoPath = determineGitRepoPath(hulyProject);

        // Only sync if project has a git repository path
        if (gitRepoPath) {
          // Ensure beads is initialized in the project directory
          const isInitialized = await ensureBeadsInitialized(gitRepoPath, {
            projectName: hulyProject.name,
            projectIdentifier: projectIdentifier,
          });
          
          if (!isInitialized) {
            log.warn(
              { project: projectIdentifier, path: gitRepoPath },
              'Failed to initialize beads, skipping beads sync'
            );
          } else {
            log.info(
              { count: hulyIssues.length, phase: 3, project: projectIdentifier },
              'Syncing Huly issues to Beads'
            );

            // Fetch beads issues (snapshot for Phase 3a lookups)
            const beadsIssues = await listBeadsIssues(gitRepoPath);

            // Track which beads issues were updated in Phase 3a
            const phase3UpdatedIssues = new Set();

            // Phase 3a: Huly → Beads (create/update beads issues)
            for (const hulyIssue of hulyIssues) {
              const beadsIssue = await syncHulyIssueToBeads(
                gitRepoPath,
                hulyIssue,
                beadsIssues,
                db,
                config
              );

              if (beadsIssue) {
                phase3UpdatedIssues.add(beadsIssue.id);
              }

              // Small delay
              await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
            }

            // Re-fetch beads issues after Phase 3a to avoid using stale data.
            // This ensures Beads→Huly sees changes made via bd CLI.
            const beadsIssuesAfterPhase3a = await listBeadsIssues(gitRepoPath);

            // Phase 3b: Beads → Huly (check for status changes in beads)
            log.info(
              { count: beadsIssuesAfterPhase3a.length, phase: '3b', project: projectIdentifier },
              'Checking Beads issues for changes to Huly'
            );

            for (const beadsIssue of beadsIssuesAfterPhase3a) {
              await syncBeadsIssueToHuly(
                hulyClient,
                beadsIssue,
                hulyIssues,
                projectIdentifier,
                db,
                config,
                phase3UpdatedIssues
              );

              // Small delay
              await new Promise(resolve => setTimeout(resolve, config.sync.apiDelay));
            }

            // Sync beads changes to git and push to remote
            if (!config.sync.dryRun) {
              await syncBeadsToGit(gitRepoPath, {
                projectIdentifier: projectIdentifier,
              });
            }
          }
        } else {
          log.debug(
            { project: projectIdentifier },
            'Skipping Beads sync - no git repository path found'
          );
        }
      }

      // Update project activity (issue count and last sync time)
      db.updateProjectActivity(projectIdentifier, hulyIssues.length);

      log.info(
        { project: hulyProject.name, issuesCount: hulyIssues.length },
        'Project sync completed'
      );
    };

    // Process projects (parallel or sequential)
    if (config.sync.parallel) {
      log.info(
        { count: projectsToProcess.length, maxWorkers: config.sync.maxWorkers },
        'Processing projects in parallel'
      );
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

    log.info(
      {
        syncId,
        durationMs: syncDuration,
        durationSeconds: (syncDuration / 1000).toFixed(2),
        projectsProcessed,
        issuesSynced,
      },
      'Sync completed successfully'
    );

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
    sync: (hulyClient, vibeClient) =>
      syncHulyToVibe(hulyClient, vibeClient, db, config, lettaService),
  };
}
