import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseManager, runWithTenantContext } from '../packages/core/src/index.js';
import { MigrationRunner } from '../packages/core/src/migrations/runner.js';
import { CrmService } from '../packages/crm/src/index.js';
import { ChannelIngestionService } from '../packages/channel-adapters/src/index.js';
import { AgentOrchestrator } from '../packages/agent-runtime/src/orchestrator.js';
import { KnowledgeBaseService, ToolRegistry } from '../packages/agent-runtime/src/index.js';
import { AuditService, AnalyticsService } from '../packages/audit-analytics/src/index.js';
import { IdempotencyStore } from '../packages/core/src/index.js';
import { registerTheHillLandTools, seedTheHillLand } from '../packages/vertical-packs/the-hill-land/src/index.js';

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

describe('Unified Inbox & Team Handoff Workflow Gate', () => {
  test('Migration 003 applies conversation_notes and collision guard columns', () => {
    const db = setupTestDb();
    const applied = MigrationRunner.getAppliedMigrations(db.getRawDb());
    
    assert.ok(applied.some((m) => m.version === '003'), 'Migration 003 must be applied');

    // Verify columns exist on conversations
    const cols = db.getRawDb().prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    assert.ok(colNames.has('tags_json'), 'conversations must have tags_json');
    assert.ok(colNames.has('assigned_team'), 'conversations must have assigned_team');
    assert.ok(colNames.has('locked_by'), 'conversations must have locked_by');
    assert.ok(colNames.has('locked_at'), 'conversations must have locked_at');

    // Verify conversation_notes table exists
    const notesTable = db.getRawDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_notes'").get();
    assert.ok(notesTable, 'conversation_notes table must exist');
  });

  test('Staff assignment, status progression, and tag management', async () => {
    const db = setupTestDb();
    const crm = new CrmService(db);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_1', correlationId: 'test_c1' },
      async () => {
        const contact = crm.getOrCreateContact({
          channelType: 'line',
          channelUserId: 'line_usr_100',
          displayName: 'Khun Arthit',
          phone: '0891234567',
        });

        const conv = crm.getOrCreateConversation(contact.id);
        assert.equal(conv.status, 'active_bot');
        assert.deepEqual(conv.tags, []);

        // 1. Assign to staff and team
        const assignedConv = crm.assignConversation(conv.id, 'Sarah Sales', 'VIP Support');
        assert.equal(assignedConv.assignedTo, 'Sarah Sales');
        assert.equal(assignedConv.assignedTeam, 'VIP Support');

        // 2. Set tags
        const taggedConv = crm.setConversationTags(conv.id, ['VIP', 'ภูธารา แปลง A1', 'นัดชมโครงการ']);
        assert.deepEqual(taggedConv.tags, ['VIP', 'ภูธารา แปลง A1', 'นัดชมโครงการ']);

        // 3. Update status
        const updatedConv = crm.updateConversationStatus(conv.id, 'human_in_progress');
        assert.equal(updatedConv.status, 'human_in_progress');
      }
    );
  });

  test('Internal notes creation, retrieval, and strict cross-tenant isolation', async () => {
    const db = setupTestDb();
    const crm = new CrmService(db);

    let convAId = '';

    // Tenant A (the-hill-land) creates internal notes
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'staff_sarah', correlationId: 'test_note_a' },
      async () => {
        const contact = crm.getOrCreateContact({
          channelType: 'line',
          channelUserId: 'line_usr_200',
          displayName: 'Khun Malee',
        });
        const conv = crm.getOrCreateConversation(contact.id);
        convAId = conv.id;

        const note1 = crm.addInternalNote({
          conversationId: conv.id,
          authorId: 'staff_sarah',
          authorName: 'Sarah Korn',
          content: 'ลูกค้าสะดวกให้โทรหาช่วงบ่าย 2 วันเสาร์ สนใจแปลงวิวเขาติดลำธาร',
        });

        const note2 = crm.addInternalNote({
          conversationId: conv.id,
          authorId: 'staff_sarah',
          authorName: 'Sarah Korn',
          content: 'เตรียมเอกสารโฉนดแปลง A1 และแบบผ่อน 0% เรียบร้อยแล้ว',
        });

        assert.ok(note1.id.startsWith('note_'));
        assert.equal(note1.authorName, 'Sarah Korn');

        const notes = crm.getInternalNotes(conv.id);
        assert.equal(notes.length, 2);
        assert.equal(notes[0].content, 'ลูกค้าสะดวกให้โทรหาช่วงบ่าย 2 วันเสาร์ สนใจแปลงวิวเขาติดลำธาร');
        assert.equal(notes[1].content, 'เตรียมเอกสารโฉนดแปลง A1 และแบบผ่อน 0% เรียบร้อยแล้ว');
      }
    );

    // Tenant B (tenant-beta) attempts to read Tenant A's internal notes
    await runWithTenantContext(
      { tenantId: 'tenant-beta', actorType: 'admin', actorId: 'hacker_bob', correlationId: 'test_leak' },
      async () => {
        const notes = crm.getInternalNotes(convAId);
        assert.equal(notes.length, 0, 'Tenant B must NOT be able to view internal notes of Tenant A');
      }
    );
  });

  test('Anti-collision lock prevents simultaneous agent collision and resolves safely', async () => {
    const db = setupTestDb();
    const crm = new CrmService(db);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_1', correlationId: 'test_lock' },
      async () => {
        const contact = crm.getOrCreateContact({
          channelType: 'line',
          channelUserId: 'line_usr_300',
          displayName: 'Khun Prasert',
        });
        const conv = crm.getOrCreateConversation(contact.id);

        // 1. Agent Sarah acquires lock
        const lock1 = crm.acquireConversationLock(conv.id, 'Agent_Sarah', 5);
        assert.equal(lock1.acquired, true);
        assert.equal(lock1.lockedBy, 'Agent_Sarah');

        // 2. Agent Korn attempts to acquire lock on the same conversation -> Should be blocked!
        const lock2 = crm.acquireConversationLock(conv.id, 'Agent_Korn', 5);
        assert.equal(lock2.acquired, false);
        assert.equal(lock2.lockedBy, 'Agent_Sarah');
        assert.ok(lock2.message.includes('Collision guard active'));

        // 3. Agent Sarah finishes typing and releases lock
        const release = crm.releaseConversationLock(conv.id, 'Agent_Sarah');
        assert.equal(release.released, true);

        // 4. Agent Korn now acquires lock successfully
        const lock3 = crm.acquireConversationLock(conv.id, 'Agent_Korn', 5);
        assert.equal(lock3.acquired, true);
        assert.equal(lock3.lockedBy, 'Agent_Korn');
      }
    );
  });

  test('Human Agent Reply pauses bot, assigns conversation, and safely swallows bot replies', async () => {
    const db = setupTestDb();
    const idempotency = new IdempotencyStore(db);
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const kb = new KnowledgeBaseService(db);
    const tools = new ToolRegistry(audit);
    registerTheHillLandTools(tools, crm, analytics);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'seed', correlationId: 'seed_corr' },
      () => {
        seedTheHillLand(db, kb);
      }
    );

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'agent_staff', correlationId: 'test_reply' },
      async () => {
        // Customer initiates chat
        const customerMsg = {
          tenantId: 'the-hill-land',
          channelType: 'line' as const,
          channelUserId: 'line_cust_400',
          messageId: 'line_msg_01',
          text: 'สวัสดีครับ แปลง A1 ยังว่างอยู่ไหมครับ',
          senderDisplayName: 'Khun Danai',
        };
        const initialResult = await channelService.ingestWebhook(customerMsg);
        assert.ok(initialResult.orchestratorResult?.replyMessage);
        const convId = initialResult.conversation.id;

        // Staff steps in and sends human reply
        const humanMsg = crm.sendHumanReply({
          conversationId: convId,
          agentId: 'staff_korn',
          agentName: 'Korn Property Specialist',
          content: 'สวัสดีครับคุณดนัย ผมกรผู้ดูแลโครงการ แปลง A1 ยังว่างอยู่ครับ บ่ายนี้สะดวกคุยสายไหมครับ',
        });

        assert.equal(humanMsg.senderType, 'agent_human');
        assert.equal(humanMsg.content, 'สวัสดีครับคุณดนัย ผมกรผู้ดูแลโครงการ แปลง A1 ยังว่างอยู่ครับ บ่ายนี้สะดวกคุยสายไหมครับ');

        // Verify conversation is now in human_in_progress and bot_paused = true
        const convAfterHuman = crm.getConversation(convId);
        assert.ok(convAfterHuman);
        assert.equal(convAfterHuman.status, 'human_in_progress');
        assert.equal(convAfterHuman.botPaused, true);
        assert.equal(convAfterHuman.assignedTo, 'Korn Property Specialist');

        // Customer responds back: Bot must NOT answer (anti-collision guard prevents bot intrusion)
        const customerReply = {
          tenantId: 'the-hill-land',
          channelType: 'line' as const,
          channelUserId: 'line_cust_400',
          messageId: 'line_msg_02',
          text: 'สะดวกครับ โทรมาเบอร์นี้ได้เลยครับ 0819998888',
          senderDisplayName: 'Khun Danai',
        };
        const secondResult = await channelService.ingestWebhook(customerReply);
        assert.equal(secondResult.orchestratorResult?.status, 'bot_paused_ignored');
        assert.equal(secondResult.orchestratorResult?.replyMessage, undefined, 'Bot must NOT formulate a reply while human is in progress');

        // But customer's message MUST be recorded in the conversation thread
        const messages = crm.getMessages(convId);
        assert.equal(messages.length, 4); // 1. customer inquiry, 2. bot reply, 3. human reply, 4. customer response
        assert.equal(messages[2].senderType, 'agent_human');
        assert.equal(messages[3].senderType, 'customer');
        assert.equal(messages[3].content, 'สะดวกครับ โทรมาเบอร์นี้ได้เลยครับ 0819998888');
      }
    );
  });
});
