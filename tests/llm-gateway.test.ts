import { test, describe } from 'node:test';
import assert from 'node:assert';

import { DatabaseManager, runWithTenantContext } from '../packages/core/src/index.js';
import { CrmService } from '../packages/crm/src/index.js';
import { AuditService, AnalyticsService } from '../packages/audit-analytics/src/index.js';
import { ToolRegistry } from '../packages/agent-runtime/src/index.js';
import { LLMGateway } from '../packages/agent-runtime/src/llm-gateway.js';
import { registerTheHillLandTools } from '../packages/vertical-packs/the-hill-land/src/index.js';

describe('LLM Gateway Integration', () => {
  test('chooses the correct property search tool and executes it under tenant context', async () => {
    const db = new DatabaseManager(':memory:');
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const tools = new ToolRegistry(audit);

    db.getRawDb().prepare(`
      INSERT OR IGNORE INTO tenants (id, name, status, settings_json, created_at)
      VALUES ('the-hill-land', 'The Hill Land Co., Ltd.', 'active', '{"timezone":"Asia/Bangkok"}', ?)
    `).run(new Date().toISOString());

    registerTheHillLandTools(tools, crm, analytics);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'gateway_test', correlationId: 'llm_gate_01' },
      async () => {
        const gateway = new LLMGateway(tools, { provider: 'mock', model: 'mock-tool-selector' });

        const decision = await gateway.decide({
          conversationId: 'conv_llm_001',
          contactId: 'contact_llm_001',
          message: 'อยากดูที่ดินในกาญจนบุรี งบไม่เกิน 5 แสน',
          persona: 'น้อง Chatto',
          systemPrompt: 'ตอบแบบอัตโนมัติและใช้ tools ที่เหมาะสม',
        });

        assert.strictEqual(decision.action, 'tool_call');
        assert.ok(decision.toolCalls && decision.toolCalls.length > 0);
        assert.strictEqual(decision.toolCalls[0].toolName, 'search_properties');
        assert.ok(decision.toolCalls[0].arguments.maxPrice !== undefined);

        const executed = await gateway.executeToolPlan(decision.toolCalls[0]);
        assert.ok(Array.isArray(executed));
        assert.ok(executed.length > 0);
        assert.strictEqual(executed[0].location.includes('กาญจนบุรี') || executed[0].projectName.includes('ภูธารา'), true);
      }
    );
  });
});
