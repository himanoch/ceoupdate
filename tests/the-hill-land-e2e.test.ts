import { test, describe } from 'node:test';
import assert from 'node:assert';
import { DatabaseManager, IdempotencyStore, runWithTenantContext } from '../packages/core/src/index.js';
import { CrmService } from '../packages/crm/src/index.js';
import { AuditService, AnalyticsService } from '../packages/audit-analytics/src/index.js';
import { KnowledgeBaseService, ToolRegistry } from '../packages/agent-runtime/src/index.js';
import { AgentOrchestrator } from '../packages/agent-runtime/src/orchestrator.js';
import { registerTheHillLandTools, seedTheHillLand } from '../packages/vertical-packs/the-hill-land/src/index.js';
import { ChannelIngestionService } from '../packages/channel-adapters/src/index.js';

describe('The Hill Land End-to-End Vertical Slice Gate', () => {
  test('Complete Customer Journey: Inquire -> Grounded Citation -> Lead Capture -> Audit & Analytics', async () => {
    const db = new DatabaseManager(':memory:');
    const idempotency = new IdempotencyStore(db);
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const kb = new KnowledgeBaseService(db);
    const tools = new ToolRegistry(audit);

    registerTheHillLandTools(tools, crm, analytics);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'seed', correlationId: 'seed_corr' },
      async () => {
        seedTheHillLand(db, kb);
      }
    );

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    // Step 1: Customer asks about plots & financing
    const step1 = await channelService.ingestWebhook({
      tenantId: 'the-hill-land',
      channelType: 'sandbox',
      channelUserId: 'customer_somchai',
      messageId: 'msg_step1',
      text: 'สวัสดีครับ อยากดูที่ดินวิวเขา กาญจนบุรี งบไม่เกิน 5 แสน มีผ่อนตรงไหม',
      senderDisplayName: 'คุณสมชาย',
    });

    assert.strictEqual(step1.orchestratorResult.status, 'replied');
    const reply1 = step1.orchestratorResult.replyMessage?.content || '';
    assert.match(reply1, /ภูธารา/, 'Should mention Phu Thara project');
    assert.match(reply1, /โฉนดครุฑแดง/, 'Should mention Garuda title deed');
    assert.match(reply1, /ผ่อนตรงกับโครงการ 0%/, 'Should mention 0% financing');

    // Verify Citations
    const citations = step1.orchestratorResult.citations || [];
    assert.ok(citations.length > 0, 'Response must have grounded citations');
    assert.ok(citations.some((c) => c.effectiveDate.length > 0), 'Citations must have effective dates');

    // Step 2: Customer provides phone number & expresses interest
    const step2 = await channelService.ingestWebhook({
      tenantId: 'the-hill-land',
      channelType: 'sandbox',
      channelUserId: 'customer_somchai',
      messageId: 'msg_step2',
      text: 'สนใจแปลง A1 ครับ เบอร์ผม 0812345678 สะดวกรับสายช่วงบ่ายครับ',
      senderDisplayName: 'คุณสมชาย',
    });

    assert.strictEqual(step2.orchestratorResult.status, 'replied');
    const reply2 = step2.orchestratorResult.replyMessage?.content || '';
    assert.match(reply2, /บันทึกข้อมูล/, 'Must confirm lead capture');
    assert.match(reply2, /0812345678/, 'Must echo back phone number');

    // Step 3: Verify CRM Lead & Tenant Boundary
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_audit', correlationId: 'audit_corr' },
      async () => {
        const leads = crm.listLeads();
        assert.strictEqual(leads.length, 1, 'Exactly one lead captured');
        assert.strictEqual(leads[0].phone, '0812345678');
        assert.ok(
          leads[0].source === 'chatto_bot_the_hill_land' || leads[0].source === 'chaty_bot_the_hill_land',
          'Source must be valid Chatto Bot lead identifier'
        );
        assert.strictEqual(leads[0].status, 'new');

        // Step 4: Verify Audit Events
        const auditLogs = audit.getTenantAuditLogs(50);
        assert.ok(auditLogs.length >= 2, 'Must have audit entries for tool executions');
        const leadAudit = auditLogs.find((l) => l.action === 'tool.execute:create_lead');
        assert.ok(leadAudit, 'Must record audit log for create_lead tool');
        assert.strictEqual(leadAudit?.tenantId, 'the-hill-land');

        // Step 5: Verify Dynamic Funnel Analytics
        const funnel = analytics.getFunnelMetrics();
        assert.strictEqual(funnel.messagesReceived, 2, '2 messages received');
        assert.strictEqual(funnel.leadsCaptured, 1, '1 lead captured');
        assert.strictEqual(funnel.conversionRate, 50, 'Conversion rate should be 50%');
      }
    );
  });
});
