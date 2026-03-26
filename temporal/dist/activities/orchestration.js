"use strict";
/**
 * Orchestration Activities for Temporal — Facade
 *
 * Re-exports all activities from sub-modules:
 *   - orchestration-projects: Registry-based project fetching
 *   - orchestration-git: Git repo path resolution, Beads operations
 *   - orchestration-letta: Letta memory updates, metrics, error handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleOrchestratorError = exports.recordSyncMetrics = exports.updateLettaMemory = exports.loadDoltQueryService = exports.fetchBeadsIssues = exports.initializeBeads = exports.clearGitRepoPathCache = exports.extractGitRepoPath = exports.resolveGitRepoPath = exports.fetchRegistryProjects = void 0;
// ============================================================
// RE-EXPORTS FROM SUB-MODULES
// ============================================================
var orchestration_projects_1 = require("./orchestration-projects");
Object.defineProperty(exports, "fetchRegistryProjects", { enumerable: true, get: function () { return orchestration_projects_1.fetchRegistryProjects; } });
var orchestration_git_1 = require("./orchestration-git");
Object.defineProperty(exports, "resolveGitRepoPath", { enumerable: true, get: function () { return orchestration_git_1.resolveGitRepoPath; } });
Object.defineProperty(exports, "extractGitRepoPath", { enumerable: true, get: function () { return orchestration_git_1.extractGitRepoPath; } });
Object.defineProperty(exports, "clearGitRepoPathCache", { enumerable: true, get: function () { return orchestration_git_1.clearGitRepoPathCache; } });
Object.defineProperty(exports, "initializeBeads", { enumerable: true, get: function () { return orchestration_git_1.initializeBeads; } });
Object.defineProperty(exports, "fetchBeadsIssues", { enumerable: true, get: function () { return orchestration_git_1.fetchBeadsIssues; } });
Object.defineProperty(exports, "loadDoltQueryService", { enumerable: true, get: function () { return orchestration_git_1.loadDoltQueryService; } });
var orchestration_letta_1 = require("./orchestration-letta");
Object.defineProperty(exports, "updateLettaMemory", { enumerable: true, get: function () { return orchestration_letta_1.updateLettaMemory; } });
Object.defineProperty(exports, "recordSyncMetrics", { enumerable: true, get: function () { return orchestration_letta_1.recordSyncMetrics; } });
Object.defineProperty(exports, "handleOrchestratorError", { enumerable: true, get: function () { return orchestration_letta_1.handleOrchestratorError; } });
//# sourceMappingURL=orchestration.js.map