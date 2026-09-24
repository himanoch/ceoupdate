import { DatabaseManager, getTenantContext } from '../../core/src/index.js';

export interface AuditRecord {
  id: string;
  tenantId: string;
  correlationId: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payload: Record<string, any>;
  createdAt: string;
}

export class AuditService {
  constructor(private db: DatabaseManager) {}

  public logAudit(params: {
    action: string;
    resourceType: string;
    resourceId: string;
    payload?: Record<string, any>;
  }): AuditRecord {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const payload = params.payload || {};

    rawDb.prepare(`
      INSERT INTO audit_events (
        id, tenant_id, correlation_id, actor_type, actor_id, action, resource_type, resource_id, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ctx.tenantId,
      ctx.correlationId,
      ctx.actorType,
      ctx.actorId,
      params.action,
      params.resourceType,
      params.resourceId,
      JSON.stringify(payload),
      now
    );

    return {
      id,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      payload,
      createdAt: now,
    };
  }

  public getTenantAuditLogs(limit: number = 50): AuditRecord[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const rows = rawDb.prepare(`
      SELECT * FROM audit_events
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(ctx.tenantId, limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      correlationId: r.correlation_id,
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at,
    }));
  }
}

export class AnalyticsService {
  constructor(private db: DatabaseManager) {}

  public recordEvent(params: {
    eventName: string;
    contactId?: string;
    conversationId?: string;
    properties?: Record<string, any>;
  }): void {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO analytics_events (
        id, tenant_id, event_name, contact_id, conversation_id, properties_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ctx.tenantId,
      params.eventName,
      params.contactId || null,
      params.conversationId || null,
      JSON.stringify(params.properties || {}),
      now
    );
  }

  public getFunnelMetrics(): {
    messagesReceived: number;
    leadsCaptured: number;
    handoffsTriggered: number;
    conversionRate: number;
  } {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const counts = rawDb.prepare(`
      SELECT event_name, COUNT(*) as count
      FROM analytics_events
      WHERE tenant_id = ?
      GROUP BY event_name
    `).all(ctx.tenantId) as { event_name: string; count: number }[];

    let messages = 0;
    let leads = 0;
    let handoffs = 0;

    for (const c of counts) {
      if (c.event_name === 'funnel.message_received') messages = c.count;
      if (c.event_name === 'funnel.lead_captured') leads = c.count;
      if (c.event_name === 'funnel.handoff_triggered') handoffs = c.count;
    }

    const conversionRate = messages > 0 ? Number(((leads / messages) * 100).toFixed(1)) : 0;

    return {
      messagesReceived: messages,
      leadsCaptured: leads,
      handoffsTriggered: handoffs,
      conversionRate,
    };
  }
}
