import { DatabaseManager, getTenantContext } from '../../core/src/index.js';

export interface Contact {
  id: string;
  tenantId: string;
  channelType: string;
  channelUserId: string;
  displayName: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  contactId: string;
  status: 'active_bot' | 'handoff_requested' | 'human_in_progress' | 'closed';
  botPaused: boolean;
  handoffReason?: string;
  assignedTo?: string;
  assignedTeam?: string;
  tags: string[];
  lockedBy?: string;
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationNote {
  id: string;
  tenantId: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface MessageCitation {
  sourceId: string;
  title: string;
  snippet: string;
  effectiveDate: string;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  senderType: 'customer' | 'agent_ai' | 'agent_human' | 'system';
  content: string;
  citations: MessageCitation[];
  createdAt: string;
}

export interface Lead {
  id: string;
  tenantId: string;
  contactId: string;
  conversationId: string;
  source: string;
  interestZone?: string;
  budgetMin?: number;
  budgetMax?: number;
  purpose?: string;
  phone?: string;
  status: string;
  notes?: string;
  createdAt: string;
}

export class CrmService {
  constructor(private db: DatabaseManager) {}

  // --- Contacts ---

  public getOrCreateContact(params: {
    channelType: string;
    channelUserId: string;
    displayName: string;
    phone?: string;
  }): Contact {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const existing = rawDb.prepare(`
      SELECT * FROM contacts
      WHERE tenant_id = ? AND channel_type = ? AND channel_user_id = ?
    `).get(ctx.tenantId, params.channelType, params.channelUserId) as any;

    if (existing) {
      if (params.phone && !existing.phone) {
        rawDb.prepare(`
          UPDATE contacts SET phone = ?, updated_at = ? WHERE id = ? AND tenant_id = ?
        `).run(params.phone, new Date().toISOString(), existing.id, ctx.tenantId);
        existing.phone = params.phone;
      }
      return {
        id: existing.id,
        tenantId: existing.tenant_id,
        channelType: existing.channel_type,
        channelUserId: existing.channel_user_id,
        displayName: existing.display_name,
        phone: existing.phone,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      };
    }

    const id = `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO contacts (
        id, tenant_id, channel_type, channel_user_id, display_name, phone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ctx.tenantId,
      params.channelType,
      params.channelUserId,
      params.displayName,
      params.phone || null,
      now,
      now
    );

    return {
      id,
      tenantId: ctx.tenantId,
      channelType: params.channelType,
      channelUserId: params.channelUserId,
      displayName: params.displayName,
      phone: params.phone,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getContact(id: string): Contact | null {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const row = rawDb.prepare(`
      SELECT * FROM contacts WHERE id = ? AND tenant_id = ?
    `).get(id, ctx.tenantId) as any;

    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      channelType: row.channel_type,
      channelUserId: row.channel_user_id,
      displayName: row.display_name,
      phone: row.phone,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- Conversations ---

  public getOrCreateConversation(contactId: string): Conversation {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    // Check open conversation
    const existing = rawDb.prepare(`
      SELECT * FROM conversations
      WHERE tenant_id = ? AND contact_id = ? AND status != 'closed'
      ORDER BY created_at DESC LIMIT 1
    `).get(ctx.tenantId, contactId) as any;

    if (existing) {
      return {
        id: existing.id,
        tenantId: existing.tenant_id,
        contactId: existing.contact_id,
        status: existing.status,
        botPaused: existing.bot_paused === 1,
        handoffReason: existing.handoff_reason,
        assignedTo: existing.assigned_to,
        assignedTeam: existing.assigned_team,
        tags: JSON.parse(existing.tags_json || '[]'),
        lockedBy: existing.locked_by,
        lockedAt: existing.locked_at,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      };
    }

    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO conversations (
        id, tenant_id, contact_id, status, bot_paused, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'active_bot', 0, '[]', ?, ?)
    `).run(id, ctx.tenantId, contactId, now, now);

    return {
      id,
      tenantId: ctx.tenantId,
      contactId,
      status: 'active_bot',
      botPaused: false,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  public getConversation(conversationId: string): Conversation | null {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const r = rawDb.prepare(`
      SELECT * FROM conversations WHERE id = ? AND tenant_id = ?
    `).get(conversationId, ctx.tenantId) as any;

    if (!r) return null;
    return {
      id: r.id,
      tenantId: r.tenant_id,
      contactId: r.contact_id,
      status: r.status,
      botPaused: r.bot_paused === 1,
      handoffReason: r.handoff_reason,
      assignedTo: r.assigned_to,
      assignedTeam: r.assigned_team,
      tags: JSON.parse(r.tags_json || '[]'),
      lockedBy: r.locked_by,
      lockedAt: r.locked_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public listConversations(): Conversation[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const rows = rawDb.prepare(`
      SELECT * FROM conversations WHERE tenant_id = ? ORDER BY updated_at DESC
    `).all(ctx.tenantId) as any[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      contactId: r.contact_id,
      status: r.status,
      botPaused: r.bot_paused === 1,
      handoffReason: r.handoff_reason,
      assignedTo: r.assigned_to,
      assignedTeam: r.assigned_team,
      tags: JSON.parse(r.tags_json || '[]'),
      lockedBy: r.locked_by,
      lockedAt: r.locked_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public addMessage(params: {
    conversationId: string;
    senderType: 'customer' | 'agent_ai' | 'agent_human' | 'system';
    content: string;
    citations?: MessageCitation[];
  }): Message {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const citations = params.citations || [];

    rawDb.prepare(`
      INSERT INTO messages (
        id, tenant_id, conversation_id, sender_type, content, citations_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ctx.tenantId,
      params.conversationId,
      params.senderType,
      params.content,
      JSON.stringify(citations),
      now
    );

    // update conversation updated_at
    rawDb.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ? AND tenant_id = ?
    `).run(now, params.conversationId, ctx.tenantId);

    return {
      id,
      tenantId: ctx.tenantId,
      conversationId: params.conversationId,
      senderType: params.senderType,
      content: params.content,
      citations,
      createdAt: now,
    };
  }

  public getMessages(conversationId: string): Message[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const rows = rawDb.prepare(`
      SELECT * FROM messages
      WHERE tenant_id = ? AND conversation_id = ?
      ORDER BY created_at ASC
    `).all(ctx.tenantId, conversationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      conversationId: r.conversation_id,
      senderType: r.sender_type,
      content: r.content,
      citations: JSON.parse(r.citations_json || '[]'),
      createdAt: r.created_at,
    }));
  }

  public pauseBot(conversationId: string, reason: string, pausedBy: string): void {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const now = new Date().toISOString();

    rawDb.prepare(`
      UPDATE conversations
      SET bot_paused = 1, status = 'handoff_requested', handoff_reason = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(reason, now, conversationId, ctx.tenantId);
  }

  public resumeBot(conversationId: string, resumedBy: string): void {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const now = new Date().toISOString();

    rawDb.prepare(`
      UPDATE conversations
      SET bot_paused = 0, status = 'active_bot', handoff_reason = NULL, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(now, conversationId, ctx.tenantId);
  }

  public assignConversation(conversationId: string, assignedTo: string, assignedTeam?: string): Conversation {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const now = new Date().toISOString();

    rawDb.prepare(`
      UPDATE conversations
      SET assigned_to = ?, assigned_team = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(assignedTo, assignedTeam || null, now, conversationId, ctx.tenantId);

    const conv = this.getConversation(conversationId);
    if (!conv) throw new Error(`Conversation '${conversationId}' not found`);
    return conv;
  }

  public updateConversationStatus(conversationId: string, status: Conversation['status']): Conversation {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const now = new Date().toISOString();

    rawDb.prepare(`
      UPDATE conversations
      SET status = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(status, now, conversationId, ctx.tenantId);

    const conv = this.getConversation(conversationId);
    if (!conv) throw new Error(`Conversation '${conversationId}' not found`);
    return conv;
  }

  public setConversationTags(conversationId: string, tags: string[]): Conversation {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const now = new Date().toISOString();

    rawDb.prepare(`
      UPDATE conversations
      SET tags_json = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(JSON.stringify(tags), now, conversationId, ctx.tenantId);

    const conv = this.getConversation(conversationId);
    if (!conv) throw new Error(`Conversation '${conversationId}' not found`);
    return conv;
  }

  public addInternalNote(params: {
    conversationId: string;
    authorId: string;
    authorName: string;
    content: string;
  }): ConversationNote {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO conversation_notes (
        id, tenant_id, conversation_id, author_id, author_name, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ctx.tenantId,
      params.conversationId,
      params.authorId,
      params.authorName,
      params.content,
      now
    );

    rawDb.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ? AND tenant_id = ?
    `).run(now, params.conversationId, ctx.tenantId);

    return {
      id,
      tenantId: ctx.tenantId,
      conversationId: params.conversationId,
      authorId: params.authorId,
      authorName: params.authorName,
      content: params.content,
      createdAt: now,
    };
  }

  public getInternalNotes(conversationId: string): ConversationNote[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const rows = rawDb.prepare(`
      SELECT * FROM conversation_notes
      WHERE tenant_id = ? AND conversation_id = ?
      ORDER BY created_at ASC
    `).all(ctx.tenantId, conversationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      conversationId: r.conversation_id,
      authorId: r.author_id,
      authorName: r.author_name,
      content: r.content,
      createdAt: r.created_at,
    }));
  }

  public acquireConversationLock(
    conversationId: string,
    agentId: string,
    timeoutMinutes: number = 5
  ): { acquired: boolean; lockedBy?: string; message: string } {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const conv = this.getConversation(conversationId);
    if (!conv) {
      return { acquired: false, message: 'Conversation not found' };
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (conv.lockedBy && conv.lockedBy !== agentId && conv.lockedAt) {
      const lockedTime = new Date(conv.lockedAt).getTime();
      const expiryTime = lockedTime + timeoutMinutes * 60 * 1000;
      if (now.getTime() < expiryTime) {
        return {
          acquired: false,
          lockedBy: conv.lockedBy,
          message: `Conversation is currently locked by '${conv.lockedBy}'. Collision guard active until ${new Date(expiryTime).toLocaleTimeString()}.`,
        };
      }
    }

    rawDb.prepare(`
      UPDATE conversations
      SET locked_by = ?, locked_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(agentId, nowIso, nowIso, conversationId, ctx.tenantId);

    return {
      acquired: true,
      lockedBy: agentId,
      message: 'Lock successfully acquired',
    };
  }

  public releaseConversationLock(conversationId: string, agentId: string): { released: boolean } {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const conv = this.getConversation(conversationId);
    if (!conv) return { released: false };

    if (conv.lockedBy === agentId || !conv.lockedBy) {
      rawDb.prepare(`
        UPDATE conversations
        SET locked_by = NULL, locked_at = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(new Date().toISOString(), conversationId, ctx.tenantId);
      return { released: true };
    }

    return { released: false };
  }

  public sendHumanReply(params: {
    conversationId: string;
    agentId: string;
    agentName: string;
    content: string;
  }): Message {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const now = new Date().toISOString();

    const msg = this.addMessage({
      conversationId: params.conversationId,
      senderType: 'agent_human',
      content: params.content,
    });

    rawDb.prepare(`
      UPDATE conversations
      SET status = 'human_in_progress', bot_paused = 1, assigned_to = COALESCE(assigned_to, ?), updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(params.agentName || params.agentId, now, params.conversationId, ctx.tenantId);

    return msg;
  }

  // --- Leads ---

  public createLead(params: {
    contactId: string;
    conversationId: string;
    source: string;
    interestZone?: string;
    budgetMin?: number;
    budgetMax?: number;
    purpose?: string;
    phone?: string;
    notes?: string;
  }): Lead {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO leads (
        id, tenant_id, contact_id, conversation_id, source, interest_zone, budget_min, budget_max, purpose, phone, status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
    `).run(
      id,
      ctx.tenantId,
      params.contactId,
      params.conversationId,
      params.source,
      params.interestZone || null,
      params.budgetMin || null,
      params.budgetMax || null,
      params.purpose || null,
      params.phone || null,
      params.notes || null,
      now
    );

    // Enrich contact phone if not already set
    if (params.phone) {
      rawDb.prepare(`
        UPDATE contacts SET phone = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND (phone IS NULL OR phone = '')
      `).run(params.phone, now, params.contactId, ctx.tenantId);
    }

    return {
      id,
      tenantId: ctx.tenantId,
      contactId: params.contactId,
      conversationId: params.conversationId,
      source: params.source,
      interestZone: params.interestZone,
      budgetMin: params.budgetMin,
      budgetMax: params.budgetMax,
      purpose: params.purpose,
      phone: params.phone,
      status: 'new',
      notes: params.notes,
      createdAt: now,
    };
  }

  public listLeads(): Lead[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const rows = rawDb.prepare(`
      SELECT * FROM leads WHERE tenant_id = ? ORDER BY created_at DESC
    `).all(ctx.tenantId) as any[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      contactId: r.contact_id,
      conversationId: r.conversation_id,
      source: r.source,
      interestZone: r.interest_zone,
      budgetMin: r.budget_min,
      budgetMax: r.budget_max,
      purpose: r.purpose,
      phone: r.phone,
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at,
    }));
  }
}
