import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './runner.js';

export const migration002: Migration = {
  version: '002',
  name: 'add_channel_configs',
  up: (db: DatabaseSync) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_configs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        channel_id TEXT,
        channel_secret TEXT,
        channel_access_token TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        UNIQUE (tenant_id, channel_type)
      );
    `);
  },
};
