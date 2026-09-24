import type { DatabaseSync } from 'node:sqlite';
import { migration001 } from './001_initial_schema.js';
import { migration002 } from './002_channel_configs.js';
import { migration003 } from './003_unified_inbox.js';
import { migration004 } from './004_agent_studio.js';
import { migration005 } from './005_job_queue.js';

export interface Migration {
  version: string;
  name: string;
  up: (db: DatabaseSync) => void;
}

export interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: string;
}

export class MigrationRunner {
  private static registeredMigrations: Migration[] = [migration001, migration002, migration003, migration004, migration005];

  public static registerMigration(migration: Migration): void {
    if (!this.registeredMigrations.some((m) => m.version === migration.version)) {
      this.registeredMigrations.push(migration);
      this.registeredMigrations.sort((a, b) => a.version.localeCompare(b.version));
    }
  }

  public static getRegisteredMigrations(): Migration[] {
    return [...this.registeredMigrations];
  }

  public static runAll(db: DatabaseSync): MigrationRecord[] {
    // 1. Enable Foreign Keys
    db.exec('PRAGMA foreign_keys = ON;');

    // 2. Enable WAL mode if supported (may be no-op on :memory:)
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // Memory db may not support WAL mode, ignore
    }

    // 3. Ensure migrations table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // 4. Retrieve already applied versions
    const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[];
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    const newlyApplied: MigrationRecord[] = [];

    // 5. Execute pending migrations in sequence
    for (const migration of this.registeredMigrations) {
      if (!appliedVersions.has(migration.version)) {
        migration.up(db);
        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, now);

        newlyApplied.push({
          version: migration.version,
          name: migration.name,
          appliedAt: now,
        });
      }
    }

    return newlyApplied;
  }

  public static getAppliedMigrations(db: DatabaseSync): MigrationRecord[] {
    try {
      const rows = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC').all() as any[];
      return rows.map((r) => ({
        version: r.version,
        name: r.name,
        appliedAt: r.applied_at,
      }));
    } catch {
      return [];
    }
  }
}
