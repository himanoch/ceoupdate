import { test, describe } from 'node:test';
import assert from 'node:assert';

import { DatabaseManager, runWithTenantContext } from '../packages/core/src/index.js';
import { PersistentJobQueue, FollowUpScheduler } from '../packages/core/src/job-queue.js';

describe('Distributed Job Queue & Follow-up Scheduler', () => {
  test('retries transient failures and moves final failure into the DLQ', async () => {
    const db = new DatabaseManager(':memory:');
    const queue = new PersistentJobQueue(db);

    db.getRawDb().prepare(`
      INSERT OR IGNORE INTO tenants (id, name, status, settings_json, created_at)
      VALUES ('the-hill-land', 'The Hill Land Co., Ltd.', 'active', '{"timezone":"Asia/Bangkok"}', ?)
    `).run(new Date().toISOString());

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'system', actorId: 'queue_runner', correlationId: 'queue_1' },
      async () => {
        const job = queue.enqueue({
          type: 'lead_recovery',
          jobKey: 'lead_001_recovery',
          payload: { leadId: 'lead_001', message: 'Follow up after 2h' },
          maxRetries: 2,
        });

        assert.strictEqual(job.status, 'queued');

        const first = await queue.processNext(async () => {
          throw new Error('transient retry');
        });
        assert.strictEqual(first.status, 'queued');
        assert.strictEqual(first.attempts, 1);

        const second = await queue.processNext(async () => {
          throw new Error('still failing');
        });
        assert.strictEqual(second.status, 'dead_letter');
        assert.strictEqual(second.attempts, 2);
      }
    );
  });

  test('schedules and executes pending follow-up tasks within the tenant scope', async () => {
    const db = new DatabaseManager(':memory:');
    const scheduler = new FollowUpScheduler(db);

    db.getRawDb().prepare(`
      INSERT OR IGNORE INTO tenants (id, name, status, settings_json, created_at)
      VALUES ('the-hill-land', 'The Hill Land Co., Ltd.', 'active', '{"timezone":"Asia/Bangkok"}', ?)
    `).run(new Date().toISOString());

    await runWithTenantContext(
      { tenantId: 'the-hill-land', actorType: 'admin', actorId: 'ops_alice', correlationId: 'followup_1' },
      async () => {
        const queued = scheduler.scheduleLeadRecovery({
          leadId: 'lead_b2b_77',
          channelType: 'line',
          delayHours: 2,
          message: 'สวัสดีค่ะ ผมอยากติดตามข้อมูลต่อจากการสนทนาก่อนหน้านี้',
        });

        assert.strictEqual(queued.jobType, 'lead_recovery');
        assert.strictEqual(queued.status, 'queued');

        const runResult = await scheduler.runDueJobs(async (job: any) => {
          return { processedLeadId: job.payload.leadId, sent: true };
        });

        assert.strictEqual(runResult.length, 1);
        assert.strictEqual(runResult[0].status, 'succeeded');
        assert.strictEqual((runResult[0].result as any).processedLeadId, 'lead_b2b_77');
      }
    );
  });
});
