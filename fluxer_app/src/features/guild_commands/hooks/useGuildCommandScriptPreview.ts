// SPDX-License-Identifier: AGPL-3.0-or-later

import {ForkEndpoints} from '@app/features/app/constants/ForkEndpoints';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import type {GuildCommandPreviewResponse} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {useCallback, useEffect, useRef, useState} from 'react';

// Fork: a script's preview, filled in by the server (docs/design/server-commands.md, "Network calls").
// At most one request per 500 ms of typing; a failed one waits for the next edit.

const logger = new Logger('GuildCommandPreview');
const TYPING_DELAY_MS = 500;
const NOTHING: GuildCommandPreviewResponse = {content: null, issue: null};

export function useGuildCommandScriptPreview(params: {
	guildId: string;
	channelId: string | null;
	template: string;
	input: string;
	/** The names of the counters being edited, so a script can read them before they are saved. */
	counterNames?: ReadonlyArray<string>;
	enabled: boolean;
}): {result: GuildCommandPreviewResponse; runAgain: () => void} {
	const {guildId, channelId, template, input, enabled} = params;
	const counterNames = (params.counterNames ?? []).filter((name) => name !== '').join(' ');
	const [result, setResult] = useState(NOTHING);
	const [attempt, setAttempt] = useState(0);
	const latest = useRef(0);
	const immediately = useRef(false);
	/** Which run the preview stands for: Run again adds one, and any edit starts over. */
	const run = useRef(1);

	// `attempt` is here to ask for the same preview again.
	useEffect(() => {
		latest.current += 1;
		const request = latest.current;
		if (!enabled || template.trim() === '') {
			setResult(NOTHING);
			return;
		}
		const delay = immediately.current ? 0 : TYPING_DELAY_MS;
		run.current = immediately.current ? run.current + 1 : 1;
		immediately.current = false;
		const previewedRun = run.current;
		const timer = setTimeout(async () => {
			try {
				const res = await http.post<GuildCommandPreviewResponse>(ForkEndpoints.GUILD_COMMANDS_PREVIEW(guildId), {
					body: {
						template,
						input: input === '' ? null : input,
						channel_id: channelId,
						...(counterNames === ''
							? {}
							: {counters: counterNames.split(' ').map((name) => ({name, per: []})), run: previewedRun}),
					},
				});
				if (request === latest.current && res.ok && res.body) setResult(res.body);
			} catch (error) {
				logger.warn('Failed to preview a command', error);
			}
		}, delay);
		return () => clearTimeout(timer);
	}, [guildId, channelId, template, input, counterNames, enabled, attempt]);

	const runAgain = useCallback(() => {
		immediately.current = true;
		setAttempt((value) => value + 1);
	}, []);

	return {result, runAgain};
}
