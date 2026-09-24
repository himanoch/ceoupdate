import { test, describe } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { DatabaseManager, IdempotencyStore, runWithTenantContext } from '../packages/core/src/index.js';
import { CrmService } from '../packages/crm/src/index.js';
import { AuditService, AnalyticsService } from '../packages/audit-analytics/src/index.js';
import { KnowledgeBaseService, ToolRegistry } from '../packages/agent-runtime/src/index.js';
import { AgentOrchestrator } from '../packages/agent-runtime/src/orchestrator.js';
import { registerTheHillLandTools, seedTheHillLand } from '../packages/vertical-packs/the-hill-land/src/index.js';
import {
  ChannelIngestionService,
  LineChannelAdapter,
  verifyLineSignature,
  parseLineWebhook,
  LineWebhookPayload,
} from '../packages/channel-adapters/src/index.js';

describe('LINE OA Adapter: Signature Verification Gate', () => {
  const secret = 'test_channel_secret_abc123';

  test('Valid HMAC-SHA256 signature passes verification', () => {
    const rawBody = JSON.stringify({ destination: 'U12345', events: [] });
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const validSignature = hmac.digest('base64');

    assert.strictEqual(
      verifyLineSignature(rawBody, validSignature, secret),
      true,
      'Valid signature must be verified successfully'
    );
  });

  test('Tampered body or invalid signature is rejected', () => {
    const rawBody = JSON.stringify({ destination: 'U12345', events: [] });
    const tamperedBody = JSON.stringify({ destination: 'U12345', events: [], tampered: true });

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const signature = hmac.digest('base64');

    // Tampered body
    assert.strictEqual(
      verifyLineSignature(tamperedBody, signature, secret),
      false,
      'Tampered body must fail signature check'
    );

    // Wrong signature
    assert.strictEqual(
      verifyLineSignature(rawBody, 'invalid_base64_signature', secret),
      false,
      'Invalid signature must be rejected'
    );

    // Wrong secret
    assert.strictEqual(
      verifyLineSignature(rawBody, signature, 'wrong_secret'),
      false,
      'Signature generated with wrong secret must fail'
    );
  });
});

describe('LINE OA Adapter: Event Parsing & Webhook Ingestion Gate', () => {
  test('Parses text messages, extracts replyToken, and filters non-text events safely', () => {
    const payload: LineWebhookPayload = {
      destination: 'U_line_bot_id',
      events: [
        {
          type: 'message',
          mode: 'active',
          timestamp: 1727140000000,
          source: { type: 'user', userId: 'U_customer_line_001' },
          webhookEventId: '01FZ74A0TD...',
          message: { id: 'line_msg_101', type: 'text', text: 'สวัสดีครับ สนใจที่ดิน' },
          replyToken: 'token_reply_abc1',
        },
        {
          type: 'message',
          mode: 'active',
          timestamp: 1727140001000,
          source: { type: 'user', userId: 'U_customer_line_001' },
          message: { id: 'line_msg_102', type: 'sticker' }, // Non-text event
        },
      ],
    };

    const parsed = parseLineWebhook(payload, 'the-hill-land');
    assert.strictEqual(parsed.length, 1, 'Only text message events should be converted');
    assert.strictEqual(parsed[0].channelType, 'line');
    assert.strictEqual(parsed[0].channelUserId, 'U_customer_line_001');
    assert.strictEqual(parsed[0].messageId, 'line_msg_101');
    assert.strictEqual(parsed[0].text, 'สวัสดีครับ สนใจที่ดิน');
    assert.strictEqual(parsed[0].replyToken, 'token_reply_abc1');
  });

  test('Replay attack or duplicate LINE webhook is deduplicated idempotently', async () => {
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
      () => {
        seedTheHillLand(db, kb);
      }
    );

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    const lineEvent = {
      tenantId: 'the-hill-land',
      channelType: 'line' as const,
      channelUserId: 'U_replay_user',
      messageId: 'line_msg_duplicate_999',
      text: 'สนใจแปลง A1 ภูธารา ครับ เบอร์ 0819998888',
      replyToken: 'reply_token_dup',
    };

    // First arrival
    const res1 = await channelService.ingestWebhook(lineEvent);
    assert.strictEqual(res1.isDuplicate, false, 'First ingestion must not be duplicate');
    assert.strictEqual(res1.orchestratorResult.status, 'replied');

    // Duplicate replay
    const res2 = await channelService.ingestWebhook(lineEvent);
    assert.strictEqual(res2.isDuplicate, true, 'Second ingestion must be flagged as duplicate');

    // Verify only 1 lead in CRM
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_check', correlationId: 'check' },
      () => {
        const leads = crm.listLeads();
        assert.strictEqual(leads.length, 1, 'Must have exactly 1 lead, no duplicate on LINE replay');
        assert.strictEqual(leads[0].phone, '0819998888');
      }
    );
  });
});

describe('LINE OA Adapter: End-to-End Chat, Citations & Reply Dispatch', () => {
  test('Complete Customer Journey via LINE: Inquiry -> Citation -> Lead Capture -> Simulated LINE Reply', async () => {
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
      () => {
        seedTheHillLand(db, kb);
      }
    );

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    // Step 1: Customer asks on LINE about plots and financing
    const step1Payload: LineWebhookPayload = {
      destination: 'U_line_bot_id',
      events: [
        {
          type: 'message',
          mode: 'active',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'U_line_customer_somchai' },
          message: { id: 'line_msg_001', type: 'text', text: 'สวัสดีครับ สนใจที่ดินภูธารา ผ่อนตรง 0% ได้ไหม' },
          replyToken: 'reply_token_step1',
        },
      ],
    };

    const parsedEvents1 = parseLineWebhook(step1Payload, 'the-hill-land');
    assert.strictEqual(parsedEvents1.length, 1);

    const step1Result = await channelService.ingestWebhook(parsedEvents1[0]);
    assert.strictEqual(step1Result.orchestratorResult.status, 'replied');
    const reply1Content = step1Result.orchestratorResult.replyMessage?.content || '';
    assert.match(reply1Content, /ภูธารา/, 'Should recommend Phu Thara');
    assert.match(reply1Content, /ผ่อนตรงกับโครงการ 0%/, 'Should highlight 0% financing');

    // Test LINE Reply dispatcher (Synthetic Sandbox mode)
    const replyDispatch1 = await LineChannelAdapter.sendReply({
      replyToken: parsedEvents1[0].replyToken!,
      text: reply1Content,
      citations: step1Result.orchestratorResult.citations,
      channelAccessToken: 'mock_line_token_the_hill_land',
    });
    assert.strictEqual(replyDispatch1.success, true);
    assert.strictEqual(replyDispatch1.deliveryMode, 'synthetic_sandbox');

    // Step 2: Customer provides phone number to schedule visit
    const step2Payload: LineWebhookPayload = {
      destination: 'U_line_bot_id',
      events: [
        {
          type: 'message',
          mode: 'active',
          timestamp: Date.now() + 1000,
          source: { type: 'user', userId: 'U_line_customer_somchai' },
          message: { id: 'line_msg_002', type: 'text', text: 'สนใจแปลง A1 ครับ เบอร์ 0891234567 สะดวกช่วงเช้า' },
          replyToken: 'reply_token_step2',
        },
      ],
    };

    const parsedEvents2 = parseLineWebhook(step2Payload, 'the-hill-land');
    const step2Result = await channelService.ingestWebhook(parsedEvents2[0]);
    assert.strictEqual(step2Result.orchestratorResult.status, 'replied');
    assert.match(step2Result.orchestratorResult.replyMessage?.content || '', /บันทึกข้อมูล/);

    // Verify CRM Contact & Lead records
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'admin_check', correlationId: 'check2' },
      () => {
        const contact = crm.getContact(step2Result.contact.id);
        assert.ok(contact);
        assert.strictEqual(contact?.channelType, 'line');
        assert.strictEqual(contact?.channelUserId, 'U_line_customer_somchai');
        assert.strictEqual(contact?.phone, '0891234567');

        const leads = crm.listLeads();
        assert.strictEqual(leads.length, 1);
        assert.strictEqual(leads[0].phone, '0891234567');
      }
    );
  });
});
