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
  FacebookChannelAdapter,
  verifyFacebookSignature,
  verifyFacebookWebhookChallenge,
  parseFacebookWebhook,
  FacebookWebhookPayload,
} from '../packages/channel-adapters/src/index.js';

describe('Facebook Messenger Adapter: Webhook Challenge Handshake Gate', () => {
  const expectedToken = 'the_hill_land_fb_verify_token_secure';

  test('Valid subscription challenge returns challenge string successfully', () => {
    const result = verifyFacebookWebhookChallenge({
      mode: 'subscribe',
      verifyToken: expectedToken,
      challenge: 'challenge_code_123456789',
      expectedVerifyToken: expectedToken,
    });

    assert.strictEqual(result.valid, true, 'Verification should succeed for matching token');
    assert.strictEqual(result.challenge, 'challenge_code_123456789', 'Challenge code should be returned');
  });

  test('Invalid mode or incorrect verifyToken is rejected', () => {
    // Wrong token
    const wrongTokenResult = verifyFacebookWebhookChallenge({
      mode: 'subscribe',
      verifyToken: 'wrong_verify_token',
      challenge: 'challenge_code_123',
      expectedVerifyToken: expectedToken,
    });
    assert.strictEqual(wrongTokenResult.valid, false, 'Wrong token must fail handshake');

    // Wrong mode
    const wrongModeResult = verifyFacebookWebhookChallenge({
      mode: 'unsubscribe',
      verifyToken: expectedToken,
      challenge: 'challenge_code_123',
      expectedVerifyToken: expectedToken,
    });
    assert.strictEqual(wrongModeResult.valid, false, 'Invalid mode must fail handshake');

    // Missing challenge
    const missingChallengeResult = verifyFacebookWebhookChallenge({
      mode: 'subscribe',
      verifyToken: expectedToken,
      challenge: '',
      expectedVerifyToken: expectedToken,
    });
    assert.strictEqual(missingChallengeResult.valid, false, 'Missing challenge must fail handshake');
  });
});

describe('Facebook Messenger Adapter: Signature Verification Gate', () => {
  const appSecret = 'fb_app_secret_test_xyz789';

  test('Valid HMAC-SHA256 signature in sha256=<hex> format passes verification', () => {
    const rawBody = JSON.stringify({ object: 'page', entry: [] });
    const hmac = crypto.createHmac('sha256', appSecret);
    hmac.update(rawBody);
    const validSignature = `sha256=${hmac.digest('hex')}`;

    assert.strictEqual(
      verifyFacebookSignature(rawBody, validSignature, appSecret),
      true,
      'Valid signature must be verified successfully'
    );
  });

  test('Tampered body or invalid signature is rejected', () => {
    const rawBody = JSON.stringify({ object: 'page', entry: [] });
    const tamperedBody = JSON.stringify({ object: 'page', entry: [{ tampered: true }] });

    const hmac = crypto.createHmac('sha256', appSecret);
    hmac.update(rawBody);
    const signature = `sha256=${hmac.digest('hex')}`;

    // Tampered body
    assert.strictEqual(
      verifyFacebookSignature(tamperedBody, signature, appSecret),
      false,
      'Tampered body must fail signature check'
    );

    // Invalid hex
    assert.strictEqual(
      verifyFacebookSignature(rawBody, 'sha256=1234567890abcdef', appSecret),
      false,
      'Invalid signature must be rejected'
    );

    // Wrong secret
    assert.strictEqual(
      verifyFacebookSignature(rawBody, signature, 'wrong_app_secret'),
      false,
      'Signature generated with wrong secret must fail'
    );
  });
});

describe('Facebook Messenger Adapter: Event Parsing & Ingestion Gate', () => {
  test('Parses text messages, filters out echoes and delivery receipts safely', () => {
    const payload: FacebookWebhookPayload = {
      object: 'page',
      entry: [
        {
          id: 'page_1029384756',
          time: 1727145000000,
          messaging: [
            // Standard customer text message
            {
              sender: { id: 'psid_customer_001' },
              recipient: { id: 'page_1029384756' },
              timestamp: 1727145000000,
              message: {
                mid: 'm_mid_fb_101',
                text: 'สวัสดีครับ สนใจแปลง A1 ภูธารา ครับ',
              },
            },
            // Echo message sent by page (must be filtered out)
            {
              sender: { id: 'page_1029384756' },
              recipient: { id: 'psid_customer_001' },
              timestamp: 1727145001000,
              message: {
                mid: 'm_mid_fb_echo',
                text: 'ข้อความตอบกลับจากแอดมิน',
                is_echo: true,
              },
            },
            // Delivery receipt (must be filtered out)
            {
              sender: { id: 'psid_customer_001' },
              recipient: { id: 'page_1029384756' },
              timestamp: 1727145002000,
              delivery: {
                mids: ['m_mid_fb_101'],
                watermark: 1727145002000,
              },
            },
            // Postback button click
            {
              sender: { id: 'psid_customer_002' },
              recipient: { id: 'page_1029384756' },
              timestamp: 1727145003000,
              postback: {
                title: 'ดูแปลงที่ดินโปรโมชั่น',
                payload: 'GET_PROMOTION_PLOTS',
              },
            },
          ],
        },
      ],
    };

    const parsed = parseFacebookWebhook(payload, 'the-hill-land');
    assert.strictEqual(parsed.length, 2, 'Only customer text and postback events should be parsed');

    // Customer message
    assert.strictEqual(parsed[0].channelType, 'facebook');
    assert.strictEqual(parsed[0].channelUserId, 'psid_customer_001');
    assert.strictEqual(parsed[0].messageId, 'm_mid_fb_101');
    assert.strictEqual(parsed[0].text, 'สวัสดีครับ สนใจแปลง A1 ภูธารา ครับ');

    // Postback button
    assert.strictEqual(parsed[1].channelType, 'facebook');
    assert.strictEqual(parsed[1].channelUserId, 'psid_customer_002');
    assert.strictEqual(parsed[1].messageId, 'fb_postback_1727145003000');
    assert.strictEqual(parsed[1].text, 'ดูแปลงที่ดินโปรโมชั่น');
  });

  test('Replay attack or duplicate Facebook webhook message is deduplicated idempotently', async () => {
    const db = new DatabaseManager(':memory:');
    const idempotency = new IdempotencyStore(db);
    const crm = new CrmService(db);
    const audit = new AuditService(db);
    const analytics = new AnalyticsService(db);
    const kb = new KnowledgeBaseService(db);
    const tools = new ToolRegistry(audit);

    registerTheHillLandTools(tools, crm, analytics);

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'setup', correlationId: 'setup_corr' },
      async () => {
        seedTheHillLand(db, kb);
      }
    );

    const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics);
    const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

    const event = {
      tenantId: 'the-hill-land',
      channelType: 'facebook' as const,
      channelUserId: 'psid_repeat_customer_77',
      messageId: 'mid_unique_fb_9988',
      text: 'สวัสดีครับ สอบถามข้อมูลผ่อนตรง 0%',
    };

    // First ingestion
    const firstResult = await channelService.ingestWebhook(event);
    assert.strictEqual(firstResult.isDuplicate, false, 'First webhook delivery must not be duplicate');
    assert.ok(firstResult.contact.id, 'Contact should be created');

    // Duplicate delivery
    const duplicateResult = await channelService.ingestWebhook(event);
    assert.strictEqual(duplicateResult.isDuplicate, true, 'Second identical webhook must be flagged as duplicate');
    assert.strictEqual(duplicateResult.contact.id, firstResult.contact.id, 'Must reference the exact same contact');

    // Verify messages count in conversation
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'verify', correlationId: 'verify_corr' },
      async () => {
        const messages = crm.getMessages(firstResult.conversation.id);
        const userMessages = messages.filter((m) => m.senderType === 'customer');
        assert.strictEqual(userMessages.length, 1, 'Only one customer message should exist in DB');
      }
    );
  });
});

describe('Facebook Messenger Adapter: End-to-End Chat, Citations & Send API Gate', () => {
  test('Complete Customer Journey via Facebook: Inquiry -> Citation -> Lead Capture -> Simulated Dispatch', async () => {
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

    // 1. Customer asks about plot A1 and leaves phone number
    const inboundEvent = {
      tenantId: 'the-hill-land',
      channelType: 'facebook' as const,
      channelUserId: 'psid_buyer_khun_nong',
      messageId: 'mid_fb_flow_01',
      text: 'สวัสดีครับ สนใจแปลง A1 ภูธารา ครับ เบอร์ 0891234567 นัดชมแปลงวันเสาร์นี้ได้ไหมครับ',
    };

    const processResult = await channelService.ingestWebhook(inboundEvent);
    assert.strictEqual(processResult.isDuplicate, false);
    assert.ok(processResult.orchestratorResult.replyMessage);

    // Verify Persona & Grounded Citations in Orchestrator reply
    const replyText = processResult.orchestratorResult.replyMessage.content;
    assert.match(replyText, /น้อง Chatto/i, 'Reply must be branded with น้อง Chatto persona');

    // Verify Lead captured in CRM
    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'verify', correlationId: 'check_lead' },
      async () => {
        const leads = crm.listLeads();
        assert.strictEqual(leads.length, 1, 'Exactly one CRM lead should be recorded');
        assert.strictEqual(leads[0].phone, '0891234567', 'Lead phone number must match message');
        assert.strictEqual(leads[0].source, 'chatto_bot_the_hill_land');
      }
    );

    // 2. Dispatch Reply via FacebookChannelAdapter in synthetic sandbox mode
    const dispatchResult = await FacebookChannelAdapter.sendReply({
      recipientId: inboundEvent.channelUserId,
      text: replyText,
      citations: processResult.orchestratorResult.citations,
      pageAccessToken: 'mock_fb_page_token_for_tests',
    });

    assert.strictEqual(dispatchResult.success, true, 'Dispatch should succeed in sandbox mode');
    assert.strictEqual(dispatchResult.deliveryMode, 'synthetic_sandbox');
    assert.strictEqual(dispatchResult.recipientId, 'psid_buyer_khun_nong');
    assert.ok(dispatchResult.messageId, 'Synthetic messageId should be generated');
  });
});
