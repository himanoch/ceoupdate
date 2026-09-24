/**
 * Core Repository Interfaces (Data Access Contracts)
 * Decouples business domain logic from SQLite / PostgreSQL database backends
 */

export interface TenantEntity {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  settingsJson: string;
  createdAt: string;
}

export interface ITenantRepository {
  findById(tenantId: string): Promise<TenantEntity | null>;
  create(tenant: Omit<TenantEntity, 'createdAt'>): Promise<TenantEntity>;
  updateStatus(tenantId: string, status: 'active' | 'suspended'): Promise<void>;
  listAll(): Promise<TenantEntity[]>;
}

export interface ContactEntity {
  id: string;
  tenantId: string;
  channelType: string;
  channelUserId: string;
  displayName: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IContactRepository {
  findByChannelUser(channelType: string, channelUserId: string): Promise<ContactEntity | null>;
  create(contact: Omit<ContactEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContactEntity>;
  updatePhone(id: string, phone: string): Promise<void>;
}

export interface ConversationEntity {
  id: string;
  tenantId: string;
  contactId: string;
  status: 'active_bot' | 'handoff_requested' | 'human_in_progress' | 'closed';
  botPaused: boolean;
  handoffReason?: string;
  assignedTo?: string;
  assignedTeam?: string;
  tags?: string[];
  lockedBy?: string;
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationNoteEntity {
  id: string;
  tenantId: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface IConversationRepository {
  findById(id: string): Promise<ConversationEntity | null>;
  findActiveByContact(contactId: string): Promise<ConversationEntity | null>;
  create(conversation: Omit<ConversationEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<ConversationEntity>;
  updateBotPause(id: string, paused: boolean, reason?: string, assignedTo?: string): Promise<void>;
  assign(id: string, assignedTo: string, assignedTeam?: string): Promise<void>;
  addNote(note: Omit<ConversationNoteEntity, 'id' | 'createdAt'>): Promise<ConversationNoteEntity>;
  listNotes(conversationId: string): Promise<ConversationNoteEntity[]>;
  listRecent(limit?: number): Promise<ConversationEntity[]>;
}

export interface MessageEntity {
  id: string;
  tenantId: string;
  conversationId: string;
  senderType: 'customer' | 'agent_ai' | 'agent_human' | 'system';
  content: string;
  citationsJson: string;
  createdAt: string;
}

export interface IMessageRepository {
  create(message: Omit<MessageEntity, 'id' | 'createdAt'>): Promise<MessageEntity>;
  listByConversation(conversationId: string): Promise<MessageEntity[]>;
}

export interface LeadEntity {
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

export interface ILeadRepository {
  create(lead: Omit<LeadEntity, 'id' | 'createdAt'>): Promise<LeadEntity>;
  findById(id: string): Promise<LeadEntity | null>;
  listByTenant(limit?: number): Promise<LeadEntity[]>;
}

export interface AuditEventEntity {
  id: string;
  tenantId: string;
  correlationId: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payloadJson: string;
  createdAt: string;
}

export interface IAuditRepository {
  log(event: Omit<AuditEventEntity, 'id' | 'createdAt'>): Promise<AuditEventEntity>;
  listByTenant(limit?: number): Promise<AuditEventEntity[]>;
}

export interface IIdempotencyRepository {
  get<T>(scope: string, key: string): Promise<T | null>;
  set<T>(scope: string, key: string, result: T): Promise<void>;
}
