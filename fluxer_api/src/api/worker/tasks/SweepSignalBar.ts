// SPDX-License-Identifier: AGPL-3.0-or-later

import {SignalBarService} from '@app/api/signal_bar/SignalBarService';
import {SignalBarSettingsRepository} from '@app/api/signal_bar/SignalBarSettingsRepository';
import {getWorkerDependencies} from '@app/api/worker/WorkerContext';
import type {WorkerTaskHandler} from '@pkgs/worker/src/contracts/WorkerTask';

const sweepSignalBar: WorkerTaskHandler = async (_payload, helpers) => {
	const deps = getWorkerDependencies();
	const service = new SignalBarService({
		instanceConfigRepository: deps.instanceConfigRepository,
		cacheService: deps.cacheService,
		gatewayService: deps.gatewayService,
		guildRepository: deps.guildRepository,
		personaRepository: deps.personaRepository,
		findUser: (userId) => deps.userRepository.findUnique(userId),
		findChannel: (channelId) => deps.channelRepository.findUnique(channelId),
		settingsRepository: new SignalBarSettingsRepository(),
		listGuildChannels: (guildId) => deps.channelRepository.listGuildChannels(guildId),
	});
	const {cleared} = await service.sweep();
	if (cleared > 0) {
		helpers.logger.debug({cleared}, 'Cleared signals for offline users');
	}
};

export default sweepSignalBar;
