import { test, describe } from 'node:test';
import assert from 'node:assert';
import { DatabaseManager, IdempotencyStore, runWithTenantContext } from '../packages/core/src/index.js';
import { CrmService } from '../packages/crm/src/index.js';
import { AuditService, AnalyticsService } from '../packages/audit-analytics/src/index.js';
import { KnowledgeBaseService, ToolRegistry } from '../packages/agent-runtime/src/index.js';
import { AgentOrchestrator } from '../packages/agent-runtime/src/orchestrator.js';
import { registerTheHillLandTools, seedTheHillLand } from '../packages/vertical-packs/the-hill-land/src/index.js';
import { ChannelIngestionService } from '../packages/channel-adapters/src/index.js';

describe('Human Handoff & Bot Pause Gate', () => {
  test('Bot pauses on human request, ignores subsequent messages, and resumes on staff action', async () => {
    const db = new DatabaseManager(':memory:');
    const idempotency = new IdempotencyStore(db);
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const kb = new KnowledgeBaseService(db);
    const tools = new ToolRegistry(audit);

    registerTheHillLandTools(tools, crm, analytics);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'init', correlationId: 'init' },
      async () => {
        seedTheHillLand(db, kb);
      }
    );

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    // 1. Customer asks for human
    const handoffResult = await channelService.ingestWebhook({
      tenantId: 'the-hill-land',
      channelType: 'sandbox',
      channelUserId: 'customer_handoff_01',
      messageId: 'msg_01',
      text: 'สวัสดีครับ อยากติดต่อเจ้าหน้าที่ ขอคุยกับคนหน่อยครับ',
    });

    assert.strictEqual(handoffResult.orchestratorResult.status, 'handed_off');
    assert.strictEqual(handoffResult.conversation.botPaused, true, 'Bot must be paused after handoff');

    // 2. Customer sends another message while bot is paused
    const subsequentResult = await channelService.ingestWebhook({
      tenantId: 'the-hill-land',
      channelType: 'sandbox',
      channelUserId: 'customer_handoff_01',
      messageId: 'msg_02',
      text: 'มีใครอยู่ไหมครับ ช่วยตอบหน่อย',
    });

    assert.strictEqual(
      subsequentResult.orchestratorResult.status,
      'bot_paused_ignored',
      'Bot must remain silent while paused'
    );
    assert.strictEqual(subsequentResult.orchestratorResult.replyMessage, undefined);

    // 3. Human staff takes over and resumes bot
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'agent_human', actorId: 'staff_alice', correlationId: 'resume' },
      async () => {
        crm.resumeBot(handoffResult.conversation.id, 'staff_alice');
      }
    );

    // 4. Customer asks again after resume -> Bot replies normally
    const postResumeResult = await channelService.ingestWebhook({
      tenantId: 'the-hill-land',
      channelType: 'sandbox',
      channelUserId: 'customer_handoff_01',
      messageId: 'msg_03',
      text: 'แปลง A1 ภูธารา ราคาเท่าไหร่ครับ',
    });

    assert.strictEqual(
      postResumeResult.orchestratorResult.status,
      'replied',
      'Bot must reply normally once resumed'
    );
    assert.match(
      postResumeResult.orchestratorResult.replyMessage?.content || '',
      /390,000/,
      'Reply should contain price'
    );
  });

  test('Emergency keyword immediately halts sales flow and escalates', async () => {
    const db = new DatabaseManager(':memory:');
    const idempotency = new IdempotencyStore(db);
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const kb = new KnowledgeBaseService(db);
    const tools = new ToolRegistry(audit);

    registerTheHillLandTools(tools, crm, analytics);

    const now = new Date().toISOString();
    db.getRawDb().prepare(`INSERT INTO tenants (id, name, created_at) VALUES ('the-hill-land', 'The Hill Land', ?)`).run(now);

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    const emergencyResult = await channelService.ingestWebhook({
      tenantId: 'the-hill-land',
      channelType: 'sandbox',
      channelUserId: 'resident_002',
      messageId: 'msg_emergency_01',
      text: 'ด่วนครับ มีไฟไหม้หญ้าแห้งใกล้หม้อแปลงไฟฟ้าหน้าแปลง!',
    });

    assert.strictEqual(emergencyResult.orchestratorResult.status, 'handed_off');
    assert.match(
      emergencyResult.orchestratorResult.replyMessage?.content || '',
      /ฉุกเฉิน/,
      'Must contain emergency alert notice'
    );
    assert.strictEqual(emergencyResult.conversation.botPaused, true);
  });
});
