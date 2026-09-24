import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './runner.js';

export const migration005: Migration = {
  version: '005',
  name: 'job_queue',
  up: (db: DatabaseSync) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_queue (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        job_type TEXT NOT NULL,
        job_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        scheduled_for TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT,
        UNIQUE (tenant_id, job_type, job_key),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);
  },
};
