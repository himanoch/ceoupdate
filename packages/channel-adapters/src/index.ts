import {
  TenantContext,
  runWithTenantContext,
  IdempotencyStore,
  DatabaseManager,
} from '../../core/src/index.js';
import { CrmService, Contact, Conversation, Message } from '../../crm/src/index.js';
import { AgentOrchestrator, ProcessMessageResult } from '../../agent-runtime/src/orchestrator.js';

export interface InboundWebhookEvent {
  tenantId: string;
  channelType: 'sandbox' | 'line' | 'facebook' | 'webchat';
  channelUserId: string;
  messageId: string;
  text: string;
  senderDisplayName?: string;
  senderPhone?: string;
  timestamp?: string;
  replyToken?: string;
}

export interface InboundProcessingResult {
  isDuplicate: boolean;
  contact: Contact;
  conversation: Conversation;
  orchestratorResult: ProcessMessageResult;
  replyToken?: string;
}

export class ChannelIngestionService {
  constructor(
    private db: DatabaseManager,
    private crm: CrmService,
    private orchestrator: AgentOrchestrator,
    private idempotency: IdempotencyStore
  ) {}

  public async ingestWebhook(event: InboundWebhookEvent): Promise<InboundProcessingResult> {
    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tenantContext: TenantContext = {
      tenantId: event.tenantId,
      actorType: 'customer',
      actorId: event.channelUserId,
      correlationId,
    };

    return await runWithTenantContext(tenantContext, async () => {
      const deduplicationKey = `${event.channelType}:${event.channelUserId}:${event.messageId}`;

      // Check duplicate message delivery
      const existing = this.idempotency.getExisting<InboundProcessingResult>('webhook_ingest', deduplicationKey);
      if (existing) {
        return {
          ...existing,
          isDuplicate: true,
        };
      }

      // 1. Get or create Contact
      const contact = this.crm.getOrCreateContact({
        channelType: event.channelType,
        channelUserId: event.channelUserId,
        displayName: event.senderDisplayName || `User ${event.channelUserId.slice(-4)}`,
        phone: event.senderPhone,
      });

      // 2. Get or create active Conversation
      const conversation = this.crm.getOrCreateConversation(contact.id);

      // 3. Process via Agent Orchestrator
      const orchestratorResult = await this.orchestrator.processInboundMessage({
        conversationId: conversation.id,
        contactId: contact.id,
        messageContent: event.text,
        messageId: event.messageId,
      });

      // 4. Reload updated conversation
      const updatedConversation = this.crm.getConversation(conversation.id) || conversation;

      const result: InboundProcessingResult = {
        isDuplicate: false,
        contact,
        conversation: updatedConversation,
        orchestratorResult,
        replyToken: event.replyToken,
      };

      // Save idempotency result
      this.idempotency.saveResult('webhook_ingest', deduplicationKey, result);

      return result;
    });
  }
}

export * from './line-adapter.js';
export * from './facebook-adapter.js';
