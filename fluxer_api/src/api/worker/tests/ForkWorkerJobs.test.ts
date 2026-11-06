// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the fork's worker jobs, the signal bar's sweep and the Use External Commands backfill, run
// only if all three of upstream's files carry their line: the cron in WorkerMain.ts, the handler in
// WorkerTaskRegistry.ts and the lane in WorkerLaneConfig.ts. A job missing from one of them never
// runs, and nothing else says so.

import {createGuildID} from '@app/api/BrandedTypes';
import {getConfig} from '@app/api/Config';
import {setupTestGuildWithMembers} from '@app/api/channel/tests/ChannelTestUtils';
import type {APIConfig} from '@app/api/config/APIConfig';
import {updateRole} from '@app/api/guild/tests/GuildTestUtils';
import type {JobLedgerRepository} from '@app/api/jobs/JobLedgerRepository';
import {getSnowflakeService, getWorkerService} from '@app/api/middleware/ServiceRegistry';
import {getGuildRepository} from '@app/api/middleware/ServiceSingletons';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createTestWorkerHelpers} from '@app/api/test/SyncTaskWorkerService';
import {CronScheduler} from '@app/api/worker/CronScheduler';
import {type JetStreamWorkerQueue, JOBS_STREAM_MAX_AGE_MS} from '@app/api/worker/JetStreamWorkerQueue';
import backfillUseExternalCommandsTask from '@app/api/worker/tasks/BackfillUseExternalCommands';
import sweepSignalBar from '@app/api/worker/tasks/SweepSignalBar';
import {clearWorkerDependencies, setWorkerDependencies} from '@app/api/worker/WorkerContext';
import {initializeWorkerDependencies} from '@app/api/worker/WorkerDependencies';
import {findLaneForTask, validateLaneCompleteness} from '@app/api/worker/WorkerLaneConfig';
import {startWorkerRuntime} from '@app/api/worker/WorkerMain';
import type {WorkerService} from '@app/api/worker/WorkerService';
import {workerTasks} from '@app/api/worker/WorkerTaskRegistry';
import {DEFAULT_PERMISSIONS, Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {JetStreamConnectionManager} from '@pkgs/nats/src/JetStreamConnectionManager';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

// The sweep keeps lit signals alive (their entries expire after 10 minutes), so it runs every minute.
const FORK_JOBS = [
	{task: 'sweepSignalBar', handler: sweepSignalBar, schedule: '30 * * * * *'},
	{task: 'backfillUseExternalCommands', handler: backfillUseExternalCommandsTask, schedule: '15 */10 * * * *'},
] as const;

describe('the fork worker jobs', () => {
	let harness: ApiTestHarness;
	let previousWorkerConfig: APIConfig['worker'];

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		previousWorkerConfig = getConfig().worker;
		setWorkerDependencies(await initializeWorkerDependencies(getSnowflakeService()));
	});

	afterEach(() => {
		clearWorkerDependencies();
		getConfig().worker = previousWorkerConfig;
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	it('registers each job with its handler, in the batch lane', () => {
		for (const {task, handler} of FORK_JOBS) {
			expect(workerTasks[task]).toBe(handler);
			expect(findLaneForTask(task)).toBe('batch');
		}
		expect(() => validateLaneCompleteness(workerTasks)).not.toThrow();
	});

	it('schedules each job in the worker cron', async () => {
		const upsert = vi.spyOn(CronScheduler.prototype, 'upsert');
		// The batch lane alone, with the cron scheduler off, so that the account action consumer
		// and the cron's timer do not start. The runtime stops at its runner, which would read
		// jobs from JetStream; the cron jobs are registered before that.
		getConfig().worker = {...previousWorkerConfig, mode: 'single_lane', laneName: 'batch', enableCronScheduler: false};
		const noJetStream = new Error('no JetStream in this test');
		const queue = {
			ensureInfrastructure: async () => {},
			getJobsStreamMaxAgeMs: () => JOBS_STREAM_MAX_AGE_MS,
			getStreamName: () => 'jobs',
			getConnectionManager: () => {
				throw noJetStream;
			},
		} as unknown as JetStreamWorkerQueue;

		await expect(
			startWorkerRuntime({
				jsConnectionManager: {} as JetStreamConnectionManager,
				queue,
				workerService: getWorkerService() as unknown as WorkerService,
				jobLedger: {} as JobLedgerRepository,
				dependencies: await initializeWorkerDependencies(getSnowflakeService()),
				cores: 1,
			}),
		).rejects.toBe(noJetStream);

		for (const {task, schedule} of FORK_JOBS) {
			expect(upsert).toHaveBeenCalledWith(task, task, {}, schedule, {ledger: false});
		}
	});

	it('runs the backfill task once: @everyone gets Use External Commands, and keeps what it has after', async () => {
		const {owner, guild} = await setupTestGuildWithMembers(harness, 0);
		const without = (DEFAULT_PERMISSIONS & ~Permissions.USE_EXTERNAL_COMMANDS).toString();
		await updateRole(harness, owner.token, guild.id, guild.id, {permissions: without});
		const everyonePermissions = async () => {
			const roles = await getGuildRepository().listRoles(createGuildID(BigInt(guild.id)));
			return roles.find((role) => role.id.toString() === guild.id)!.permissions;
		};
		const helpers = createTestWorkerHelpers();
		const info = vi.spyOn(helpers.logger, 'info');

		await workerTasks.backfillUseExternalCommands({}, helpers);
		expect(info).toHaveBeenCalledWith({updated: 1}, expect.any(String));
		expect((await everyonePermissions()) & Permissions.USE_EXTERNAL_COMMANDS).toBe(Permissions.USE_EXTERNAL_COMMANDS);

		await updateRole(harness, owner.token, guild.id, guild.id, {permissions: without});
		info.mockClear();
		await workerTasks.backfillUseExternalCommands({}, helpers);
		expect(info).not.toHaveBeenCalled();
		expect((await everyonePermissions()) & Permissions.USE_EXTERNAL_COMMANDS).toBe(0n);
	});

	// The sweep with signals to clear is in signal_bar/tests/SignalBar.test.ts.
	it('runs the sweep task with the worker dependencies, clearing nothing when nothing is lit', async () => {
		const helpers = createTestWorkerHelpers();
		const debug = vi.spyOn(helpers.logger, 'debug');

		await workerTasks.sweepSignalBar({}, helpers);
		expect(debug).not.toHaveBeenCalled();
	});
});
