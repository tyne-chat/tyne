// SPDX-License-Identifier: AGPL-3.0-or-later

import {backfillUseExternalCommands} from '@app/api/guild_command/UseExternalCommandsBackfill';
import {getWorkerDependencies} from '@app/api/worker/WorkerContext';
import type {WorkerTaskHandler} from '@pkgs/worker/src/contracts/WorkerTask';

// Fork: turns on Use External Commands for existing @everyone roles once; a no-op after that.
const backfillUseExternalCommandsTask: WorkerTaskHandler = async (_payload, helpers) => {
	const deps = getWorkerDependencies();
	const result = await backfillUseExternalCommands({
		guildRepository: deps.guildRepository,
		gatewayService: deps.gatewayService,
		instanceConfigRepository: deps.instanceConfigRepository,
	});
	if (result.ran) {
		helpers.logger.info({updated: result.updated}, 'Backfilled Use External Commands');
	}
};

export default backfillUseExternalCommandsTask;
