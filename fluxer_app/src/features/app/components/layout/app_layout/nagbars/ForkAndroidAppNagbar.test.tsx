// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// Undefined keeps the fork's real answer; the control test opens the gate to show the hook is live.
const gate = vi.hoisted(() => ({override: undefined as boolean | undefined}));

vi.mock('@app/features/app/components/layout/app_layout/nagbars/ForkAndroidAppNagbar', async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import('@app/features/app/components/layout/app_layout/nagbars/ForkAndroidAppNagbar')
		>();
	return {
		forkAllowsFluxerAndroidAppNagbar: () => gate.override ?? real.forkAllowsFluxerAndroidAppNagbar(),
	};
});

const {useNagbarConditions} = await import('@app/features/app/components/layout/app_layout/AppLayoutHooks');
const {runtimeSnapshotFromDiscovery} = await import('@app/features/app/state/InstanceSnapshotStore');
const {default: RuntimeConfig} = await import('@app/features/app/state/RuntimeConfig');
const {DEPLOYED_OFFICIAL_DOCUMENT} = await import('@fluxer/instance_bootstrap/src/__tests__/DiscoveryFixtures');
const {parseInstanceDiscoveryDocument} = await import('@fluxer/instance_bootstrap/src/Discovery');

// After upstream's start date for the nagbar (AndroidAppNagbarSchedule.ts).
const AFTER_START = new Date('2026-11-10T00:00:00.000Z');

let container: HTMLDivElement;
let root: Root;

function canShowAndroidApp(): boolean {
	let result: boolean | undefined;
	const Probe = () => {
		result = useNagbarConditions().canShowAndroidApp;
		return null;
	};
	act(() =>
		root.render(<Probe data-flx="app.app-layout.nagbars.fork-android-app-nagbar-test.can-show-android-app.probe" />),
	);
	if (result === undefined) throw new Error('the hook did not render');
	return result;
}

describe("upstream's nagbar for Fluxer's Android app (tyne-chat/tyne#546)", () => {
	beforeEach(() => {
		// A self-hosted instance, as Tyne's production reports itself.
		RuntimeConfig.applySnapshot(
			runtimeSnapshotFromDiscovery(
				parseInstanceDiscoveryDocument({
					...DEPLOYED_OFFICIAL_DOCUMENT,
					features: {...DEPLOYED_OFFICIAL_DOCUMENT.features, self_hosted: true},
				}),
			),
		);
		vi.useFakeTimers({toFake: ['Date']});
		vi.setSystemTime(AFTER_START);
		gate.override = undefined;
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it('never shows on Tyne, even after its start date', () => {
		expect(canShowAndroidApp()).toBe(false);
	});

	it('would show without the fork gate, so the test above checks the gate', () => {
		gate.override = true;
		expect(canShowAndroidApp()).toBe(true);
	});
});
