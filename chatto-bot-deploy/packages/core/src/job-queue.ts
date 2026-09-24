import { DatabaseManager, getTenantContext } from './index.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter';

export interface JobDefinition<TPayload = Record<string, any>> {
  id: string;
  tenantId: string;
  jobType: string;
  jobKey: string;
  payload: TPayload;
  status: JobStatus;
  attempts: number;
  maxRetries: number;
  scheduledFor: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface EnqueueOptions<TPayload> {
  type: string;
  jobKey: string;
  payload: TPayload;
  maxRetries?: number;
  delayMs?: number;
  scheduledAt?: Date;
}

export class PersistentJobQueue {
  constructor(private readonly db: DatabaseManager) {
    this.ensureSchema();
  }

  public enqueue<TPayload>(options: EnqueueOptions<TPayload>): JobDefinition<TPayload> {
    const ctx = getTenantContext();
    const now = new Date().toISOString();
    const scheduledAt = options.scheduledAt ?? new Date(Date.now() + (options.delayMs ?? 0));
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.db.getRawDb().prepare(`
      INSERT INTO job_queue (
        id, tenant_id, job_type, job_key, payload_json, status, attempts, max_retries, scheduled_for, created_at, updated_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ctx.tenantId,
      options.type,
      options.jobKey,
      JSON.stringify(options.payload),
      'queued',
      0,
      options.maxRetries ?? 3,
      scheduledAt.toISOString(),
      now,
      now,
      null
    );

    return {
      id,
      tenantId: ctx.tenantId,
      jobType: options.type,
      jobKey: options.jobKey,
      payload: options.payload,
      status: 'queued',
      attempts: 0,
      maxRetries: options.maxRetries ?? 3,
      scheduledFor: scheduledAt.toISOString(),
      createdAt: now,
      updatedAt: now,
    };
  }

  public getPendingJobs(): JobDefinition[] {
    const ctx = getTenantContext();
    const rows = this.db.getRawDb().prepare(`
      SELECT * FROM job_queue
      WHERE tenant_id = ? AND status IN ('queued', 'running')
      ORDER BY scheduled_for ASC, created_at ASC
    `).all(ctx.tenantId) as any[];

    return rows.map((row) => this.toDomain(row));
  }

  public async processNext<T>(handler: (job: JobDefinition<T>) => Promise<T> | T): Promise<JobDefinition<T> & { result?: T }> {
    const ctx = getTenantContext();
    const row = this.db.getRawDb().prepare(`
      SELECT * FROM job_queue
      WHERE tenant_id = ? AND status IN ('queued', 'running')
        AND (attempts = 0 OR scheduled_for <= ?)
      ORDER BY scheduled_for ASC, created_at ASC
      LIMIT 1
    `).get(ctx.tenantId, new Date().toISOString()) as any | undefined;

    if (!row) {
      return { ...this.emptyJob(), status: 'queued', attempts: 0, maxRetries: 0, jobType: 'noop', jobKey: 'noop', result: undefined } as JobDefinition<T> & { result?: T };
    }

    const job = this.toDomain(row) as JobDefinition<T>;
    const nextAttempts = job.attempts + 1;

    this.db.getRawDb().prepare(`
      UPDATE job_queue SET status = 'running', attempts = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(nextAttempts, new Date().toISOString(), job.id, ctx.tenantId);

    try {
      const result = await handler(job);
      this.db.getRawDb().prepare(`
        UPDATE job_queue SET status = 'succeeded', result_json = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(JSON.stringify(result), new Date().toISOString(), job.id, ctx.tenantId);
      return { ...job, attempts: nextAttempts, status: 'succeeded', result } as JobDefinition<T> & { result?: T };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown queue failure';
      const finalStatus = nextAttempts >= job.maxRetries ? 'dead_letter' : 'queued';
      const scheduled = finalStatus === 'queued'
        ? new Date(Date.now()).toISOString()
        : job.scheduledFor;

      this.db.getRawDb().prepare(`
        UPDATE job_queue SET status = ?, attempts = ?, last_error = ?, scheduled_for = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(finalStatus, nextAttempts, message, scheduled, new Date().toISOString(), job.id, ctx.tenantId);

      return { ...job, attempts: nextAttempts, status: finalStatus, lastError: message } as JobDefinition<T> & { result?: T };
    }
  }

  private ensureSchema(): void {
    this.db.getRawDb().exec(`
      CREATE TABLE IF NOT EXISTS job_queue (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        job_type TEXT NOT NULL,
        job_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        scheduled_for TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT,
        UNIQUE (tenant_id, job_type, job_key),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);
  }

  private emptyJob(): JobDefinition {
    return {
      id: 'noop',
      tenantId: 'noop',
      jobType: 'noop',
      jobKey: 'noop',
      payload: {},
      status: 'queued',
      attempts: 0,
      maxRetries: 0,
      scheduledFor: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private toDomain(row: any): JobDefinition {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      jobType: row.job_type,
      jobKey: row.job_key,
      payload: row.payload_json ? JSON.parse(row.payload_json) : {},
      status: row.status,
      attempts: row.attempts,
      maxRetries: row.max_retries,
      scheduledFor: row.scheduled_for,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastError: row.last_error ?? undefined,
    };
  }
}

export interface FollowUpScheduleInput {
  leadId: string;
  channelType: string;
  delayHours: number;
  message: string;
}

export class FollowUpScheduler {
  constructor(private readonly db: DatabaseManager) {}

  public scheduleLeadRecovery(input: FollowUpScheduleInput): JobDefinition<{ leadId: string; channelType: string; message: string }> {
    const queue = new PersistentJobQueue(this.db);
    const scheduledAt = new Date(Date.now() + input.delayHours * 60 * 60 * 1000);

    return queue.enqueue({
      type: 'lead_recovery',
      jobKey: `lead_recovery:${input.leadId}`,
      payload: {
        leadId: input.leadId,
        channelType: input.channelType,
        message: input.message,
      },
      maxRetries: 3,
      scheduledAt,
    });
  }

  public async runDueJobs<T>(handler: (job: JobDefinition<T>) => Promise<T> | T): Promise<Array<{ status: JobStatus; result?: T; job: JobDefinition<T> }>> {
    const queue = new PersistentJobQueue(this.db);
    const dueJobs = queue.getPendingJobs();
    const results: Array<{ status: JobStatus; result?: T; job: JobDefinition<T> }> = [];

    for (const job of dueJobs) {
      const outcome = await queue.processNext((nextJob) => handler(nextJob as JobDefinition<T>));
      results.push({
        status: outcome.status as JobStatus,
        result: outcome.status === 'succeeded' ? (outcome as any).result : undefined,
        job: outcome as JobDefinition<T>,
      });
    }

    return results;
  }
}
