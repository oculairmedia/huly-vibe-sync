"use strict";
/**
 * Orchestration Activities — Project Fetching (Registry-Based)
 *
 * Activities for fetching projects from the local SQLite ProjectRegistry.
 * Phase 4: No more Huly API calls — registry is the single source of truth.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRegistryProjects = fetchRegistryProjects;
const path_1 = __importDefault(require("path"));
const orchestration_letta_1 = require("./orchestration-letta");
function appRootModule(modulePath) {
    return path_1.default.join(process.cwd(), modulePath);
}
// ============================================================
// PROJECT FETCHING ACTIVITIES
// ============================================================
/**
 * Fetch all active projects from the local SQLite ProjectRegistry.
 *
 * Replaces the old fetchHulyProjects that called the dead Huly API.
 * Returns the same HulyProject[] shape for workflow compatibility.
 */
async function fetchRegistryProjects() {
    console.log('[Temporal:Orchestration] Fetching projects from registry');
    try {
        const { createSyncDatabase } = await Promise.resolve(`${appRootModule('lib/database.js')}`).then(s => __importStar(require(s)));
        const dbPath = process.env.DB_PATH || path_1.default.join(process.cwd(), 'logs', 'sync-state.db');
        const db = createSyncDatabase(dbPath);
        try {
            const rows = db.getAllProjects();
            // Map DB rows to HulyProject shape for backward compat
            const projects = rows
                .filter((r) => r.status === 'active')
                .map((r) => ({
                identifier: r.identifier,
                name: r.name || r.identifier,
                description: r.filesystem_path ? `Filesystem: ${r.filesystem_path}` : undefined,
            }));
            console.log(`[Temporal:Orchestration] Found ${projects.length} registry projects`);
            return projects;
        }
        finally {
            db.close();
        }
    }
    catch (error) {
        throw (0, orchestration_letta_1.handleOrchestratorError)(error, 'fetchRegistryProjects');
    }
}
//# sourceMappingURL=orchestration-projects.js.map