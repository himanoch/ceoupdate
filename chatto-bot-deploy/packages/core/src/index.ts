import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { MigrationRunner, MigrationRecord } from './migrations/runner.js';
export * from './migrations/runner.js';
export * from './repository.js';
export * from './auth.js';
export * from './job-queue.js';

/**
 * Tenant & Execution Context
 */
export type ActorType = 'customer' | 'agent_ai' | 'agent_human' | 'admin' | 'system';

export interface TenantContext {
  tenantId: string;
  actorType: ActorType;
  actorId: string;
  correlationId: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export class TenantContextMissingError extends Error {
  constructor(operation: string) {
    super(`TenantContext is required to execute '${operation}'. Cross-tenant boundary violation prevented.`);
    this.name = 'TenantContextMissingError';
  }
}

export class CrossTenantAccessError extends Error {
  constructor(requestedTenant: string, activeTenant: string) {
    super(`Access denied: Tenant '${activeTenant}' attempted to access resources of tenant '${requestedTenant}'.`);
    this.name = 'CrossTenantAccessError';
  }
}

export function runWithTenantContext<T>(context: TenantContext, fn: () => T | Promise<T>): Promise<T> {
  return tenantStorage.run(context, async () => await fn());
}

export function getTenantContext(): TenantContext {
  const context = tenantStorage.getStore();
  if (!context || !context.tenantId) {
    throw new TenantContextMissingError('Current Execution Scope');
  }
  return context;
}

export function tryGetTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/**
 * Database Manager with Row-Level Tenant Boundary Enforcement
 */
export class DatabaseManager {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || process.env.DATABASE_PATH || ':memory:';
    this.db = new DatabaseSync(this.dbPath);
    this.runMigrations();
  }

  public getRawDb(): DatabaseSync {
    return this.db;
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public runMigrations(): MigrationRecord[] {
    return MigrationRunner.runAll(this.db);
  }
}

/**
 * Idempotency Store
 */
export class IdempotencyStore {
  constructor(private db: DatabaseManager) {}

  public checkOrSet<T>(
    scope: string,
    key: string,
    action: () => T | Promise<T>
  ): { executed: boolean; result: T } {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    // Check existing
    const existing = rawDb.prepare(
      'SELECT response_json FROM idempotency_records WHERE tenant_id = ? AND scope = ? AND idempotency_key = ?'
    ).get(ctx.tenantId, scope, key) as { response_json: string } | undefined;

    if (existing) {
      return {
        executed: false,
        result: JSON.parse(existing.response_json) as T,
      };
    }

    // Execute action
    const result = typeof (action as any)().then === 'function'
      ? (action as any)() // handled externally or sync
      : action();

    // If promise, awaiter handled in caller or if sync:
    return {
      executed: true,
      result: result as T,
    };
  }

  public saveResult<T>(scope: string, key: string, result: T): void {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const id = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO idempotency_records (id, tenant_id, scope, idempotency_key, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, ctx.tenantId, scope, key, JSON.stringify(result), now);
  }

  public getExisting<T>(scope: string, key: string): T | null {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const existing = rawDb.prepare(
      'SELECT response_json FROM idempotency_records WHERE tenant_id = ? AND scope = ? AND idempotency_key = ?'
    ).get(ctx.tenantId, scope, key) as { response_json: string } | undefined;

    if (!existing) return null;
    return JSON.parse(existing.response_json) as T;
  }
}
