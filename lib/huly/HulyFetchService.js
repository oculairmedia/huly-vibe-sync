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
    const syncMeta = result.syncMeta || {
      latestModified: null,
      serverTime: new Date().toISOString(),
    };

    console.log(
      `[Huly] Found ${issues.length} issues in ${projectIdentifier}${isIncremental ? ' (incremental)' : ''}`
    );

    if (db && syncMeta.latestModified) {
      db.setHulySyncCursor(projectIdentifier, syncMeta.latestModified);
      console.log(
        `[Huly] Updated sync cursor for ${projectIdentifier}: ${syncMeta.latestModified}`
      );
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
    return {
      projects: results,
      totalIssues: Object.values(results).reduce((sum, r) => sum + r.issues.length, 0),
    };
  }

  try {
    const incrementalEnabled = config.sync?.incremental !== false && !!db;
    const projectsByCursor = new Map();

    if (incrementalEnabled) {
      const incrementalProjects = [];
      const fullProjects = [];
      let oldestCursor = null;

      for (const projectId of projectIdentifiers) {
        const cursor = db.getHulySyncCursor?.(projectId) || null;
        if (cursor) {
          incrementalProjects.push(projectId);
          if (!oldestCursor || cursor < oldestCursor) {
            oldestCursor = cursor;
          }
        } else {
          fullProjects.push(projectId);
        }
      }

      if (fullProjects.length > 0) {
        projectsByCursor.set('__FULL__', fullProjects);
      }
      if (incrementalProjects.length > 0) {
        projectsByCursor.set(oldestCursor, incrementalProjects);
      }
    } else {
      projectsByCursor.set('__FULL__', [...projectIdentifiers]);
    }

    if (projectsByCursor.size > 1) {
      console.log(
        `[Huly] Bulk incremental fetch split by ${projectsByCursor.size} cursor groups for ${projectIdentifiers.length} projects`
      );
    } else {
      const [groupKey] = projectsByCursor.keys();
      if (groupKey && groupKey !== '__FULL__') {
        console.log(
          `[Huly] Bulk incremental fetch for ${projectIdentifiers.length} projects (modified since ${groupKey})`
        );
      } else {
        console.log(`[Huly] Bulk full fetch for ${projectIdentifiers.length} projects...`);
      }
    }

    const merged = {
      projects: {},
      totalIssues: 0,
      projectCount: projectIdentifiers.length,
    };

    for (const [cursorKey, groupedProjectIds] of projectsByCursor.entries()) {
      const options = { limit: 1000 };
      if (cursorKey !== '__FULL__') {
        options.modifiedSince = cursorKey;
      }

      const groupResult = await hulyClient.listIssuesBulk(groupedProjectIds, options);

      if (groupResult.projects) {
        Object.assign(merged.projects, groupResult.projects);
      }

      if (typeof groupResult.totalIssues === 'number') {
        merged.totalIssues += groupResult.totalIssues;
      } else if (groupResult.projects) {
        merged.totalIssues += Object.values(groupResult.projects).reduce(
          (sum, p) => sum + (p.issues?.length || 0),
          0
        );
      }
    }

    recordApiLatency('huly', 'listIssuesBulk', Date.now() - startTime);

    if (db && merged.projects) {
      for (const [projectId, projectData] of Object.entries(merged.projects)) {
        if (projectData.syncMeta?.latestModified) {
          db.setHulySyncCursor(projectId, projectData.syncMeta.latestModified);
        }
      }
    }

    console.log(
      `[Huly] Bulk fetched ${merged.totalIssues} issues from ${merged.projectCount} projects${incrementalEnabled ? ' (incremental)' : ''}`
    );
    return merged;
  } catch (error) {
    recordApiLatency('huly', 'listIssuesBulk', Date.now() - startTime);
    console.error('[Huly] Error in bulk fetch:', error.message);

    console.log('[Huly] Falling back to individual fetches...');
    const results = {};
    for (const projectId of projectIdentifiers) {
      results[projectId] = await fetchHulyIssues(hulyClient, projectId, config, db);
    }
    return {
      projects: results,
      totalIssues: Object.values(results).reduce((sum, r) => sum + r.issues.length, 0),
    };
  }
}
