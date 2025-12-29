#!/usr/bin/env node
/**
 * Cleanup Duplicate Vibe Projects and Tasks
 * 
 * This script identifies and removes duplicate projects and tasks from Vibe Kanban.
 * It preserves the most recently updated item in each duplicate group.
 * 
 * Usage:
 *   node cleanup-vibe-duplicates.js              # Dry run (shows what would be deleted)
 *   node cleanup-vibe-duplicates.js --execute    # Actually delete duplicates
 *   node cleanup-vibe-duplicates.js --projects   # Only cleanup projects
 *   node cleanup-vibe-duplicates.js --tasks      # Only cleanup tasks
 */

import 'dotenv/config';
import { createVibeRestClient } from './lib/VibeRestClient.js';

const VIBE_API_URL = process.env.VIBE_API_URL || 'http://192.168.50.90:3105';
const DRY_RUN = !process.argv.includes('--execute');
const PROJECTS_ONLY = process.argv.includes('--projects');
const TASKS_ONLY = process.argv.includes('--tasks');

/**
 * Normalize name for comparison (case-insensitive, trimmed)
 */
function normalizeName(name) {
  if (!name) return '';
  return name.trim().toLowerCase();
}

/**
 * Normalize task title for comparison (removes priority prefixes)
 */
function normalizeTaskTitle(title) {
  if (!title) return '';
  return title
    .trim()
    .toLowerCase()
    .replace(/^\[p[0-4]\]\s*/i, '')      // Remove [P0]-[P4] prefix
    .replace(/^\[perf[^\]]*\]\s*/i, '')  // Remove [PERF*] prefix
    .replace(/^\[tier\s*\d+\]\s*/i, '')  // Remove [Tier N] prefix
    .replace(/^\[action\]\s*/i, '')      // Remove [Action] prefix
    .replace(/^\[bug\]\s*/i, '')         // Remove [BUG] prefix
    .replace(/^\[fixed\]\s*/i, '')       // Remove [FIXED] prefix
    .trim();
}

/**
 * Extract Huly identifier from task description
 */
function extractHulyId(description) {
  if (!description) return null;
  const match = description.match(/(?:Huly Issue|Synced from Huly):\s*([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Group items by a key function
 */
function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * Find duplicate projects
 */
function findDuplicateProjects(projects) {
  const groups = groupBy(projects, p => normalizeName(p.name));
  const duplicates = [];
  
  for (const [name, projectList] of groups) {
    if (projectList.length > 1) {
      // Sort by updated_at descending (keep most recent)
      const sorted = projectList.sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at || 0);
        const dateB = new Date(b.updated_at || b.created_at || 0);
        return dateB - dateA;
      });
      
      duplicates.push({
        name: projectList[0].name,
        keep: sorted[0],
        delete: sorted.slice(1),
      });
    }
  }
  
  return duplicates;
}

/**
 * Find duplicate tasks within a project
 */
function findDuplicateTasks(tasks) {
  // First, group by Huly identifier (most reliable)
  const byHulyId = groupBy(tasks.filter(t => extractHulyId(t.description)), 
    t => extractHulyId(t.description));
  
  // Then, group remaining tasks by normalized title
  const tasksWithHulyId = new Set(tasks.filter(t => extractHulyId(t.description)).map(t => t.id));
  const tasksWithoutHulyId = tasks.filter(t => !tasksWithHulyId.has(t.id));
  const byTitle = groupBy(tasksWithoutHulyId, t => normalizeTaskTitle(t.title));
  
  const duplicates = [];
  
  // Process Huly ID groups
  for (const [hulyId, taskList] of byHulyId) {
    if (taskList.length > 1) {
      const sorted = taskList.sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at || 0);
        const dateB = new Date(b.updated_at || b.created_at || 0);
        return dateB - dateA;
      });
      
      duplicates.push({
        key: `Huly: ${hulyId}`,
        title: taskList[0].title,
        keep: sorted[0],
        delete: sorted.slice(1),
      });
    }
  }
  
  // Process title groups
  for (const [title, taskList] of byTitle) {
    if (taskList.length > 1 && title.length > 5) { // Only consider meaningful titles
      const sorted = taskList.sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at || 0);
        const dateB = new Date(b.updated_at || b.created_at || 0);
        return dateB - dateA;
      });
      
      duplicates.push({
        key: `Title: ${title.substring(0, 50)}...`,
        title: taskList[0].title,
        keep: sorted[0],
        delete: sorted.slice(1),
      });
    }
  }
  
  return duplicates;
}

/**
 * Retry a function with exponential backoff
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = error.message?.includes('database is locked') || 
                          error.message?.includes('500');
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`      Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Main cleanup function
 */
async function main() {
  console.log('='.repeat(70));
  console.log('Vibe Kanban Duplicate Cleanup');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --execute to actually delete)' : 'EXECUTE (will delete duplicates!)'}`);
  console.log(`Scope: ${PROJECTS_ONLY ? 'Projects only' : TASKS_ONLY ? 'Tasks only' : 'Projects and Tasks'}`);
  console.log('');
  
  const vibeClient = createVibeRestClient(VIBE_API_URL);
  
  try {
    await vibeClient.initialize();
    console.log('Connected to Vibe API\n');
  } catch (error) {
    console.error('Failed to connect to Vibe API:', error.message);
    process.exit(1);
  }
  
  let totalProjectsDeleted = 0;
  let totalTasksDeleted = 0;
  
  // ============================================================
  // CLEANUP PROJECTS
  // ============================================================
  if (!TASKS_ONLY) {
    console.log('-'.repeat(70));
    console.log('PHASE 1: Cleaning up duplicate projects');
    console.log('-'.repeat(70));
    
    const projects = await withRetry(() => vibeClient.listProjects());
    console.log(`Found ${projects.length} total projects\n`);
    
    const duplicateProjects = findDuplicateProjects(projects);
    
    if (duplicateProjects.length === 0) {
      console.log('No duplicate projects found!\n');
    } else {
      console.log(`Found ${duplicateProjects.length} duplicate project groups:\n`);
      
      for (const dup of duplicateProjects) {
        console.log(`  Project: "${dup.name}"`);
        console.log(`    Keep: ${dup.keep.id} (updated: ${dup.keep.updated_at || 'unknown'})`);
        
        for (const toDelete of dup.delete) {
          console.log(`    Delete: ${toDelete.id} (updated: ${toDelete.updated_at || 'unknown'})`);
          
          if (!DRY_RUN) {
            try {
              await withRetry(() => vibeClient.deleteProject(toDelete.id));
              console.log(`      ✓ Deleted`);
              totalProjectsDeleted++;
            } catch (error) {
              console.log(`      ✗ Failed: ${error.message}`);
            }
            // Longer delay to avoid database locks
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        console.log('');
      }
      
      const wouldDelete = duplicateProjects.reduce((sum, d) => sum + d.delete.length, 0);
      console.log(`${DRY_RUN ? 'Would delete' : 'Deleted'}: ${DRY_RUN ? wouldDelete : totalProjectsDeleted} duplicate projects\n`);
    }
  }
  
  // ============================================================
  // CLEANUP TASKS
  // ============================================================
  if (!PROJECTS_ONLY) {
    console.log('-'.repeat(70));
    console.log('PHASE 2: Cleaning up duplicate tasks');
    console.log('-'.repeat(70));
    
    // Re-fetch projects (in case we deleted some)
    const projectsForTasks = await withRetry(() => vibeClient.listProjects());
    console.log(`Scanning ${projectsForTasks.length} projects for duplicate tasks...\n`);
    
    for (const project of projectsForTasks) {
      let tasks;
      try {
        tasks = await withRetry(() => vibeClient.listTasks(project.id));
      } catch (error) {
        console.log(`  Skipping project "${project.name}": ${error.message}`);
        continue;
      }
      
      if (tasks.length === 0) continue;
      
      const duplicateTasks = findDuplicateTasks(tasks);
      
      if (duplicateTasks.length === 0) continue;
      
      console.log(`  Project: "${project.name}" (${tasks.length} tasks)`);
      console.log(`    Found ${duplicateTasks.length} duplicate task groups:`);
      
      for (const dup of duplicateTasks) {
        console.log(`      ${dup.key}`);
        console.log(`        Keep: ${dup.keep.id} - "${dup.keep.title.substring(0, 40)}..."`);
        
        for (const toDelete of dup.delete) {
          console.log(`        Delete: ${toDelete.id} - "${toDelete.title.substring(0, 40)}..."`);
          
          if (!DRY_RUN) {
            try {
              await withRetry(() => vibeClient.deleteTask(toDelete.id));
              console.log(`          ✓ Deleted`);
              totalTasksDeleted++;
            } catch (error) {
              console.log(`          ✗ Failed: ${error.message}`);
            }
            // Longer delay to avoid database locks
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }
      console.log('');
      
      // Delay between projects to let database recover
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(`${DRY_RUN ? 'Would delete' : 'Deleted'}: ${totalTasksDeleted} duplicate tasks\n`);
  }
  
  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('='.repeat(70));
  console.log('CLEANUP SUMMARY');
  console.log('='.repeat(70));
  
  if (DRY_RUN) {
    console.log('This was a DRY RUN. No changes were made.');
    console.log('Run with --execute to actually delete duplicates.');
  } else {
    console.log(`Projects deleted: ${totalProjectsDeleted}`);
    console.log(`Tasks deleted: ${totalTasksDeleted}`);
  }
  
  console.log('='.repeat(70));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
