"use strict";
/**
 * Project Sync Workflow — Simplified 2-Phase Pipeline
 *
 * Handles syncing a single project.
 *
 * Phases: init → agent
 *   init:   Discover project in registry, provision/reconcile agent
 *   agent:  Update Letta agent memory with latest project snapshot
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectSyncWorkflow = ProjectSyncWorkflow;
const workflow_1 = require("@temporalio/workflow");
const agent_provisioning_1 = require("./agent-provisioning");
// ============================================================
// ACTIVITY PROXIES
// ============================================================
const { updateLettaMemory } = (0, workflow_1.proxyActivities)({
    startToCloseTimeout: '120 seconds',
    retry: {
        initialInterval: '2 seconds',
        backoffCoefficient: 2,
        maximumInterval: '60 seconds',
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
    const { project, enableLetta, dryRun, _phase = 'init', _accumulatedResult, _gitRepoPath, } = input;
    workflow_1.log.info(`[ProjectSync] Processing: ${project.identifier}`, { phase: _phase });
    const result = _accumulatedResult || {
        projectIdentifier: project.identifier,
        projectName: project.name,
        success: false,
        lettaUpdated: false,
    };
    let gitRepoPath = _gitRepoPath;
    try {
        // ── INIT: discover project, provision agent ──
        if (_phase === 'init') {
            gitRepoPath = extractGitRepoPath(project.description);
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
                _phase: 'agent',
                _gitRepoPath: gitRepoPath,
                _accumulatedResult: result,
            });
        }
        // ── AGENT: update Letta agent memory ──
        if (_phase === 'agent') {
            if (enableLetta && !dryRun) {
                try {
                    const agentCheck = await checkAgentExists({
                        projectIdentifier: project.identifier,
                    });
                    if (agentCheck.exists && agentCheck.agentId) {
                        const memResult = await updateLettaMemory({
                            agentId: agentCheck.agentId,
                            project: project,
                            issues: [],
                            gitRepoPath: gitRepoPath || undefined,
                            gitUrl: undefined,
                        });
                        result.lettaUpdated = memResult.success;
                    }
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    workflow_1.log.warn(`[ProjectSync] Agent memory update failed: ${errorMsg}`);
                }
            }
            result.success = true;
            workflow_1.log.info(`[ProjectSync] Complete: ${project.identifier}`, {
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