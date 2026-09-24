import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseManager, IdempotencyStore, runWithTenantContext, ActorType } from '../../../packages/core/src/index.js';
import { CrmService } from '../../../packages/crm/src/index.js';
import { AuditService, AnalyticsService } from '../../../packages/audit-analytics/src/index.js';
import { KnowledgeBaseService, ToolRegistry, KnowledgeIngestionService, AgentPromptService } from '../../../packages/agent-runtime/src/index.js';
import { AgentOrchestrator } from '../../../packages/agent-runtime/src/orchestrator.js';
import { registerTheHillLandTools, seedTheHillLand, SYNTHETIC_PLOTS } from '../../../packages/vertical-packs/the-hill-land/src/index.js';
import { ChannelIngestionService, LineChannelAdapter, FacebookChannelAdapter } from '../../../packages/channel-adapters/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../');

// Environment & Security Configuration
const isProduction = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim().toLowerCase())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// Initialize system dependencies (uses DATABASE_PATH or :memory:)
const db = new DatabaseManager();
const idempotency = new IdempotencyStore(db);
const crm = new CrmService(db);
const audit = new AuditService(db);
const analytics = new AnalyticsService(db);
const kb = new KnowledgeBaseService(db);
const ingestion = new KnowledgeIngestionService(db);
const promptService = new AgentPromptService(db);
const tools = new ToolRegistry(audit);

// Register Tools & Seed The Hill Land Tenant
registerTheHillLandTools(tools, crm, analytics);
await runWithTenantContext(
  { tenantId: 'the-hill-land', actorType: 'system', actorId: 'bootstrap', correlationId: 'boot_01' },
  async () => {
    seedTheHillLand(db, kb);

    // Seed initial active prompt for The Hill Land if none exists
    const active = promptService.getActivePrompt();
    if (!active) {
      const draft = promptService.createDraft({
        personaName: 'น้อง Chatto',
        systemPrompt: 'ผู้ช่วยอัจฉริยะด้านการขายและการบริการลูกค้าของ The Hill Land ตอบสุภาพ ถูกต้องตามข้อเท็จจริง และพาเข้าสู่การนัดหมายชมแปลงที่ดิน',
        businessRules: [
          'ทุกแปลงมีโฉนดครุฑแดง น.ส.4 จ. พร้อมโอน 100%',
          'โปรโมชั่นผ่อนตรง 0% สูงสุด 36 เดือน',
          'ห้ามรับรองผลตอบแทนหรือกำไรจากการลงทุนที่ดิน'
        ],
        authorId: 'bootstrap',
      });
      promptService.publishVersion(draft.version);
    }
  }
);

// Register Tenant Beta for Isolation Demonstrations
db.getRawDb().prepare(`
  INSERT OR IGNORE INTO tenants (id, name, status, settings_json, created_at)
  VALUES ('tenant-beta', 'Beta Living Development', 'active', '{"timezone":"Asia/Bangkok"}', ?)
`).run(new Date().toISOString());

// Register Demo/BYOK LINE Channel Credentials for The Hill Land
db.getRawDb().prepare(`
  INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, channel_id, channel_secret, channel_access_token, is_active, created_at, updated_at)
  VALUES ('cfg_hl_line', 'the-hill-land', 'line', '1650000000', 'the_hill_land_line_secret_demo', 'mock_line_token_the_hill_land', 1, ?, ?)
`).run(new Date().toISOString(), new Date().toISOString());

// Register Demo/BYOK Facebook Channel Credentials for The Hill Land
db.getRawDb().prepare(`
  INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, channel_id, channel_secret, channel_access_token, is_active, created_at, updated_at)
  VALUES ('cfg_hl_fb', 'the-hill-land', 'facebook', 'the_hill_land_fb_verify_demo', 'the_hill_land_fb_secret_demo', 'mock_fb_page_token_the_hill_land', 1, ?, ?)
`).run(new Date().toISOString(), new Date().toISOString());

const orchestrator = new AgentOrchestrator(crm, kb, tools, audit, analytics, promptService);
const channelService = new ChannelIngestionService(db, crm, orchestrator, idempotency);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

import { authenticateRequest, getCorsHeaders, type AuthSession } from './security.js';
export { authenticateRequest, getCorsHeaders, type AuthSession };

function sendJson(req: http.IncomingMessage, res: http.ServerResponse, statusCode: number, data: any) {
  const corsHeaders = getCorsHeaders(req);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  });
  res.end(JSON.stringify(data));
}

function readRawBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  const raw = await readRawBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    const corsHeaders = getCorsHeaders(req);
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const urlObj = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = urlObj.pathname;
  const correlationId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    // 1.0 Facebook Webhook Challenge Verification (GET)
    if (req.method === 'GET' && (pathname === '/api/webhooks/facebook' || pathname.startsWith('/api/webhooks/facebook/'))) {
      const tenantFromPath = pathname.replace('/api/webhooks/facebook/', '').replace('/api/webhooks/facebook', '').trim();
      const tenantId = tenantFromPath || urlObj.searchParams.get('tenantId') || 'the-hill-land';

      const mode = urlObj.searchParams.get('hub.mode') || undefined;
      const verifyToken = urlObj.searchParams.get('hub.verify_token') || undefined;
      const challenge = urlObj.searchParams.get('hub.challenge') || undefined;

      const rawDb = db.getRawDb();
      const config = rawDb.prepare(
        "SELECT channel_secret, channel_id FROM channel_configs WHERE tenant_id = ? AND channel_type = 'facebook' AND is_active = 1"
      ).get(tenantId) as { channel_secret?: string; channel_id?: string } | undefined;

      const expectedVerifyToken = process.env.FACEBOOK_VERIFY_TOKEN || config?.channel_id || config?.channel_secret || (tenantId === 'the-hill-land' ? 'the_hill_land_fb_verify_demo' : `chatto_fb_verify_${tenantId}`);

      const verification = FacebookChannelAdapter.verifyChallenge({
        mode,
        verifyToken,
        challenge,
        expectedVerifyToken,
      });

      if (verification.valid && verification.challenge) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(verification.challenge);
      }

      return sendJson(req, res, 403, {
        error: 'Facebook Webhook challenge verification failed',
        code: 'CHALLENGE_FAILED',
      });
    }

    // 1. Webhook Ingestion API (POST)
    if (req.method === 'POST' && pathname.startsWith('/api/webhooks/')) {
      const rawBody = await readRawBody(req);
      let body: any = {};
      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch (err) {
        return sendJson(req, res, 400, { error: 'Invalid JSON payload', code: 'INVALID_JSON' });
      }

      // 1.1 Dedicated LINE OA Webhook Route: /api/webhooks/line or /api/webhooks/line/:tenantId
      if (pathname === '/api/webhooks/line' || pathname.startsWith('/api/webhooks/line/')) {
        const tenantFromPath = pathname.replace('/api/webhooks/line/', '').replace('/api/webhooks/line', '').trim();
        const tenantId = tenantFromPath || (req.headers['x-tenant-id'] as string) || urlObj.searchParams.get('tenantId') || 'the-hill-land';

        // Retrieve tenant channel config from BYOK channel_configs store
        const rawDb = db.getRawDb();
        const config = rawDb.prepare(
          "SELECT channel_secret, channel_access_token FROM channel_configs WHERE tenant_id = ? AND channel_type = 'line' AND is_active = 1"
        ).get(tenantId) as { channel_secret?: string; channel_access_token?: string } | undefined;

        const secret = config?.channel_secret || process.env.LINE_CHANNEL_SECRET || (tenantId === 'the-hill-land' ? 'the_hill_land_line_secret_demo' : undefined);
        const signature = req.headers['x-line-signature'] as string;

        if (!signature) {
          return sendJson(req, res, 401, {
            error: 'Missing x-line-signature header for LINE webhook verification',
            code: 'SIGNATURE_MISSING',
          });
        }

        if (!secret) {
          return sendJson(req, res, 500, {
            error: `LINE channelSecret not configured for tenant '${tenantId}'`,
            code: 'CONFIG_MISSING',
          });
        }

        const isValid = LineChannelAdapter.verifySignature(rawBody, signature, secret);
        if (!isValid) {
          return sendJson(req, res, 401, {
            error: 'Invalid x-line-signature. Webhook payload verification failed.',
            code: 'INVALID_SIGNATURE',
          });
        }

        // Parse LINE events into Chatto Bot internal event format
        const lineEvents = LineChannelAdapter.parseWebhook(body, tenantId);
        const processedResults = [];

        for (const ev of lineEvents) {
          const result = await channelService.ingestWebhook(ev);
          processedResults.push(result);

          // Dispatch automatic reply back to LINE if replyToken is present and bot formulated a reply
          if (ev.replyToken && result.orchestratorResult?.replyMessage) {
            await LineChannelAdapter.sendReply({
              replyToken: ev.replyToken,
              text: result.orchestratorResult.replyMessage.content,
              citations: result.orchestratorResult.citations,
              channelAccessToken: config?.channel_access_token,
            });
          }
        }

        return sendJson(req, res, 200, {
          success: true,
          tenantId,
          eventsProcessed: lineEvents.length,
          results: processedResults,
        });
      }

      // 1.2 Dedicated Facebook Messenger Webhook Route: /api/webhooks/facebook or /api/webhooks/facebook/:tenantId
      if (pathname === '/api/webhooks/facebook' || pathname.startsWith('/api/webhooks/facebook/')) {
        const tenantFromPath = pathname.replace('/api/webhooks/facebook/', '').replace('/api/webhooks/facebook', '').trim();
        const tenantId = tenantFromPath || (req.headers['x-tenant-id'] as string) || urlObj.searchParams.get('tenantId') || 'the-hill-land';

        // Retrieve tenant channel config from BYOK channel_configs store
        const rawDb = db.getRawDb();
        const config = rawDb.prepare(
          "SELECT channel_secret, channel_access_token FROM channel_configs WHERE tenant_id = ? AND channel_type = 'facebook' AND is_active = 1"
        ).get(tenantId) as { channel_secret?: string; channel_access_token?: string } | undefined;

        const appSecret = config?.channel_secret || process.env.FACEBOOK_APP_SECRET || (tenantId === 'the-hill-land' ? 'the_hill_land_fb_secret_demo' : undefined);
        const signature = (req.headers['x-hub-signature-256'] as string) || (req.headers['x-hub-signature'] as string);

        if (!signature) {
          return sendJson(req, res, 401, {
            error: 'Missing x-hub-signature-256 header for Facebook webhook verification',
            code: 'SIGNATURE_MISSING',
          });
        }

        if (!appSecret) {
          return sendJson(req, res, 500, {
            error: `Facebook appSecret not configured for tenant '${tenantId}'`,
            code: 'CONFIG_MISSING',
          });
        }

        const isValid = FacebookChannelAdapter.verifySignature(rawBody, signature, appSecret);
        if (!isValid) {
          return sendJson(req, res, 401, {
            error: 'Invalid x-hub-signature-256. Webhook payload verification failed.',
            code: 'INVALID_SIGNATURE',
          });
        }

        // Parse Facebook events into Chatto Bot internal event format
        const fbEvents = FacebookChannelAdapter.parseWebhook(body, tenantId);
        const processedResults = [];

        for (const ev of fbEvents) {
          const result = await channelService.ingestWebhook(ev);
          processedResults.push(result);

          // Dispatch automatic reply back to Facebook if bot formulated a reply
          if (result.orchestratorResult?.replyMessage) {
            await FacebookChannelAdapter.sendReply({
              recipientId: ev.channelUserId,
              text: result.orchestratorResult.replyMessage.content,
              citations: result.orchestratorResult.citations,
              pageAccessToken: config?.channel_access_token,
            });
          }
        }

        return sendJson(req, res, 200, {
          success: true,
          tenantId,
          eventsProcessed: fbEvents.length,
          results: processedResults,
        });
      }

      // 1.3 Sandbox / Generic Channel Route
      const channel = pathname.replace('/api/webhooks/', '') as 'sandbox' | 'line' | 'facebook' | 'webchat';

      // Verify tenant boundary for webhooks
      const requestedTenant = body.tenantId || (req.headers['x-tenant-id'] as string);
      if (!requestedTenant) {
        return sendJson(req, res, 400, {
          error: 'Missing required tenant identification for webhook ingestion',
          code: 'TENANT_REQUIRED',
        });
      }

      const event = {
        tenantId: requestedTenant,
        channelType: channel || 'sandbox',
        channelUserId: body.channelUserId || 'sandbox_user_01',
        messageId: body.messageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: body.text || '',
        senderDisplayName: body.senderDisplayName || 'Khun Test',
        senderPhone: body.senderPhone,
      };

      const result = await channelService.ingestWebhook(event);
      return sendJson(req, res, 200, { success: true, ...result });
    }

    // 2. REST Management APIs (Scoped to authenticated tenant context)
    if (pathname.startsWith('/api/')) {
      const auth = authenticateRequest(req);
      const requestedHeaderTenant = (req.headers['x-tenant-id'] as string) || urlObj.searchParams.get('tenantId');

      // Security Check: Production strictly requires authentication
      if (isProduction && !auth) {
        return sendJson(req, res, 401, {
          error: 'Unauthorized: Valid Bearer authentication token required',
          code: 'AUTH_REQUIRED',
        });
      }

      let effectiveTenantId: string;
      let actorType: ActorType = 'admin';
      let actorId = 'admin_dashboard';

      if (auth) {
        // Prevent cross-tenant spoofing: if client requested a different tenant, reject!
        if (requestedHeaderTenant && requestedHeaderTenant !== auth.tenantId) {
          return sendJson(req, res, 403, {
            error: `Forbidden: Authenticated tenant '${auth.tenantId}' cannot access resources of requested tenant '${requestedHeaderTenant}'.`,
            code: 'CROSS_TENANT_FORBIDDEN',
          });
        }
        effectiveTenantId = auth.tenantId;
        actorType = auth.actorType;
        actorId = auth.actorId;
      } else {
        // Development / Sandbox mode only: require explicit tenant, never use silent default tenant
        if (!requestedHeaderTenant) {
          return sendJson(req, res, 400, {
            error: 'Missing tenant specification. Explicit x-tenant-id or tenantId parameter is required in development.',
            code: 'TENANT_REQUIRED',
          });
        }
        effectiveTenantId = requestedHeaderTenant;
      }

      const tenantContext = {
        tenantId: effectiveTenantId,
        actorType,
        actorId,
        correlationId,
      };

      return await runWithTenantContext(tenantContext, async () => {
        // List Conversations
        if (req.method === 'GET' && pathname === '/api/conversations') {
          const list = crm.listConversations();
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, conversations: list });
        }

        // Get Messages of a Conversation
        if (req.method === 'GET' && pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/)) {
          const convId = pathname.split('/')[3];
          const messages = crm.getMessages(convId);
          return sendJson(req, res, 200, { success: true, conversationId: convId, messages });
        }

        // Pause Bot (Handoff)
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/pause$/)) {
          const convId = pathname.split('/')[3];
          const body = await parseJsonBody(req);
          crm.pauseBot(convId, body.reason || 'Staff requested manual takeover', actorId);
          audit.logAudit({
            action: 'bot.paused',
            resourceType: 'conversation',
            resourceId: convId,
            payload: { reason: body.reason },
          });
          return sendJson(req, res, 200, { success: true, botPaused: true });
        }

        // Resume Bot
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/resume$/)) {
          const convId = pathname.split('/')[3];
          crm.resumeBot(convId, actorId);
          audit.logAudit({
            action: 'bot.resumed',
            resourceType: 'conversation',
            resourceId: convId,
          });
          return sendJson(req, res, 200, { success: true, botPaused: false });
        }

        // Assign Conversation to Staff/Team
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/assign$/)) {
          const convId = pathname.split('/')[3];
          const body = await parseJsonBody(req);
          if (!body.assignedTo) {
            return sendJson(req, res, 400, { error: 'Missing assignedTo field', code: 'PARAM_REQUIRED' });
          }
          const conv = crm.assignConversation(convId, body.assignedTo, body.assignedTeam);
          audit.logAudit({
            action: 'conversation.assigned',
            resourceType: 'conversation',
            resourceId: convId,
            payload: { assignedTo: body.assignedTo, assignedTeam: body.assignedTeam },
          });
          return sendJson(req, res, 200, { success: true, conversation: conv });
        }

        // Update Conversation Status
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/status$/)) {
          const convId = pathname.split('/')[3];
          const body = await parseJsonBody(req);
          if (!body.status) {
            return sendJson(req, res, 400, { error: 'Missing status field', code: 'PARAM_REQUIRED' });
          }
          const conv = crm.updateConversationStatus(convId, body.status);
          audit.logAudit({
            action: 'conversation.status_updated',
            resourceType: 'conversation',
            resourceId: convId,
            payload: { status: body.status },
          });
          return sendJson(req, res, 200, { success: true, conversation: conv });
        }

        // Get Internal Notes
        if (req.method === 'GET' && pathname.match(/^\/api\/conversations\/([^/]+)\/notes$/)) {
          const convId = pathname.split('/')[3];
          const notes = crm.getInternalNotes(convId);
          return sendJson(req, res, 200, { success: true, conversationId: convId, notes });
        }

        // Add Internal Note
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/notes$/)) {
          const convId = pathname.split('/')[3];
          const body = await parseJsonBody(req);
          if (!body.content || !body.content.trim()) {
            return sendJson(req, res, 400, { error: 'Note content cannot be empty', code: 'PARAM_REQUIRED' });
          }
          const note = crm.addInternalNote({
            conversationId: convId,
            authorId: actorId,
            authorName: body.authorName || actorId,
            content: body.content.trim(),
          });
          audit.logAudit({
            action: 'conversation.note_added',
            resourceType: 'conversation',
            resourceId: convId,
            payload: { noteId: note.id, authorName: note.authorName },
          });
          return sendJson(req, res, 201, { success: true, note });
        }

        // Human Agent Reply
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/reply$/)) {
          const convId = pathname.split('/')[3];
          const body = await parseJsonBody(req);
          if (!body.content || !body.content.trim()) {
            return sendJson(req, res, 400, { error: 'Reply content cannot be empty', code: 'PARAM_REQUIRED' });
          }
          const msg = crm.sendHumanReply({
            conversationId: convId,
            agentId: actorId,
            agentName: body.agentName || actorId,
            content: body.content.trim(),
          });
          audit.logAudit({
            action: 'message.sent_by_human',
            resourceType: 'conversation',
            resourceId: convId,
            payload: { messageId: msg.id, agentName: body.agentName || actorId },
          });
          return sendJson(req, res, 200, { success: true, message: msg });
        }

        // Set Conversation Tags
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/tags$/)) {
          const convId = pathname.split('/')[3];
          const body = await parseJsonBody(req);
          const tags = Array.isArray(body.tags) ? body.tags : [];
          const conv = crm.setConversationTags(convId, tags);
          audit.logAudit({
            action: 'conversation.tags_updated',
            resourceType: 'conversation',
            resourceId: convId,
            payload: { tags },
          });
          return sendJson(req, res, 200, { success: true, conversation: conv });
        }

        // Anti-Collision Lock (Acquire / Release)
        if (req.method === 'POST' && pathname.match(/^\/api\/conversations\/([^/]+)\/lock$/)) {
          const convId = pathname.split('/')[3];
          const body = await parseJsonBody(req);
          const agentId = body.agentId || actorId;
          const action = body.action || 'acquire';

          if (action === 'release') {
            const resLock = crm.releaseConversationLock(convId, agentId);
            return sendJson(req, res, 200, { success: true, ...resLock });
          } else {
            const resLock = crm.acquireConversationLock(convId, agentId, body.timeoutMinutes || 5);
            return sendJson(req, res, resLock.acquired ? 200 : 409, { success: resLock.acquired, ...resLock });
          }
        }

        // List Leads
        if (req.method === 'GET' && pathname === '/api/leads') {
          const leads = crm.listLeads();
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, leads });
        }

        // List Audit Logs
        if (req.method === 'GET' && pathname === '/api/audit-logs') {
          const logs = audit.getTenantAuditLogs(50);
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, auditLogs: logs });
        }

        // Funnel Analytics
        if (req.method === 'GET' && pathname === '/api/analytics') {
          const metrics = analytics.getFunnelMetrics();
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, metrics });
        }

        // Available Inventory
        if (req.method === 'GET' && pathname === '/api/inventory') {
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, plots: SYNTHETIC_PLOTS });
        }

        // Knowledge Base search/view
        if (req.method === 'GET' && pathname === '/api/knowledge') {
          const query = urlObj.searchParams.get('q') || '';
          const results = kb.search(query || 'ที่ดิน', 10);
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, items: results });
        }

        // Ingest Knowledge Document (Text, CSV, PDF, URL)
        if (req.method === 'POST' && pathname === '/api/knowledge/ingest') {
          const body = await parseJsonBody(req);
          if (!body.title || !body.content) {
            return sendJson(req, res, 400, { error: 'Missing required title or content', code: 'PARAM_REQUIRED' });
          }
          const result = await ingestion.ingestDocument({
            title: body.title,
            sourceType: body.sourceType || 'text',
            content: body.content,
            url: body.url,
            effectiveDate: body.effectiveDate,
            tags: body.tags,
            chunkSize: body.chunkSize,
            chunkOverlap: body.chunkOverlap,
          });
          audit.logAudit({
            action: 'knowledge.document_ingested',
            resourceType: 'knowledge_source',
            resourceId: result.sourceId,
            payload: { title: result.title, chunkCount: result.chunkCount, sourceType: result.sourceType },
          });
          return sendJson(req, res, 201, { success: true, ...result });
        }

        // List Knowledge Sources
        if (req.method === 'GET' && pathname === '/api/knowledge/sources') {
          const sources = ingestion.listSources();
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, sources });
        }

        // Get Knowledge Source Details with Chunks
        if (req.method === 'GET' && pathname.match(/^\/api\/knowledge\/sources\/([^/]+)$/)) {
          const srcId = pathname.split('/')[4];
          const details = ingestion.getSource(srcId);
          if (!details) return sendJson(req, res, 404, { error: 'Source not found' });
          return sendJson(req, res, 200, { success: true, ...details });
        }

        // Delete Knowledge Source
        if (req.method === 'DELETE' && pathname.match(/^\/api\/knowledge\/sources\/([^/]+)$/)) {
          const srcId = pathname.split('/')[4];
          const deleted = ingestion.deleteSource(srcId);
          if (!deleted) return sendJson(req, res, 404, { error: 'Source not found' });
          audit.logAudit({
            action: 'knowledge.source_deleted',
            resourceType: 'knowledge_source',
            resourceId: srcId,
          });
          return sendJson(req, res, 200, { success: true, deleted: true });
        }

        // --- Agent Studio & Prompts ---

        // List Prompt Versions
        if (req.method === 'GET' && pathname === '/api/agent/prompts') {
          const versions = promptService.listVersions();
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, versions });
        }

        // Get Active Published Prompt
        if (req.method === 'GET' && pathname === '/api/agent/prompts/active') {
          const activePrompt = promptService.getActivePrompt();
          return sendJson(req, res, 200, { success: true, tenantId: effectiveTenantId, activePrompt });
        }

        // Create Prompt Draft
        if (req.method === 'POST' && pathname === '/api/agent/prompts/draft') {
          const body = await parseJsonBody(req);
          if (!body.personaName || !body.systemPrompt) {
            return sendJson(req, res, 400, { error: 'personaName and systemPrompt are required', code: 'PARAM_REQUIRED' });
          }
          const draft = promptService.createDraft({
            personaName: body.personaName,
            systemPrompt: body.systemPrompt,
            businessRules: body.businessRules,
            authorId: actorId,
          });
          audit.logAudit({
            action: 'agent_prompt.draft_created',
            resourceType: 'agent_prompt',
            resourceId: draft.id,
            payload: { version: draft.version, personaName: draft.personaName },
          });
          return sendJson(req, res, 201, { success: true, prompt: draft });
        }

        // Publish Prompt Version
        if (req.method === 'POST' && pathname.match(/^\/api\/agent\/prompts\/(\d+)\/publish$/)) {
          const ver = parseInt(pathname.split('/')[4], 10);
          const published = promptService.publishVersion(ver);
          audit.logAudit({
            action: 'agent_prompt.published',
            resourceType: 'agent_prompt',
            resourceId: published.id,
            payload: { version: ver, personaName: published.personaName },
          });
          return sendJson(req, res, 200, { success: true, prompt: published });
        }

        // Rollback Prompt to Version
        if (req.method === 'POST' && pathname.match(/^\/api\/agent\/prompts\/(\d+)\/rollback$/)) {
          const ver = parseInt(pathname.split('/')[4], 10);
          const rolled = promptService.rollbackToVersion(ver);
          audit.logAudit({
            action: 'agent_prompt.rolled_back',
            resourceType: 'agent_prompt',
            resourceId: rolled.id,
            payload: { targetVersion: ver },
          });
          return sendJson(req, res, 200, { success: true, prompt: rolled });
        }

        // Channel Integrations Configuration (BYOK Credentials & Webhook URLs)
        if (req.method === 'GET' && pathname === '/api/channels/config') {
          const rawDb = db.getRawDb();
          const rows = rawDb.prepare(
            "SELECT channel_type, channel_id, channel_secret, channel_access_token, is_active, updated_at FROM channel_configs WHERE tenant_id = ?"
          ).all(effectiveTenantId) as Array<{
            channel_type: string;
            channel_id: string | null;
            channel_secret: string | null;
            channel_access_token: string | null;
            is_active: number;
            updated_at: string;
          }>;

          const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
          const host = req.headers.host || 'localhost:3000';
          const baseUrl = `${protocol}://${host}`;

          const mask = (str: string | null) => {
            if (!str) return '';
            if (str.length <= 8) return '••••••••';
            return `${str.slice(0, 4)}••••••••${str.slice(-4)}`;
          };

          const lineRow = rows.find(r => r.channel_type === 'line');
          const fbRow = rows.find(r => r.channel_type === 'facebook');

          const responseData = {
            success: true,
            tenantId: effectiveTenantId,
            line: {
              configured: !!(lineRow && lineRow.channel_secret),
              channelId: lineRow?.channel_id || '',
              channelSecretMasked: mask(lineRow?.channel_secret || null),
              channelAccessTokenMasked: mask(lineRow?.channel_access_token || null),
              isActive: lineRow ? lineRow.is_active === 1 : false,
              webhookUrl: `${baseUrl}/api/webhooks/line/${effectiveTenantId}`,
              updatedAt: lineRow?.updated_at || null,
            },
            facebook: {
              configured: !!(fbRow && fbRow.channel_secret),
              channelId: fbRow?.channel_id || '',
              verifyToken: fbRow?.channel_id || (effectiveTenantId === 'the-hill-land' ? 'the_hill_land_fb_verify_demo' : `chatto_fb_verify_${effectiveTenantId}`),
              appSecretMasked: mask(fbRow?.channel_secret || null),
              pageAccessTokenMasked: mask(fbRow?.channel_access_token || null),
              isActive: fbRow ? fbRow.is_active === 1 : false,
              webhookUrl: `${baseUrl}/api/webhooks/facebook/${effectiveTenantId}`,
              updatedAt: fbRow?.updated_at || null,
            }
          };

          return sendJson(req, res, 200, responseData);
        }

        if (req.method === 'POST' && pathname === '/api/channels/config') {
          const body = await parseJsonBody(req);
          const channelType = body.channelType; // 'line' | 'facebook'
          if (!channelType || !['line', 'facebook'].includes(channelType)) {
            return sendJson(req, res, 400, { error: 'Invalid channelType. Must be line or facebook', code: 'INVALID_PARAM' });
          }

          const rawDb = db.getRawDb();
          const existing = rawDb.prepare(
            "SELECT id, channel_id, channel_secret, channel_access_token FROM channel_configs WHERE tenant_id = ? AND channel_type = ?"
          ).get(effectiveTenantId, channelType) as { id: string; channel_id: string | null; channel_secret: string | null; channel_access_token: string | null } | undefined;

          const id = existing?.id || `cfg_${effectiveTenantId}_${channelType}_${Date.now()}`;
          const channelId = (body.channelId !== undefined && body.channelId !== '') ? body.channelId : (existing?.channel_id || '');
          const channelSecret = (body.channelSecret && !body.channelSecret.includes('••••')) ? body.channelSecret : (existing?.channel_secret || '');
          const channelAccessToken = (body.channelAccessToken && !body.channelAccessToken.includes('••••')) ? body.channelAccessToken : (existing?.channel_access_token || '');
          const isActive = body.isActive !== undefined ? (body.isActive ? 1 : 0) : 1;
          const now = new Date().toISOString();

          rawDb.prepare(`
            INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, channel_id, channel_secret, channel_access_token, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, effectiveTenantId, channelType, channelId, channelSecret, channelAccessToken, isActive, now, now);

          audit.logAudit({
            action: `channel_config.updated`,
            resourceType: 'channel_config',
            resourceId: id,
            payload: { tenantId: effectiveTenantId, channelType, isActive },
          });

          return sendJson(req, res, 200, {
            success: true,
            tenantId: effectiveTenantId,
            channelType,
            message: `Channel configuration for ${channelType.toUpperCase()} updated successfully`
          });
        }

        return sendJson(req, res, 404, { error: 'Not Found' });
      });
    }

    // 3. Serve Static Assets & Brand Images (Chatto Bot Primary, with Legacy Fallback)
    if (pathname === '/brand-profile.png') {
      const primaryImg = path.join(projectRoot, 'chatto-bot-orange-cap-profile.png');
      const fallbackImg = path.join(projectRoot, 'chaty-bot-orange-cap-profile.png');
      const imgPath = fs.existsSync(primaryImg) ? primaryImg : fallbackImg;
      if (fs.existsSync(imgPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return fs.createReadStream(imgPath).pipe(res);
      }
    }

    if (pathname === '/brand-cover.png') {
      const primaryImg = path.join(projectRoot, 'chaty-bot-orange-cap-facebook-cover.png');
      if (fs.existsSync(primaryImg)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return fs.createReadStream(primaryImg).pipe(res);
      }
    }

    // Serve Web Admin Dashboard
    const publicDir = path.join(projectRoot, 'apps/web-admin/public');
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fallback to index.html
    const fallbackIndex = path.join(publicDir, 'index.html');
    if (fs.existsSync(fallbackIndex)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(fallbackIndex).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err: any) {
    console.error('Server Error:', err);
    sendJson(req, res, 500, { error: err.message || 'Internal Server Error' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`\n🚀 [Chatto Bot AI Operations Platform] Server running on http://localhost:${PORT}`);
    console.log(`📡 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`🏢 Active Design Partner: the-hill-land`);
    console.log(`💻 Web Admin & Live Sandbox: http://localhost:${PORT}\n`);
  });
}

export { server, db, crm, audit, analytics, kb, tools, channelService };
