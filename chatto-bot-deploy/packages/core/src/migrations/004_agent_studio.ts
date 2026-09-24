import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './runner.js';

export const migration004: Migration = {
  version: '004',
  name: 'agent_studio_and_prompts',
  up: (db: DatabaseSync) => {
    // 1. Table for prompt versioning (draft/publish/rollback)
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_prompts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        persona_name TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        business_rules_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        UNIQUE (tenant_id, version)
      );
    `);

    // 2. Add metadata columns to knowledge_sources if not present
    const srcInfo = db.prepare("PRAGMA table_info(knowledge_sources)").all() as Array<{ name: string }>;
    const existingCols = new Set(srcInfo.map(c => c.name));

    if (!existingCols.has('checksum')) {
      db.exec("ALTER TABLE knowledge_sources ADD COLUMN checksum TEXT;");
    }
    if (!existingCols.has('chunk_count')) {
      db.exec("ALTER TABLE knowledge_sources ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0;");
    }
    if (!existingCols.has('metadata_json')) {
      db.exec("ALTER TABLE knowledge_sources ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';");
    }
  },
};
