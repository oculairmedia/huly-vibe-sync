/**
 * Daemon ↔ Dolt direct SQL client for hot-path molecule operations.
 *
 * The orchestration daemon must not shell out to the `bd` CLI for hot-
 * path operations — 100ms+ per call × hundreds of operations per turn =
 * unacceptable latency. This module gives the daemon a typed SQL
 * connection to the local Dolt server that bd init manages, with
 * narrow query wrappers for the operations molecules need.
 *
 * Connection discovery:
 *   - port: read from .beads/dolt-server.port (managed by bd init)
 *   - database: the configured bd prefix with dashes → underscores
 *     (today: "huly_vibe_sync" pending the deprecated prefix rename)
 *   - user/auth: dolt-sql-server runs with no password by default for
 *     local connections; bd's credential key file is for remote sync,
 *     not the local server
 *
 * Layering invariants:
 *   - Schema migrations still go through bd. This module does INSERTs
 *     and SELECTs against bd's existing tables; it does not ALTER.
 *   - Same database as the bd CLI uses. No parallel store.
 *   - Type discriminator (vibesync-93h): molecule beads are written
 *     with issue_type ∈ {'molecule_root', 'molecule_step', 'mail'}.
 *
 * See vibesync-w5z.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

/**
 * Configuration for connecting to the local Dolt server that bd init
 * spawned. Defaults read from the on-disk .beads/ files.
 */
export interface DoltClientConfig {
  /** Repo root that contains .beads/. Defaults to process.cwd(). */
  readonly beadsRoot?: string;
  /** Override port (otherwise read from .beads/dolt-server.port). */
  readonly port?: number;
  /** Database name (defaults to bd prefix normalized: dashes → underscores). */
  readonly database?: string;
  /** Host (defaults to 127.0.0.1). */
  readonly host?: string;
  /** Connection-pool size. */
  readonly poolSize?: number;
}

function resolvedBeadsRoot(cfg: DoltClientConfig): string {
  return cfg.beadsRoot ?? process.cwd();
}

function readPort(cfg: DoltClientConfig): number {
  if (cfg.port !== undefined) return cfg.port;
  const portPath = join(resolvedBeadsRoot(cfg), '.beads', 'dolt-server.port');
  const raw = readFileSync(portPath, 'utf8').trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`DoltClient: invalid port "${raw}" in ${portPath}`);
  }
  return port;
}

function readDatabase(cfg: DoltClientConfig): string {
  if (cfg.database) return cfg.database;
  // bd creates a Dolt database directory at `.beads/dolt/<name>/` whose
  // name is the bd prefix with dashes → underscores. That's the
  // canonical source. config.yaml's `issue-prefix:` is commented-out by
  // default at bd init, so we walk the directory.
  const doltRoot = join(resolvedBeadsRoot(cfg), '.beads', 'dolt');
  try {
    // The dolt root contains a config.yaml file + exactly one database
    // subdirectory whose name is what we want.
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const entries = readdirSync(doltRoot, { withFileTypes: true });
    const dbDir = entries.find((e) => e.isDirectory() && !e.name.startsWith('.'));
    if (dbDir) return dbDir.name;
  } catch {
    // ignore — fall through to inferred name
  }
  // Inferred fallback: last segment of beadsRoot, dashes → underscores
  const segments = resolvedBeadsRoot(cfg).split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? 'beads';
  return name.replace(/-/g, '_');
}

/**
 * Bead row shape — narrow projection of the bd `issues` table covering
 * the fields the orchestration daemon reads. Add columns here as
 * additional queries need them, but resist the urge to mirror the whole
 * 30+-column row.
 */
export interface BeadRow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly priority: number;
  readonly issue_type: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly closed_at: Date | null;
  readonly metadata: Record<string, unknown>;
}

/**
 * Dependency-edge row shape from bd's `dependencies` table.
 *
 *   type='parent-child' — molecule root → step
 *   type='blocks'       — sibling step depends_on
 */
export interface DependencyRow {
  readonly issue_id: string;
  readonly depends_on_id: string;
  readonly type: string;
}

/**
 * The direct-SQL client. Owns a connection pool to the local Dolt
 * server. All operations are typed and parameterized; raw SQL is not
 * exposed to callers.
 */
export class DoltClient {
  private readonly pool: Pool;
  readonly database: string;

  constructor(cfg: DoltClientConfig = {}) {
    const port = readPort(cfg);
    const database = readDatabase(cfg);
    this.database = database;
    this.pool = mysql.createPool({
      host: cfg.host ?? '127.0.0.1',
      port,
      database,
      user: 'root',
      // dolt-sql-server runs without auth for local connections by default.
      // bd's credential key is for remote sync, not the local socket.
      password: '',
      connectionLimit: cfg.poolSize ?? 8,
      waitForConnections: true,
      queueLimit: 0,
    });
  }

  /** Close the pool. Idempotent. */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Insert a `molecule_root` bead. Returns the id assigned by the caller
   * (we don't use bd's hash-id generator here because the daemon needs
   * to know the id BEFORE the row is written so it can record events
   * about it).
   *
   * The caller is responsible for generating a unique id; convention is
   * `<prefix>-mol-<ulid>` to keep them visually distinct from human
   * beads.
   */
  async insertMoleculeRoot(args: {
    readonly id: string;
    readonly formulaName: string;
    readonly title: string;
    readonly motivatingBeadId?: string;
    readonly metadata?: Record<string, unknown>;
  }): Promise<void> {
    const meta = {
      ...(args.metadata ?? {}),
      exec: {
        formula: args.formulaName,
        ...(args.motivatingBeadId ? { motivating_bead: args.motivatingBeadId } : {}),
      },
    };
    await this.pool.execute(
      `INSERT INTO issues (id, title, description, design, acceptance_criteria, notes, status, priority, issue_type, metadata, created_by, owner)
       VALUES (?, ?, '', '', '', '', 'open', 2, 'molecule_root', CAST(? AS JSON), 'orchestration-daemon', 'orchestration-daemon')`,
      [args.id, args.title, JSON.stringify(meta)],
    );
  }

  /**
   * Insert a `molecule_step` bead with a parent-child link to its
   * molecule root and optional `blocks` edges to sibling steps it
   * depends on.
   */
  async insertMoleculeStep(args: {
    readonly id: string;
    readonly parentRootId: string;
    readonly stepName: string;
    readonly title: string;
    readonly dependsOnStepIds?: readonly string[];
    readonly inputPayload?: unknown;
  }): Promise<void> {
    const meta = {
      exec: {
        step: args.stepName,
        molecule: args.parentRootId,
        input_payload: args.inputPayload,
      },
    };
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO issues (id, title, description, design, acceptance_criteria, notes, status, priority, issue_type, metadata, created_by, owner)
         VALUES (?, ?, '', '', '', '', 'open', 2, 'molecule_step', CAST(? AS JSON), 'orchestration-daemon', 'orchestration-daemon')`,
        [args.id, args.title, JSON.stringify(meta)],
      );
      // parent-child edge to root
      await conn.execute(
        `INSERT INTO dependencies (issue_id, depends_on_id, type, created_by)
         VALUES (?, ?, 'parent-child', 'orchestration-daemon')`,
        [args.id, args.parentRootId],
      );
      // blocks edges to predecessor steps
      for (const dep of args.dependsOnStepIds ?? []) {
        await conn.execute(
          `INSERT INTO dependencies (issue_id, depends_on_id, type, created_by)
           VALUES (?, ?, 'blocks', 'orchestration-daemon')`,
          [args.id, dep],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Find steps in a molecule whose `blocks` predecessors are all closed
   * and that are themselves still open — i.e. ready to dispatch.
   *
   * Returns step bead rows in arbitrary order. Caller is responsible
   * for any preferred dispatch ordering beyond dep satisfaction.
   */
  async findReadyStepsForMolecule(rootId: string): Promise<BeadRow[]> {
    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `
      SELECT i.*
      FROM issues i
      JOIN dependencies parent_dep
        ON parent_dep.issue_id = i.id
       AND parent_dep.depends_on_id = ?
       AND parent_dep.type = 'parent-child'
      WHERE i.issue_type = 'molecule_step'
        AND i.status = 'open'
        AND NOT EXISTS (
          SELECT 1
          FROM dependencies blocks_dep
          JOIN issues blocker
            ON blocker.id = blocks_dep.depends_on_id
          WHERE blocks_dep.issue_id = i.id
            AND blocks_dep.type = 'blocks'
            AND blocker.status != 'closed'
        )
      `,
      [rootId],
    );
    return rows.map(toBeadRow);
  }

  /** Mark a step as running (status='in_progress'). */
  async markStepRunning(stepId: string): Promise<void> {
    await this.pool.execute(`UPDATE issues SET status = 'in_progress' WHERE id = ?`, [stepId]);
  }

  /** Mark a step as done with an optional output payload merged into metadata. */
  async markStepDone(stepId: string, output: unknown): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT metadata FROM issues WHERE id = ?`,
        [stepId],
      );
      const existing = rows[0]?.['metadata'];
      const meta = typeof existing === 'string' ? JSON.parse(existing) : (existing ?? {});
      meta.exec = { ...(meta.exec ?? {}), output_payload: output };
      await conn.execute(
        `UPDATE issues SET status = 'closed', closed_at = NOW(), metadata = CAST(? AS JSON) WHERE id = ?`,
        [JSON.stringify(meta), stepId],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /** Mark a step as failed with an error trace recorded in metadata. */
  async markStepFailed(stepId: string, errorTrace: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT metadata FROM issues WHERE id = ?`,
        [stepId],
      );
      const existing = rows[0]?.['metadata'];
      const meta = typeof existing === 'string' ? JSON.parse(existing) : (existing ?? {});
      meta.exec = { ...(meta.exec ?? {}), error_trace: errorTrace };
      await conn.execute(
        `UPDATE issues SET status = 'closed', closed_at = NOW(), close_reason = ?, metadata = CAST(? AS JSON) WHERE id = ?`,
        [`step failed: ${errorTrace.slice(0, 200)}`, JSON.stringify(meta), stepId],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /** Read a single bead by id. */
  async getBead(id: string): Promise<BeadRow | null> {
    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT * FROM issues WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row ? toBeadRow(row) : null;
  }

  /** Read the dependencies edges of a bead. */
  async getBeadDependencies(id: string): Promise<DependencyRow[]> {
    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT issue_id, depends_on_id, type FROM dependencies WHERE issue_id = ? OR depends_on_id = ?`,
      [id, id],
    );
    return rows.map((r) => ({
      issue_id: String(r['issue_id']),
      depends_on_id: String(r['depends_on_id']),
      type: String(r['type']),
    }));
  }
}

function toBeadRow(r: mysql.RowDataPacket): BeadRow {
  const metaRaw = r['metadata'];
  const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : (metaRaw ?? {});
  return {
    id: String(r['id']),
    title: String(r['title'] ?? ''),
    description: String(r['description'] ?? ''),
    status: String(r['status'] ?? 'open'),
    priority: Number(r['priority'] ?? 2),
    issue_type: String(r['issue_type'] ?? 'task'),
    created_at: new Date(r['created_at']),
    updated_at: new Date(r['updated_at']),
    closed_at: r['closed_at'] ? new Date(r['closed_at']) : null,
    metadata: meta,
  };
}
