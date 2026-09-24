import { test, describe } from 'node:test';
import assert from 'node:assert';
import { DatabaseManager, IdempotencyStore, runWithTenantContext } from '../packages/core/src/index.js';
import { CrmService } from '../packages/crm/src/index.js';
import { AuditService, AnalyticsService } from '../packages/audit-analytics/src/index.js';
import { KnowledgeBaseService, ToolRegistry } from '../packages/agent-runtime/src/index.js';
import { AgentOrchestrator } from '../packages/agent-runtime/src/orchestrator.js';
import { registerTheHillLandTools, seedTheHillLand } from '../packages/vertical-packs/the-hill-land/src/index.js';
import { ChannelIngestionService } from '../packages/channel-adapters/src/index.js';

describe('Duplicate Webhook & Idempotency Gate', () => {
  test('Duplicate webhook message does not produce duplicate messages or duplicate leads', async () => {
    const db = new DatabaseManager(':memory:');
    const idempotency = new IdempotencyStore(db);
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const kb = new KnowledgeBaseService(db);
    const tools = new ToolRegistry(audit);

    // Register vertical pack
    registerTheHillLandTools(tools, crm, analytics);

    // Seed The Hill Land
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'init', correlationId: 'init_corr' },
      async () => {
        seedTheHillLand(db, kb);
      }
    );

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    const webhookEvent = {
      tenantId: 'the-hill-land',
      channelType: 'sandbox' as const,
      channelUserId: 'user_replay_001',
      messageId: 'msg_webhook_unique_999',
      text: 'สนใจที่ดินภูธารา งบ 5 แสน ติดต่อเบอร์ 0891234567',
      senderDisplayName: 'Khun Anan',
    };

    // First ingestion
    const firstResult = await channelService.ingestWebhook(webhookEvent);
    assert.strictEqual(firstResult.isDuplicate, false, 'First ingestion must not be duplicate');
    assert.strictEqual(firstResult.orchestratorResult.status, 'replied');

    // Second ingestion (replayed identical webhook)
    const secondResult = await channelService.ingestWebhook(webhookEvent);
    assert.strictEqual(secondResult.isDuplicate, true, 'Second ingestion must be flagged as duplicate');

    // Verify database state: exactly 1 conversation, exactly 2 messages (1 customer, 1 bot), exactly 1 lead
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'verifier', correlationId: 'verify' },
      async () => {
        const messages = crm.getMessages(firstResult.conversation.id);
        assert.strictEqual(messages.length, 2, 'Must contain only 1 customer message and 1 bot reply');

        const leads = crm.listLeads();
        assert.strictEqual(leads.length, 1, 'Must contain exactly 1 lead, no duplicate lead creation');
        assert.strictEqual(leads[0].phone, '0891234567');
      }
    );
  });
});
