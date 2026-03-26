"use strict";
/**
 * Project Sync Workflow — Simplified 4-Phase Pipeline
 *
 * Handles syncing a single project with continueAsNew for large issue counts.
 *
 * Phases: init → sync → agent → done
 *   init:  Discover project in registry, init beads, provision/reconcile agent
 *   sync:  Read beads issues, persist to registry DB (for MCP queries)
 *   agent: Update Letta agent memory with latest issue summary
 *   done:  Record metrics, commit beads changes if any
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectSyncWorkflow = ProjectSyncWorkflow;
const workflow_1 = require("@temporalio/workflow");
const agent_provisioning_1 = require("./agent-provisioning");
// ============================================================
// ACTIVITY PROXIES
// ============================================================
const { initializeBeads, fetchBeadsIssues, updateLettaMemory } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
const { commitBeadsToGit } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
        maximumAttempts: 3,
    },
});
const { persistIssueSyncStateBatch } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '60 seconds',
    retry: {
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '20 seconds',
        maximumAttempts: 3,
    },
});
const { checkAgentExists, updateProjectAgent } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '60 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '30 seconds',
        maximumAttempts: 3,
    },
});
function extractGitRepoPath(description) {
    if (!description)
        return null;
    const patterns = [
        /Filesystem:\s*([^\n]+)/i,
        /Path:\s*([^\n]+)/i,
        /Directory:\s*([^\n]+)/i,
        /Location:\s*([^\n]+)/i,
    ];
    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match) {
            const path = match[1].trim().replace(/[,;.]$/, '');
            if (path.startsWith('/'))
                return path;
        }
    }
    return null;
}
async function ProjectSyncWorkflow(input) {
    const { project, batchSize, enableBeads, enableLetta, dryRun, _phase = 'init', _accumulatedResult, _gitRepoPath, _beadsInitialized = false, } = input;
    workflow_1.log.info(`[ProjectSync] Processing: ${project.identifier}`, { phase: _phase });
    const result = _accumulatedResult || {
        projectIdentifier: project.identifier,
        projectName: project.name,
        success: false,
        beadsSync: { synced: 0, skipped: 0, errors: 0 },
        lettaUpdated: false,
    };
    let gitRepoPath = _gitRepoPath;
    let beadsInitialized = _beadsInitialized;
    try {
        // ── INIT: discover project, init beads, provision agent ──
        if (_phase === 'init') {
            gitRepoPath = extractGitRepoPath(project.description);
            if (enableBeads && gitRepoPath) {
                beadsInitialized = await initializeBeads({
                    gitRepoPath,
                    projectName: project.name,
                    projectIdentifier: project.identifier,
                });
            }
            if (enableLetta && gitRepoPath) {
                try {
                    const agentCheck = await checkAgentExists({
                        projectIdentifier: project.identifier,
                    });
                    if (agentCheck.exists) {
                        workflow_1.log.info(`[ProjectSync] Agent exists for ${project.identifier}, reconciling: ${agentCheck.agentId}`);
                    }
                    else {
                        workflow_1.log.info(`[ProjectSync] Provisioning PM agent for ${project.identifier}...`);
                    }
                    const provisionResult = await (0, workflow_1.executeChild)(agent_provisioning_1.ProvisionSingleAgentWorkflow, {
                        workflowId: `provision-${project.identifier}-${Date.now()}`,
                        args: [
                            {
                                projectIdentifier: project.identifier,
                                projectName: project.name,
                                attachTools: true,
                            },
                        ],
                    });
                    if (provisionResult.success && provisionResult.agentId) {
                        await updateProjectAgent({
                            projectIdentifier: project.identifier,
                            agentId: provisionResult.agentId,
                        });
                        workflow_1.log.info(`[ProjectSync] PM agent reconciled: ${provisionResult.agentId}`);
                    }
                    else if (!provisionResult.success) {
                        workflow_1.log.warn(`[ProjectSync] Agent provisioning failed: ${provisionResult.error}`);
                    }
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    workflow_1.log.warn(`[ProjectSync] Agent provisioning failed, continuing sync: ${errorMsg}`);
                }
            }
            return await (0, workflow_1.continueAsNew)({
                ...input,
                _phase: 'sync',
                _gitRepoPath: gitRepoPath,
                _beadsInitialized: beadsInitialized,
                _accumulatedResult: result,
            });
        }
        // ── SYNC: read beads issues, persist to registry DB ──
        if (_phase === 'sync') {
            if (enableBeads && beadsInitialized && gitRepoPath) {
                workflow_1.log.info(`[ProjectSync] Sync phase: reading beads issues`);
                const beadsIssues = await fetchBeadsIssues({ gitRepoPath });
                if (beadsIssues.length > 0 && !dryRun) {
                    const persistenceBatch = beadsIssues.map((issue) => {
                        const hulyLabel = issue.labels?.find((l) => l.startsWith('huly:'));
                        const hulyIdentifier = hulyLabel?.replace('huly:', '') || `${project.identifier}-${issue.id}`;
                        return {
                            identifier: hulyIdentifier,
                            projectIdentifier: project.identifier,
                            title: issue.title,
                            description: issue.description,
                            status: issue.status,
                            beadsIssueId: issue.id,
                            beadsStatus: issue.status,
                            beadsModifiedAt: Date.now(),
                        };
                    });
                    await persistIssueSyncStateBatch({ issues: persistenceBatch });
                    result.beadsSync.synced = beadsIssues.length;
                }
                else {
                    result.beadsSync.skipped = beadsIssues.length;
                }
                workflow_1.log.info(`[ProjectSync] Sync phase complete`, {
                    synced: result.beadsSync.synced,
                    skipped: result.beadsSync.skipped,
                });
            }
            else {
                workflow_1.log.info(`[ProjectSync] Sync phase: skipped (beads not initialized or disabled)`);
            }
            return await (0, workflow_1.continueAsNew)({
                ...input,
                _phase: 'agent',
                _gitRepoPath: gitRepoPath,
                _beadsInitialized: beadsInitialized,
                _accumulatedResult: result,
            });
        }
        // ── AGENT: update Letta agent memory with latest issue summary ──
        if (_phase === 'agent') {
            if (enableLetta && !dryRun) {
                try {
                    const agentCheck = await checkAgentExists({
                        projectIdentifier: project.identifier,
                    });
                    if (agentCheck.exists && agentCheck.agentId) {
                        // Prefer SQL path when gitRepoPath is available (Dolt aggregation).
                        // Falls back to array path inside updateLettaMemory if SQL fails.
                        if (beadsInitialized && gitRepoPath) {
                            const memResult = await updateLettaMemory({
                                agentId: agentCheck.agentId,
                                project: project,
                                gitRepoPath: gitRepoPath,
                                gitUrl: undefined,
                            });
                            result.lettaUpdated = memResult.success;
                        }
                        else {
                            // No Dolt available — fetch issues array as fallback
                            const beadsIssues = beadsInitialized && gitRepoPath
                                ? await fetchBeadsIssues({ gitRepoPath })
                                : [];
                            const memResult = await updateLettaMemory({
                                agentId: agentCheck.agentId,
                                project: project,
                                issues: beadsIssues,
                                gitRepoPath: gitRepoPath || undefined,
                                gitUrl: undefined,
                            });
                            result.lettaUpdated = memResult.success;
                        }
                    }
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    workflow_1.log.warn(`[ProjectSync] Agent memory update failed: ${errorMsg}`);
                }
            }
            return await (0, workflow_1.continueAsNew)({
                ...input,
                _phase: 'done',
                _gitRepoPath: gitRepoPath,
                _beadsInitialized: beadsInitialized,
                _accumulatedResult: result,
            });
        }
        // ── DONE: commit beads changes, finalize ──
        if (_phase === 'done') {
            if (!dryRun && beadsInitialized && gitRepoPath && result.beadsSync.synced > 0) {
                await commitBeadsToGit({
                    context: {
                        projectIdentifier: project.identifier,
                        gitRepoPath,
                    },
                    message: `Sync from VibeSync: ${result.beadsSync.synced} issues`,
                });
            }
            result.success = true;
            workflow_1.log.info(`[ProjectSync] Complete: ${project.identifier}`, {
                beadsSync: result.beadsSync,
                lettaUpdated: result.lettaUpdated,
            });
            return result;
        }
        throw new Error(`Unknown phase: ${_phase}`);
    }
    catch (error) {
        if (error instanceof Error &&
            (error.name === 'ContinueAsNew' ||
                error.message.includes('Workflow continued as new') ||
                error.message.includes('continueAsNew'))) {
            throw error;
        }
        result.error = error instanceof Error ? error.message : String(error);
        workflow_1.log.error(`[ProjectSync] Failed: ${project.identifier}`, {
            error: result.error,
        });
        return result;
    }
}
//# sourceMappingURL=project-sync.js.map