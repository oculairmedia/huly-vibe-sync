"use strict";
/**
 * Memory builder wrappers for Temporal activities.
 *
 * The main lib/LettaMemoryBuilders.js is ESM (package.json "type": "module")
 * but Temporal workers compile to CJS. This module provides CJS-compatible
 * wrappers that lazily import the ESM builders via dynamic import().
 *
 * We use Function('return import(...)') to prevent TypeScript from converting
 * the dynamic import() into require() during CJS compilation.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBoardMetrics = buildBoardMetrics;
exports.buildProjectMeta = buildProjectMeta;
exports.buildBoardConfig = buildBoardConfig;
exports.buildHotspots = buildHotspots;
exports.buildBacklogSummary = buildBacklogSummary;
exports.buildRecentActivity = buildRecentActivity;
exports.buildComponentsSummary = buildComponentsSummary;
exports.buildBoardMetricsFromSQL = buildBoardMetricsFromSQL;
exports.buildBacklogSummaryFromSQL = buildBacklogSummaryFromSQL;
exports.buildHotspotsFromSQL = buildHotspotsFromSQL;
exports.buildComponentsSummaryFromSQL = buildComponentsSummaryFromSQL;
exports.buildRecentActivityFromSQL = buildRecentActivityFromSQL;
const path = __importStar(require("path"));
let _builders = null;
// Preserve dynamic import() through CJS compilation
const dynamicImport = new Function('specifier', 'return import(specifier)');
// Resolve absolute path at module load time (works from any CWD)
// At runtime, __dirname = /app/temporal/dist/lib, so we go up 3 levels to /app/
const buildersPath = path.resolve(__dirname, '..', '..', '..', 'lib', 'LettaMemoryBuilders.js');
async function getBuilders() {
    if (!_builders) {
        _builders = await dynamicImport(buildersPath);
    }
    return _builders;
}
async function buildBoardMetrics(issues) {
    const b = await getBuilders();
    return b.buildBoardMetrics(issues);
}
async function buildProjectMeta(project, repoPath, gitUrl) {
    const b = await getBuilders();
    return b.buildProjectMeta(project, repoPath, gitUrl);
}
async function buildBoardConfig() {
    const b = await getBuilders();
    return b.buildBoardConfig();
}
async function buildHotspots(issues) {
    const b = await getBuilders();
    return b.buildHotspots(issues);
}
async function buildBacklogSummary(issues) {
    const b = await getBuilders();
    return b.buildBacklogSummary(issues);
}
async function buildRecentActivity(activityData) {
    const b = await getBuilders();
    return b.buildRecentActivity(activityData);
}
async function buildComponentsSummary(issues) {
    const b = await getBuilders();
    return b.buildComponentsSummary(issues);
}
// ============================================================
// SQL-BASED BUILDER WRAPPERS
// ============================================================
async function buildBoardMetricsFromSQL(statusCounts) {
    const b = await getBuilders();
    return b.buildBoardMetricsFromSQL(statusCounts);
}
async function buildBacklogSummaryFromSQL(openIssues) {
    const b = await getBuilders();
    return b.buildBacklogSummaryFromSQL(openIssues);
}
async function buildHotspotsFromSQL(params) {
    const b = await getBuilders();
    return b.buildHotspotsFromSQL(params);
}
async function buildComponentsSummaryFromSQL(typeStats) {
    const b = await getBuilders();
    return b.buildComponentsSummaryFromSQL(typeStats);
}
async function buildRecentActivityFromSQL(doltChanges) {
    const b = await getBuilders();
    return b.buildRecentActivityFromSQL(doltChanges);
}
//# sourceMappingURL=memoryBuilders.js.map