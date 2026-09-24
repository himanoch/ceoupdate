import { DatabaseManager, getTenantContext } from '../../core/src/index.js';
import { AuditService } from '../../audit-analytics/src/index.js';

export interface KnowledgeItem {
  sourceId: string;
  title: string;
  sourceType: string;
  content: string;
  tags: string;
  effectiveDate: string;
}

export interface Citation {
  sourceId: string;
  title: string;
  snippet: string;
  effectiveDate: string;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  scope: 'read' | 'write';
  requiresApproval?: boolean;
  execute: (input: TInput, idempotencyKey?: string) => Promise<TOutput> | TOutput;
}

export interface AgentDecision {
  action: 'reply' | 'tool_call' | 'handoff';
  replyContent?: string;
  citations?: Citation[];
  toolName?: string;
  toolInput?: Record<string, any>;
  handoffReason?: string;
  urgency?: 'normal' | 'high' | 'emergency';
}

/**
 * Knowledge Base & Grounding Service
 */
export class KnowledgeBaseService {
  constructor(private db: DatabaseManager) {}

  public addSource(params: {
    title: string;
    sourceType: string;
    url?: string;
    effectiveDate: string;
    chunks: { content: string; tags?: string }[];
  }): string {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const sourceId = `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO knowledge_sources (id, tenant_id, title, source_type, url, effective_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sourceId, ctx.tenantId, params.title, params.sourceType, params.url || null, params.effectiveDate, now);

    const insertChunk = rawDb.prepare(`
      INSERT INTO knowledge_chunks (id, tenant_id, source_id, content, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const chunk of params.chunks) {
      const chunkId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      insertChunk.run(chunkId, ctx.tenantId, sourceId, chunk.content, chunk.tags || '', now);
    }

    return sourceId;
  }

  public search(query: string, limit: number = 3): KnowledgeItem[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    // Query chunks for current tenant
    const rows = rawDb.prepare(`
      SELECT c.id as chunk_id, c.content, c.tags, s.id as source_id, s.title, s.source_type, s.effective_date
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON c.source_id = s.id AND c.tenant_id = s.tenant_id
      WHERE c.tenant_id = ?
    `).all(ctx.tenantId) as any[];

    const lowerQuery = query.toLowerCase();
    const keywords = lowerQuery.split(/\s+/).filter((k) => k.length > 1);

    // Simple robust keyword-based relevance score
    const scored = rows.map((r) => {
      let score = 0;
      const text = (r.content + ' ' + r.tags + ' ' + r.title).toLowerCase();
      for (const kw of keywords) {
        if (text.includes(kw)) score += 2;
      }
      if (text.includes(lowerQuery)) score += 5;
      return { item: r, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => ({
        sourceId: s.item.source_id,
        title: s.item.title,
        sourceType: s.item.source_type,
        content: s.item.content,
        tags: s.item.tags,
        effectiveDate: s.item.effective_date,
      }));
  }
}

/**
 * Tool Registry with Typed Execution and Idempotency
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor(private audit: AuditService) {}

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public async execute(name: string, input: any, idempotencyKey?: string): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found in registry`);
    }

    if (tool.scope === 'write' && !idempotencyKey) {
      throw new Error(`Write tool '${name}' requires an idempotencyKey`);
    }

    const result = await tool.execute(input, idempotencyKey);

    // Record audit event
    this.audit.logAudit({
      action: `tool.execute:${name}`,
      resourceType: 'tool',
      resourceId: name,
      payload: { input, result, idempotencyKey },
    });

    return result;
  }
}

/**
 * Policy Engine
 */
export class PolicyEngine {
  public static evaluateMessage(text: string): {
    isEmergency: boolean;
    isHumanRequest: boolean;
    isDisallowedAdvice: boolean;
    reason?: string;
  } {
    const lower = text.toLowerCase();

    // 1. Emergency detection (System Policy: High priority safety)
    const emergencyKeywords = ['ไฟไหม้', 'น้ำท่วมฉับพลัน', 'ไฟฟ้าลัดวงจร', 'สายไฟขาด', 'ท่อเมนแตก', 'คนเจ็บ', 'อันตราย'];
    for (const kw of emergencyKeywords) {
      if (lower.includes(kw)) {
        return {
          isEmergency: true,
          isHumanRequest: true,
          isDisallowedAdvice: false,
          reason: `Emergency detected keyword '${kw}'`,
        };
      }
    }

    // 2. Direct Human Request
    const humanKeywords = ['คุยกับคน', 'คุยกับแอดมิน', 'ติดต่อเจ้าหน้าที่', 'ขอคุยกับมนุษย์', 'โทรหาเซลส์', 'ต้องการคุยกับคน'];
    for (const kw of humanKeywords) {
      if (lower.includes(kw)) {
        return {
          isEmergency: false,
          isHumanRequest: true,
          isDisallowedAdvice: false,
          reason: `User requested human agent via '${kw}'`,
        };
      }
    }

    // 3. Disallowed Advice (Legal, Loan Guarantee, Investment ROI)
    const disallowedKeywords = ['การันตีผลตอบแทน', 'รับรองกำไร', 'กู้ผ่าน 100%', 'ตีความสัญญาข้อกฎหมาย'];
    for (const kw of disallowedKeywords) {
      if (lower.includes(kw)) {
        return {
          isEmergency: false,
          isHumanRequest: true,
          isDisallowedAdvice: true,
          reason: `Disallowed advice category: '${kw}'`,
        };
      }
    }

    return {
      isEmergency: false,
      isHumanRequest: false,
      isDisallowedAdvice: false,
    };
  }
}

export * from './ingestion.js';
export * from './prompt-service.js';

