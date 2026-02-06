/**
 * Huly Fetch Service - Fetching projects and issues from Huly
 */

import { recordApiLatency } from '../HealthService.js';

export async function fetchHulyProjects(hulyClient, config = {}) {
  console.log('\n[Huly] Fetching projects...');
  const startTime = Date.now();

  try {
    const projects = await hulyClient.listProjects();
    recordApiLatency('huly', 'listProjects', Date.now() - startTime);

    console.log(`[Huly] Found ${projects.length} projects`);

    if (projects.length > 0 && config.sync?.dryRun) {
      console.log('[Huly] Sample project:', JSON.stringify(projects[0], null, 2));
    }

    return projects;
  } catch (error) {
    recordApiLatency('huly', 'listProjects', Date.now() - startTime);
    console.error('[Huly] Error fetching projects:', error.message);
    return [];
  }
}

export async function fetchHulyIssues(hulyClient, projectIdentifier, config = {}, db = null) {
  const startTime = Date.now();

  const syncCursor = db?.getHulySyncCursor?.(projectIdentifier);
  const isIncremental = config.sync?.incremental !== false && syncCursor;

  if (isIncremental) {
    console.log(`[Huly] Incremental fetch for ${projectIdentifier} (modified since ${syncCursor})`);
  } else {
    console.log(`[Huly] Full fetch for project ${projectIdentifier}...`);
  }

  try {
    const options = {
      limit: 1000,
      includeSyncMeta: true,
    };

    if (isIncremental) {
      options.modifiedSince = syncCursor;
    }

    const result = await hulyClient.listIssues(projectIdentifier, options);
    recordApiLatency('huly', 'listIssues', Date.now() - startTime);

    const issues = result.issues || result;
    const syncMeta = result.syncMeta || { latestModified: null, serverTime: new Date().toISOString() };

    console.log(`[Huly] Found ${issues.length} issues in ${projectIdentifier}${isIncremental ? ' (incremental)' : ''}`);

    if (db && syncMeta.latestModified) {
      db.setHulySyncCursor(projectIdentifier, syncMeta.latestModified);
      console.log(`[Huly] Updated sync cursor for ${projectIdentifier}: ${syncMeta.latestModified}`);
    }

    return { issues, syncMeta };
  } catch (error) {
    recordApiLatency('huly', 'listIssues', Date.now() - startTime);
    console.error(`[Huly] Error fetching issues for ${projectIdentifier}:`, error.message);
    return { issues: [], syncMeta: { latestModified: null, serverTime: new Date().toISOString() } };
  }
}

/**
 * @deprecated Use fetchHulyIssues with db parameter for incremental sync
 */
export async function fetchHulyIssuesSimple(hulyClient, projectIdentifier, config = {}) {
  const result = await fetchHulyIssues(hulyClient, projectIdentifier, config, null);
  return result.issues;
}

export async function fetchHulyIssuesBulk(hulyClient, projectIdentifiers, config = {}, db = null) {
  const startTime = Date.now();

  if (!hulyClient.listIssuesBulk) {
    console.log('[Huly] Bulk endpoint not available, falling back to individual fetches');
    const results = {};
    for (const projectId of projectIdentifiers) {
      results[projectId] = await fetchHulyIssues(hulyClient, projectId, config, db);
    }
    return { projects: results, totalIssues: Object.values(results).reduce((sum, r) => sum + r.issues.length, 0) };
  }

  let oldestCursor = null;
  if (config.sync?.incremental !== false && db) {
    for (const projectId of projectIdentifiers) {
      const cursor = db.getHulySyncCursor?.(projectId);
      if (cursor && (!oldestCursor || cursor < oldestCursor)) {
        oldestCursor = cursor;
      }
    }
  }

  const isIncremental = !!oldestCursor;
  if (isIncremental) {
    console.log(`[Huly] Bulk incremental fetch for ${projectIdentifiers.length} projects (modified since ${oldestCursor})`);
  } else {
    console.log(`[Huly] Bulk full fetch for ${projectIdentifiers.length} projects...`);
  }

  try {
    const options = { limit: 1000 };
    if (isIncremental) {
      options.modifiedSince = oldestCursor;
    }

    const result = await hulyClient.listIssuesBulk(projectIdentifiers, options);
    recordApiLatency('huly', 'listIssuesBulk', Date.now() - startTime);

    if (db && result.projects) {
      for (const [projectId, projectData] of Object.entries(result.projects)) {
        if (projectData.syncMeta?.latestModified) {
          db.setHulySyncCursor(projectId, projectData.syncMeta.latestModified);
        }
      }
    }

    console.log(`[Huly] Bulk fetched ${result.totalIssues} issues from ${result.projectCount} projects${isIncremental ? ' (incremental)' : ''}`);
    return result;
  } catch (error) {
    recordApiLatency('huly', 'listIssuesBulk', Date.now() - startTime);
    console.error('[Huly] Error in bulk fetch:', error.message);

    console.log('[Huly] Falling back to individual fetches...');
    const results = {};
    for (const projectId of projectIdentifiers) {
      results[projectId] = await fetchHulyIssues(hulyClient, projectId, config, db);
    }
    return { projects: results, totalIssues: Object.values(results).reduce((sum, r) => sum + r.issues.length, 0) };
  }
}
