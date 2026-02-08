#!/usr/bin/env node

/**
 * Backfill sync DB identifiers from VIBE-derived keys to Huly identifiers.
 *
 * - Finds rows where identifier matches {PROJECT}-VIBE-{...}
 * - Extracts Huly identifier from description footer:
 *   - "Huly Issue: HVSYN-123"
 *   - "Synced from Huly: HVSYN-123"
 * - Renames identifier to Huly identifier
 * - Merges rows safely when target identifier already exists
 * - Optionally fetches Huly internal ID and populates huly_id
 *
 * Usage:
 *   node migrations/006_backfill_huly_identifiers.js
 *   DB_PATH=/path/to/sync-state.db node migrations/006_backfill_huly_identifiers.js
 *   node migrations/006_backfill_huly_identifiers.js --no-fetch-huly-id
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'logs', 'sync-state.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

const FETCH_HULY_ID = !process.argv.includes('--no-fetch-huly-id');
const HULY_API_URL = process.env.HULY_API_URL || 'http://192.168.50.90:3458/api';

function extractHulyIdentifier(description) {
  if (!description) return null;
  const match = description.match(/(?:Huly Issue|Synced from Huly):\s*([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function fetchHulyInternalId(identifier) {
  if (!FETCH_HULY_ID) return null;
  if (!HULY_API_URL) return null;

  try {
    const base = HULY_API_URL.endsWith('/api') ? HULY_API_URL.slice(0, -4) : HULY_API_URL;
    const url = `${base}/api/issues/${identifier}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    const issue = await response.json();
    return issue?.id || issue?._id || null;
  } catch {
    return null;
  }
}

function pickNonEmpty(primary, fallback) {
  if (primary !== null && primary !== undefined && String(primary).trim() !== '') return primary;
  return fallback;
}

async function main() {
  console.log('[Migration] Backfilling Huly identifiers in sync DB');
  console.log(`[Migration] DB: ${DB_PATH}`);
  console.log(`[Migration] Fetch Huly internal IDs: ${FETCH_HULY_ID ? 'yes' : 'no'}`);

  const db = new Database(DB_PATH);

  const rows = db
    .prepare(
      `
      SELECT rowid, *
      FROM issues
      WHERE identifier LIKE '%-VIBE-%'
         OR huly_id IS NULL
      ORDER BY updated_at DESC
      `
    )
    .all();

  console.log(`[Migration] Candidate rows: ${rows.length}`);

  const getByIdentifier = db.prepare('SELECT rowid, * FROM issues WHERE identifier = ? LIMIT 1');
  const updateIdentifier = db.prepare(
    'UPDATE issues SET identifier = ?, updated_at = ? WHERE rowid = ?'
  );
  const updateHulyId = db.prepare('UPDATE issues SET huly_id = ?, updated_at = ? WHERE rowid = ?');
  const deleteRow = db.prepare('DELETE FROM issues WHERE rowid = ?');
  const updateMerged = db.prepare(`
    UPDATE issues
    SET
      huly_id = ?,
      vibe_task_id = ?,
      beads_issue_id = ?,
      title = ?,
      description = ?,
      status = ?,
      priority = ?,
      vibe_status = ?,
      beads_status = ?,
      huly_modified_at = ?,
      vibe_modified_at = ?,
      beads_modified_at = ?,
      updated_at = ?
    WHERE rowid = ?
  `);

  let renamed = 0;
  let merged = 0;
  let hulyIdUpdated = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const targetIdentifier = extractHulyIdentifier(row.description);
      if (!targetIdentifier) {
        skipped++;
        continue;
      }

      if (row.identifier !== targetIdentifier) {
        const existing = getByIdentifier.get(targetIdentifier);
        if (existing && existing.rowid !== row.rowid) {
          updateMerged.run(
            pickNonEmpty(existing.huly_id, row.huly_id),
            pickNonEmpty(existing.vibe_task_id, row.vibe_task_id),
            pickNonEmpty(existing.beads_issue_id, row.beads_issue_id),
            pickNonEmpty(existing.title, row.title),
            pickNonEmpty(existing.description, row.description),
            pickNonEmpty(existing.status, row.status),
            pickNonEmpty(existing.priority, row.priority),
            pickNonEmpty(existing.vibe_status, row.vibe_status),
            pickNonEmpty(existing.beads_status, row.beads_status),
            pickNonEmpty(existing.huly_modified_at, row.huly_modified_at),
            pickNonEmpty(existing.vibe_modified_at, row.vibe_modified_at),
            pickNonEmpty(existing.beads_modified_at, row.beads_modified_at),
            Date.now(),
            existing.rowid
          );

          deleteRow.run(row.rowid);
          merged++;
          continue;
        }

        updateIdentifier.run(targetIdentifier, Date.now(), row.rowid);
        renamed++;
      }
    }
  });

  tx();

  if (FETCH_HULY_ID) {
    const needHulyId = db
      .prepare(
        `
        SELECT rowid, identifier
        FROM issues
        WHERE huly_id IS NULL
          AND identifier GLOB '[A-Z]*-[0-9]*'
        ORDER BY updated_at DESC
        `
      )
      .all();

    for (const row of needHulyId) {
      const internalId = await fetchHulyInternalId(row.identifier);
      if (!internalId) continue;
      updateHulyId.run(String(internalId), Date.now(), row.rowid);
      hulyIdUpdated++;
    }
  }

  const fallbackRows = db
    .prepare(
      `
      SELECT rowid, identifier
      FROM issues
      WHERE huly_id IS NULL
        AND identifier GLOB '[A-Z]*-[0-9]*'
      `
    )
    .all();

  for (const row of fallbackRows) {
    updateHulyId.run(row.identifier, Date.now(), row.rowid);
    hulyIdUpdated++;
  }

  const summary = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN identifier LIKE '%-VIBE-%' THEN 1 ELSE 0 END) AS vibe_format,
        SUM(CASE WHEN huly_id IS NULL THEN 1 ELSE 0 END) AS null_huly_id
      FROM issues
      `
    )
    .get();

  db.close();

  console.log('[Migration] Completed');
  console.log(`[Migration] Renamed identifiers: ${renamed}`);
  console.log(`[Migration] Merged conflicting rows: ${merged}`);
  console.log(`[Migration] Populated huly_id from API: ${hulyIdUpdated}`);
  console.log(`[Migration] Skipped (no Huly identifier in description): ${skipped}`);
  console.log('[Migration] Post-state:', summary);
}

main().catch(error => {
  console.error('[Migration] Failed:', error?.message || error);
  process.exit(1);
});
