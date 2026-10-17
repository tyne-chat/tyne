// SPDX-License-Identifier: AGPL-3.0-or-later

import {withForkMessages} from '@app/app/ForkI18n';
import {messages as forkMessagesEnUS} from '@app/features/i18n/fork_locales/en-US/messages.mjs';
import {AllLocales} from '@fluxer/constants/src/Locales';
import {describe, expect, it} from 'vitest';

const upstreamOnly = (messages: Record<string, string>) => async () => ({messages});

describe('fork catalogues layered over upstream', () => {
	// A locale upstream adds without a fork catalogue would make switching to it throw.
	it.each(AllLocales)('has a fork catalogue for %s', async (locale) => {
		const {messages} = await withForkMessages(locale, upstreamOnly({'upstream-only': 'kept'}))();

		expect(messages['upstream-only']).toBe('kept');
		expect(Object.keys(messages).length).toBeGreaterThan(1);
	});

	it('takes the fork string where both catalogues have the same id', async () => {
		const ids = Object.keys(forkMessagesEnUS);
		expect(ids.length).toBeGreaterThan(0);
		const id = ids[0] as string;

		const {messages} = await withForkMessages('en-US', upstreamOnly({[id]: 'upstream'}))();

		expect(messages[id]).toEqual(forkMessagesEnUS[id]);
	});
});
