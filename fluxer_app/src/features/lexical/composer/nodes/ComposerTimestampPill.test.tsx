// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {TimeFormatTypes, TimestampFormatTypes} from '@fluxer/constants/src/UserConstants';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const settings = vi.hoisted(() => ({value: null as null | {timeFormat: number; timestampFormat: number}}));

vi.mock('@app/features/user/state/UserSettings', async () => {
	const {observable} = await import('mobx');
	const {TimeFormatTypes: timeFormats, TimestampFormatTypes: timestampFormats} = await import(
		'@fluxer/constants/src/UserConstants'
	);
	settings.value = observable({timeFormat: timeFormats.TWELVE_HOUR, timestampFormat: timestampFormats.AUTO});
	return {default: settings.value};
});
vi.mock('@app/features/user/utils/LocaleUtils', () => ({
	getCurrentLocale: () => 'en-US',
	getFormattingLocale: () => 'en-US',
}));
vi.mock('@app/features/channel/components/modals/TimestampModal', () => ({openTimestampModal: vi.fn()}));
vi.mock('@app/features/lexical/composer/nodes/ComposerTimestampContextMenu', () => ({
	ComposerTimestampContextMenu: () => null,
}));
vi.mock('@app/features/ui/commands/ContextMenuCommands', () => ({openFromEvent: vi.fn()}));
vi.mock('@app/features/ui/tooltip/Tooltip', () => ({
	Tooltip: ({children}: {children?: React.ReactNode}) => children,
}));
vi.mock('@lexical/react/LexicalComposerContext', () => ({
	useLexicalComposerContext: () => [{update: vi.fn()}],
}));
vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
// One i18n object, as in the app: a new one at each render would hide a stale memo.
const lingui = vi.hoisted(() => ({
	i18n: {
		_: (descriptor: {message?: string}) => descriptor?.message ?? '',
		locale: 'en-US',
	},
}));
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children,
	useLingui: () => lingui,
}));

const {runInAction} = await import('mobx');
const {ComposerTimestampPill} = await import('@app/features/lexical/composer/nodes/ComposerTimestampPill');

describe('ComposerTimestampPill (tyne-chat/tyne#856)', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		runInAction(() => {
			settings.value!.timeFormat = TimeFormatTypes.TWELVE_HOUR;
			settings.value!.timestampFormat = TimestampFormatTypes.AUTO;
		});
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	it('follows a change of the time format setting while it sits in the composer', () => {
		act(() => {
			root.render(
				<ComposerTimestampPill
					nodeKey="1"
					epoch={1700000000}
					format="shortTime"
					wire="<t:1700000000:t>"
					data-flx="lexical.composer.nodes.composer-timestamp-pill-test.pill"
				/>,
			);
		});
		const twelveHour = container.textContent ?? '';
		expect(twelveHour).toMatch(/AM|PM/);

		act(() => {
			runInAction(() => {
				settings.value!.timeFormat = TimeFormatTypes.TWENTY_FOUR_HOUR;
			});
		});
		const twentyFourHour = container.textContent ?? '';
		expect(twentyFourHour).not.toMatch(/AM|PM/);
		expect(twentyFourHour).not.toBe(twelveHour);
	});
});
