import { test, describe } from 'node:test';
import assert from 'node:assert';
import { DatabaseManager, runWithTenantContext } from '../packages/core/src/index.js';
import { CrmService } from '../packages/crm/src/index.js';
import { KnowledgeBaseService } from '../packages/agent-runtime/src/index.js';

describe('Cross-Tenant Data Isolation Gate', () => {
  test('Tenant B cannot read contacts, conversations, leads, or knowledge of The Hill Land', async () => {
    const db = new DatabaseManager(':memory:');
    const crm = new CrmService(db);
    const kb = new KnowledgeBaseService(db);

    const now = new Date().toISOString();
    db.getRawDb().prepare(`INSERT INTO tenants (id, name, created_at) VALUES ('the-hill-land', 'The Hill Land', ?)`).run(now);
    db.getRawDb().prepare(`INSERT INTO tenants (id, name, created_at) VALUES ('tenant-beta', 'Beta Realty', ?)`).run(now);

    // 1. Create data under Tenant A: 'the-hill-land'
    let contactAId = '';
    let convAId = '';
    let leadAId = '';

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_1', correlationId: 'c1' },
      async () => {
        const contactA = crm.getOrCreateContact({
          channelType: 'line',
          channelUserId: 'U_hill_land_001',
          displayName: 'Khun Somchai',
          phone: '0811111111',
        });
        contactAId = contactA.id;

        const convA = crm.getOrCreateConversation(contactA.id);
        convAId = convA.id;

        crm.addMessage({
          conversationId: convA.id,
          senderType: 'customer',
          content: 'สนใจแปลง A1 ภูธารา 390,000 บาท',
        });

        const leadA = crm.createLead({
          contactId: contactA.id,
          conversationId: convA.id,
          source: 'chat',
          interestZone: 'กาญจนบุรี',
          budgetMax: 500000,
          phone: '0811111111',
        });
        leadAId = leadA.id;

        kb.addSource({
          title: 'เอกสารลับ The Hill Land',
          sourceType: 'document',
          effectiveDate: '2026-09-20',
          chunks: [{ content: 'ข้อมูลแปลงที่ดินส่วนตัว โครงการภูธารา', tags: 'ลับ ภูธารา' }],
        });
      }
    );

    // 2. Query under Tenant B: 'tenant-beta'
    await runWithTenantContext(
      { tenantId: 'tenant-beta', actorType: 'admin', actorId: 'admin_beta', correlationId: 'c2' },
      async () => {
        // Tenant B lists conversations: must be empty
        const betaConversations = crm.listConversations();
        assert.strictEqual(betaConversations.length, 0, 'Tenant B should not see Tenant A conversations');

        // Tenant B lists leads: must be empty
        const betaLeads = crm.listLeads();
        assert.strictEqual(betaLeads.length, 0, 'Tenant B should not see Tenant A leads');

        // Tenant B tries to get conversation of Tenant A directly by ID
        const targetConv = crm.getConversation(convAId);
        assert.strictEqual(targetConv, null, 'Direct lookup of cross-tenant conversation must return null');

        // Tenant B searches knowledge base
        const kbResults = kb.search('ภูธารา');
        assert.strictEqual(kbResults.length, 0, 'Tenant B cannot retrieve Tenant A knowledge base chunks');

        // Tenant B messages lookup for Tenant A conversation
        const messages = crm.getMessages(convAId);
        assert.strictEqual(messages.length, 0, 'Tenant B cannot read messages of Tenant A conversation');
      }
    );
  });
});
