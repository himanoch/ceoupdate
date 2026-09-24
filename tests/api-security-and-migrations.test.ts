import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseManager, MigrationRunner, runWithTenantContext } from '../packages/core/src/index.js';
import { CrmService } from '../packages/crm/src/index.js';
import { authenticateRequest, getCorsHeaders } from '../apps/api/src/security.js';
import type http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.resolve(__dirname, '../scratch');

describe('Database Migration & Persistence Gate', () => {
  test('MigrationRunner executes initial schema and records version idempotently', () => {
    const db = new DatabaseManager(':memory:');
    const rawDb = db.getRawDb();

    // 1. Verify schema_migrations table exists and contains registered versions
    const applied = MigrationRunner.getAppliedMigrations(rawDb);
    assert.strictEqual(applied.length, 4, 'Should have exactly 4 applied migrations');
    assert.strictEqual(applied[0].version, '001');
    assert.strictEqual(applied[0].name, 'initial_schema');
    assert.strictEqual(applied[1].version, '002');
    assert.strictEqual(applied[1].name, 'add_channel_configs');
    assert.strictEqual(applied[2].version, '003');
    assert.strictEqual(applied[2].name, 'unified_inbox_and_collision_guards');
    assert.strictEqual(applied[3].version, '004');
    assert.strictEqual(applied[3].name, 'agent_studio_and_prompts');

    // 2. Running migrations again must be a no-op (idempotent)
    const secondRun = MigrationRunner.runAll(rawDb);
    assert.strictEqual(secondRun.length, 0, 'Second run must apply 0 new migrations');
  });

  test('Persistent file database retains records across reconnects', () => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const dbFile = path.join(tempDir, `test_persist_${Date.now()}.db`);

    try {
      // Step 1: Open database, insert tenant and contact
      const db1 = new DatabaseManager(dbFile);
      const crm1 = new CrmService(db1);

      db1.getRawDb().prepare(`
        INSERT INTO tenants (id, name, created_at) VALUES ('test-persist-tenant', 'Persistent Co', ?)
      `).run(new Date().toISOString());

      let contactId = '';
      runWithTenantContext(
        { tenantId: 'test-persist-tenant', actorType: 'admin', actorId: 'admin1', correlationId: 'c1' },
        () => {
          const contact = crm1.getOrCreateContact({
            channelType: 'line',
            channelUserId: 'U_persist_001',
            displayName: 'Persistent User',
            phone: '0899999999',
          });
          contactId = contact.id;
        }
      );

      // Step 2: Open a fresh connection to the same file
      const db2 = new DatabaseManager(dbFile);
      const crm2 = new CrmService(db2);

      runWithTenantContext(
        { tenantId: 'test-persist-tenant', actorType: 'admin', actorId: 'admin2', correlationId: 'c2' },
        () => {
          const contact = crm2.getOrCreateContact({
            channelType: 'line',
            channelUserId: 'U_persist_001',
            displayName: 'Persistent User',
          });
          assert.strictEqual(contact.id, contactId, 'Must retain contact ID across reconnects');
          assert.strictEqual(contact.phone, '0899999999', 'Must retain contact phone from disk');
        }
      );
    } finally {
      // Cleanup temporary test files
      try {
        if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
        const walFile = `${dbFile}-wal`;
        const shmFile = `${dbFile}-shm`;
        if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
        if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
      } catch {
        // file lock may delay deletion on Windows, ignore
      }
    }
  });
});

describe('API Security & Authentication Gate', () => {
  test('authenticateRequest validates valid Bearer tokens and rejects invalid ones', () => {
    // 1. Valid test token
    const validReq = {
      headers: {
        authorization: 'Bearer test-token:the-hill-land:admin:alice',
      },
    } as unknown as http.IncomingMessage;

    const auth = authenticateRequest(validReq);
    assert.ok(auth, 'Should return AuthSession for valid token');
    assert.strictEqual(auth?.tenantId, 'the-hill-land');
    assert.strictEqual(auth?.actorType, 'admin');
    assert.strictEqual(auth?.actorId, 'alice');

    // 2. Missing authorization header
    const missingReq = {
      headers: {},
    } as unknown as http.IncomingMessage;
    assert.strictEqual(authenticateRequest(missingReq), null, 'Missing auth header must return null');

    // 3. Malformed authorization header
    const malformedReq = {
      headers: {
        authorization: 'Basic dXNlcjpwYXNz',
      },
    } as unknown as http.IncomingMessage;
    assert.strictEqual(authenticateRequest(malformedReq), null, 'Non-Bearer auth must return null');
  });

  test('getCorsHeaders properly controls origin reflection', () => {
    const devReq = {
      headers: {
        origin: 'http://localhost:3000',
      },
    } as unknown as http.IncomingMessage;

    const headers = getCorsHeaders(devReq);
    assert.ok(headers['Access-Control-Allow-Origin'], 'CORS origin must be present');
    assert.strictEqual(headers['Vary'], 'Origin');
  });
});
