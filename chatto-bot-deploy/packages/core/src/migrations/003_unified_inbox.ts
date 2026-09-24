import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './runner.js';

export const migration003: Migration = {
  version: '003',
  name: 'unified_inbox_and_collision_guards',
  up: (db: DatabaseSync) => {
    // 1. Create table for internal notes (staff-only comments)
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_notes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `);

    // 2. Add columns to conversations for collision guards, assignment, and tags
    // Using SQLite safe column additions
    const convInfo = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    const existingCols = new Set(convInfo.map(c => c.name));

    if (!existingCols.has('tags_json')) {
      db.exec("ALTER TABLE conversations ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';");
    }
    if (!existingCols.has('assigned_team')) {
      db.exec("ALTER TABLE conversations ADD COLUMN assigned_team TEXT;");
    }
    if (!existingCols.has('locked_by')) {
      db.exec("ALTER TABLE conversations ADD COLUMN locked_by TEXT;");
    }
    if (!existingCols.has('locked_at')) {
      db.exec("ALTER TABLE conversations ADD COLUMN locked_at TEXT;");
    }
  },
};
