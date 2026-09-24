import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager, runWithTenantContext } from '../packages/core/src/index.js';
import { MigrationRunner } from '../packages/core/src/migrations/runner.js';
import { KnowledgeIngestionService, AgentPromptService, KnowledgeBaseService, ToolRegistry } from '../packages/agent-runtime/src/index.js';
import { AgentOrchestrator } from '../packages/agent-runtime/src/orchestrator.js';
import { CrmService } from '../packages/crm/src/index.js';
import { AuditService, AnalyticsService } from '../packages/audit-analytics/src/index.js';
import { registerTheHillLandTools } from '../packages/vertical-packs/the-hill-land/src/index.js';

function setupTestDb(): DatabaseManager {
  const db = new DatabaseManager(':memory:');
  const now = new Date().toISOString();
  db.getRawDb().prepare(`
    INSERT OR IGNORE INTO tenants (id, name, status, settings_json, created_at)
    VALUES ('the-hill-land', 'The Hill Land', 'active', '{}', ?)
  `).run(now);

  db.getRawDb().prepare(`
    INSERT OR IGNORE INTO tenants (id, name, status, settings_json, created_at)
    VALUES ('tenant-beta', 'Beta Living Development', 'active', '{}', ?)
  `).run(now);
  return db;
}

describe('Agent Studio & Knowledge Base Ingestion Gate', () => {
  test('Migration 004 applies agent_prompts and knowledge metadata columns', () => {
    const db = setupTestDb();
    const applied = MigrationRunner.getAppliedMigrations(db.getRawDb());
    assert.ok(applied.some((m) => m.version === '004'), 'Migration 004 must be applied');

    // Verify agent_prompts table
    const promptTable = db.getRawDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_prompts'").get();
    assert.ok(promptTable, 'agent_prompts table must exist');

    // Verify knowledge_sources columns
    const cols = db.getRawDb().prepare("PRAGMA table_info(knowledge_sources)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    assert.ok(colNames.has('checksum'), 'knowledge_sources must have checksum');
    assert.ok(colNames.has('chunk_count'), 'knowledge_sources must have chunk_count');
    assert.ok(colNames.has('metadata_json'), 'knowledge_sources must have metadata_json');
  });

  test('CSV document ingestion, column parsing, and checksum deduplication', async () => {
    const db = setupTestDb();
    const ingestion = new KnowledgeIngestionService(db);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_kb', correlationId: 'test_csv' },
      async () => {
        const csvContent = `แปลง,โครงการ,ราคา,เอกสารสิทธิ์,สถานะ
B1,ภูธารา กาญจนบุรี,350000,โฉนด น.ส.4 จ.,ว่าง
B2,ภูธารา กาญจนบุรี,420000,โฉนด น.ส.4 จ.,ว่าง
C1,ภูผาผึ้ง สุพรรณบุรี,290000,โฉนด น.ส.4 จ.,ว่าง`;

        const res1 = await ingestion.ingestDocument({
          title: 'ตารางสรุปแปลงที่ดินเฟสใหม่',
          sourceType: 'csv',
          content: csvContent,
          effectiveDate: '2026-09-24',
          tags: ['ที่ดิน', 'ผ่อน0%'],
        });

        assert.equal(res1.isExisting, false);
        assert.equal(res1.chunkCount, 3, 'Should create exactly 3 row chunks from 3 data lines');
        assert.ok(res1.checksum.length > 0);

        // Check source details and chunks
        const details = ingestion.getSource(res1.sourceId);
        assert.ok(details);
        assert.equal(details.chunks.length, 3);
        assert.ok(details.chunks[0].content.includes('แปลง: B1'));
        assert.ok(details.chunks[0].content.includes('ราคา: 350000'));
        assert.ok(details.chunks[0].tags.includes('350000'));

        // Ingest same content again -> Deduplication must detect existing source
        const res2 = await ingestion.ingestDocument({
          title: 'ตารางสรุปแปลงที่ดินเฟสใหม่ (ซ้ำ)',
          sourceType: 'csv',
          content: csvContent,
        });

        assert.equal(res2.isExisting, true, 'Duplicate content must be flagged as existing');
        assert.equal(res2.sourceId, res1.sourceId, 'Must return same sourceId without re-chunking');
      }
    );
  });

  test('Markdown document section chunking and strict cross-tenant search isolation', async () => {
    const db = setupTestDb();
    const ingestion = new KnowledgeIngestionService(db);
    const kb = new KnowledgeBaseService(db);

    const docContent = `## นโยบายการโอนกรรมสิทธิ์
ที่ดินทุกแปลงของ The Hill Land เป็นโฉนดครุฑแดง น.ส.4 จ. พร้อมโอนกรรมสิทธิ์ ณ สำนักงานที่ดินจังหวัดทันที 100%

## โปรโมชั่นผ่อนตรงกับโครงการ
ลูกค้าสามารถผ่อนตรงกับโครงการได้ 0% สูงสุด 36 เดือน โดยไม่ตรวจเครดิตบูโร และไม่ใช้ผู้ค้ำประกัน`;

    // 1. Tenant A ingests document
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_hl', correlationId: 'test_sec_a' },
      async () => {
        await ingestion.ingestDocument({
          title: 'คู่มือและนโยบาย The Hill Land 2026',
          sourceType: 'text',
          content: docContent,
          effectiveDate: '2026-09-20',
          tags: ['โฉนด', 'ผ่อนตรง'],
        });

        const results = kb.search('ผ่อนตรง');
        assert.ok(results.length > 0);
        assert.ok(results[0].content.includes('36 เดือน'));
        assert.equal(results[0].effectiveDate, '2026-09-20');
      }
    );

    // 2. Tenant B searches -> Must find nothing (Strict Tenant Boundary)
    await runWithTenantContext(
      { tenantId: 'tenant-beta', actorType: 'admin', actorId: 'admin_beta', correlationId: 'test_sec_b' },
      async () => {
        const results = kb.search('ผ่อนตรง');
        assert.equal(results.length, 0, 'Tenant B must NOT find knowledge ingested by Tenant A');

        const sources = ingestion.listSources();
        assert.equal(sources.length, 0, 'Tenant B must have empty sources list');
      }
    );
  });

  test('Agent Studio Prompt Versioning: Draft, Publish, Rollback lifecycle', async () => {
    const db = setupTestDb();
    const promptService = new AgentPromptService(db);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_studio', correlationId: 'test_prompt' },
      async () => {
        // 1. Create Draft v1
        const v1 = promptService.createDraft({
          personaName: 'น้อง Chatto',
          systemPrompt: 'ผู้ช่วยแนะนำแปลงที่ดินวิวเขา The Hill Land',
          businessRules: ['โฉนดครุฑแดง 100%', 'ผ่อน 0%'],
          authorId: 'admin_studio',
        });

        assert.equal(v1.version, 1);
        assert.equal(v1.status, 'draft');

        // Initially no active published prompt
        let active = promptService.getActivePrompt();
        assert.equal(active, null);

        // 2. Publish v1
        const pubV1 = promptService.publishVersion(1);
        assert.equal(pubV1.status, 'published');
        active = promptService.getActivePrompt();
        assert.equal(active?.version, 1);
        assert.equal(active?.personaName, 'น้อง Chatto');

        // 3. Create Draft v2 with new persona
        const v2 = promptService.createDraft({
          personaName: 'พี่ชัชโต้ (Specialist)',
          systemPrompt: 'ผู้เชี่ยวชาญการลงทุนที่ดิน The Hill Land ตอบกระชับ จริงจัง',
          businessRules: ['ห้ามรับรองผลตอบแทน', 'ให้คำปรึกษาโฉนด'],
          authorId: 'admin_studio',
        });

        assert.equal(v2.version, 2);
        assert.equal(v2.status, 'draft');

        // Active prompt is still v1
        active = promptService.getActivePrompt();
        assert.equal(active?.version, 1);

        // 4. Publish v2 -> v1 becomes archived, v2 becomes published
        const pubV2 = promptService.publishVersion(2);
        assert.equal(pubV2.status, 'published');
        active = promptService.getActivePrompt();
        assert.equal(active?.version, 2);
        assert.equal(active?.personaName, 'พี่ชัชโต้ (Specialist)');

        // 5. Rollback to v1
        const rollV1 = promptService.rollbackToVersion(1);
        assert.equal(rollV1.status, 'published');
        active = promptService.getActivePrompt();
        assert.equal(active?.version, 1);
        assert.equal(active?.personaName, 'น้อง Chatto');

        // List all versions
        const all = promptService.listVersions();
        assert.equal(all.length, 2);
      }
    );
  });

  test('Agent Orchestrator adopts published persona dynamically', async () => {
    const db = setupTestDb();
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const kb = new KnowledgeBaseService(db);
    const tools = new ToolRegistry(audit);
    registerTheHillLandTools(tools, crm, analytics);
    const promptService = new AgentPromptService(db);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_hl', correlationId: 'test_orch' },
      async () => {
        // Publish custom persona
        const draft = promptService.createDraft({
          personaName: 'น้อง Chatto Expert',
          systemPrompt: 'ตอบคำถามรวดเร็ว',
          authorId: 'admin_hl',
        });
        promptService.publishVersion(draft.version);

        const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics, promptService);

        const contact = crm.getOrCreateContact({
          channelType: 'line',
          channelUserId: 'usr_dyn_persona',
          displayName: 'Khun Kanya',
        });
        const conv = crm.getOrCreateConversation(contact.id);

        // Send inquiry with unknown topic to trigger fallback reply with persona name
        const result = await orchestrator.processInboundMessage({
          conversationId: conv.id,
          contactId: contact.id,
          messageContent: 'คำถามที่ไม่มีในฐานข้อมูลเกี่ยวกับดาวอังคาร',
          messageId: 'msg_dyn_01',
        });

        assert.equal(result.status, 'handed_off');
        assert.ok(result.replyMessage?.content.includes('น้อง Chatto Expert ขอส่งเรื่องให้เจ้าหน้าที่'));
      }
    );
  });
});
