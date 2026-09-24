import { DatabaseManager, getTenantContext } from '../../core/src/index.js';

export interface AgentPrompt {
  id: string;
  tenantId: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  personaName: string;
  systemPrompt: string;
  businessRules: string[];
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
}

export class AgentPromptService {
  constructor(private db: DatabaseManager) {}

  /**
   * Create a new draft prompt version
   */
  public createDraft(params: {
    personaName: string;
    systemPrompt: string;
    businessRules?: string[];
    authorId: string;
  }): AgentPrompt {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    // Determine next version number for this tenant
    const maxVerRow = rawDb.prepare(`
      SELECT MAX(version) as max_v FROM agent_prompts WHERE tenant_id = ?
    `).get(ctx.tenantId) as { max_v: number | null };

    const nextVersion = (maxVerRow?.max_v || 0) + 1;
    const id = `prm_${Date.now()}_v${nextVersion}`;
    const now = new Date().toISOString();
    const rules = params.businessRules || [];

    rawDb.prepare(`
      INSERT INTO agent_prompts (
        id, tenant_id, version, status, persona_name, system_prompt, business_rules_json, created_by, created_at
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)
    `).run(
      id,
      ctx.tenantId,
      nextVersion,
      params.personaName,
      params.systemPrompt,
      JSON.stringify(rules),
      params.authorId,
      now
    );

    return {
      id,
      tenantId: ctx.tenantId,
      version: nextVersion,
      status: 'draft',
      personaName: params.personaName,
      systemPrompt: params.systemPrompt,
      businessRules: rules,
      createdBy: params.authorId,
      createdAt: now,
    };
  }

  /**
   * Publish a specific prompt version (archives previously published versions)
   */
  public publishVersion(version: number): AgentPrompt {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const now = new Date().toISOString();

    const target = rawDb.prepare(`
      SELECT * FROM agent_prompts WHERE tenant_id = ? AND version = ?
    `).get(ctx.tenantId, version) as any;

    if (!target) {
      throw new Error(`Prompt version ${version} not found for tenant '${ctx.tenantId}'`);
    }

    // Archive any currently published prompt
    rawDb.prepare(`
      UPDATE agent_prompts
      SET status = 'archived'
      WHERE tenant_id = ? AND status = 'published'
    `).run(ctx.tenantId);

    // Set target version to published
    rawDb.prepare(`
      UPDATE agent_prompts
      SET status = 'published', published_at = ?
      WHERE tenant_id = ? AND version = ?
    `).run(now, ctx.tenantId, version);

    return {
      id: target.id,
      tenantId: ctx.tenantId,
      version,
      status: 'published',
      personaName: target.persona_name,
      systemPrompt: target.system_prompt,
      businessRules: JSON.parse(target.business_rules_json || '[]'),
      createdBy: target.created_by,
      createdAt: target.created_at,
      publishedAt: now,
    };
  }

  /**
   * Rollback to a previous prompt version by publishing it
   */
  public rollbackToVersion(targetVersion: number): AgentPrompt {
    return this.publishVersion(targetVersion);
  }

  /**
   * Get the active published prompt for the current tenant
   */
  public getActivePrompt(): AgentPrompt | null {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const row = rawDb.prepare(`
      SELECT * FROM agent_prompts
      WHERE tenant_id = ? AND status = 'published'
      ORDER BY version DESC LIMIT 1
    `).get(ctx.tenantId) as any;

    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      version: row.version,
      status: 'published',
      personaName: row.persona_name,
      systemPrompt: row.system_prompt,
      businessRules: JSON.parse(row.business_rules_json || '[]'),
      createdBy: row.created_by,
      createdAt: row.created_at,
      publishedAt: row.published_at,
    };
  }

  /**
   * List all prompt versions for the current tenant
   */
  public listVersions(): AgentPrompt[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const rows = rawDb.prepare(`
      SELECT * FROM agent_prompts
      WHERE tenant_id = ?
      ORDER BY version DESC
    `).all(ctx.tenantId) as any[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      version: r.version,
      status: r.status,
      personaName: r.persona_name,
      systemPrompt: r.system_prompt,
      businessRules: JSON.parse(r.business_rules_json || '[]'),
      createdBy: r.created_by,
      createdAt: r.created_at,
      publishedAt: r.published_at,
    }));
  }
}
