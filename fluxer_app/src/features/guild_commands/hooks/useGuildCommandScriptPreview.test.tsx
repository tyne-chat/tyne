// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('@app/features/platform/transport/RestTransport', () => ({http: {post}}));
vi.mock('@app/features/platform/utils/AppLogger', () => ({
	Logger: class {
		warn() {}
	},
}));

import {useGuildCommandScriptPreview} from '@app/features/guild_commands/hooks/useGuildCommandScriptPreview';

type Props = Parameters<typeof useGuildCommandScriptPreview>[0];

const initial: Props = {guildId: 'g', channelId: 'c', template: '{{ input }}!', input: 'hi', enabled: true};

let root: Root | null = null;
let current: ReturnType<typeof useGuildCommandScriptPreview>;

function Probe(props: Props) {
	current = useGuildCommandScriptPreview(props);
	return null;
}

async function show(props: Props) {
	await act(async () => {
		root ??= createRoot(document.createElement('div'));
		root.render(<Probe data-flx="guild-commands.use-guild-command-script-preview-test.show.probe" {...props} />);
	});
}

async function settle(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

describe('useGuildCommandScriptPreview', () => {
	beforeEach(() => {
		vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
		vi.useFakeTimers();
		post.mockReset();
		post.mockResolvedValue({ok: true, body: {content: 'hi!', issue: null}});
	});

	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('sends one request for a burst of typing, with the last text', async () => {
		await show(initial);
		for (const template of ['a{{', 'ab{{ input', 'abc{{ input }}']) {
			await show({...initial, template});
			await settle(100);
		}
		expect(post).not.toHaveBeenCalled();
		await settle(500);
		expect(post).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledWith('/guilds/g/commands/preview', {
			body: {template: 'abc{{ input }}', input: 'hi', channel_id: 'c'},
		});
		expect(current.result.content).toBe('hi!');
	});

	it('sends nothing for a basic template or an empty one', async () => {
		await show({...initial, enabled: false});
		await settle(1000);
		await show({...initial, template: '   '});
		await settle(1000);
		expect(post).not.toHaveBeenCalled();
	});

	it('does not ask again after a failure until something changes', async () => {
		post.mockRejectedValue(new Error('429'));
		await show(initial);
		await settle(600);
		expect(post).toHaveBeenCalledTimes(1);
		await show(initial);
		await settle(5000);
		expect(post).toHaveBeenCalledTimes(1);
		expect(current.result).toEqual({content: null, issue: null});
		await show({...initial, input: 'again'});
		await settle(600);
		expect(post).toHaveBeenCalledTimes(2);
	});

	it('keeps the last preview when a later request fails', async () => {
		await show(initial);
		await settle(600);
		post.mockRejectedValue(new Error('offline'));
		await show({...initial, input: 'more'});
		await settle(600);
		expect(current.result.content).toBe('hi!');
	});

	it('ignores an answer overtaken by a newer edit', async () => {
		let finish: (value: unknown) => void = () => {};
		post.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
		await show(initial);
		await settle(600);
		post.mockResolvedValue({ok: true, body: {content: 'new', issue: null}});
		await show({...initial, input: 'newer'});
		await settle(600);
		await act(async () => finish({ok: true, body: {content: 'old', issue: null}}));
		expect(current.result.content).toBe('new');
	});

	it('runs the same preview again at once when asked', async () => {
		await show(initial);
		await settle(600);
		expect(post).toHaveBeenCalledTimes(1);
		act(() => current.runAgain());
		await settle(0);
		expect(post).toHaveBeenCalledTimes(2);
	});

	it('counts up with each Run again, and starts over on an edit', async () => {
		const withCounter = {...initial, counterNames: ['hugs']};
		const runs = () => post.mock.calls.map((call) => (call[1] as {body: {run?: number}}).body.run);
		await show(withCounter);
		await settle(600);
		act(() => current.runAgain());
		await settle(0);
		act(() => current.runAgain());
		await settle(0);
		await show({...withCounter, input: 'there'});
		await settle(600);

		expect(runs()).toEqual([1, 2, 3, 1]);
	});

	it('sends no run for a script without counters', async () => {
		await show(initial);
		await settle(600);

		expect((post.mock.calls[0]![1] as {body: object}).body).not.toHaveProperty('run');
	});
});
