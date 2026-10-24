// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

await vi.hoisted(async () => {
	const {installVoiceMenuTestBootstrap} = await import(
		'@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap'
	);
	installVoiceMenuTestBootstrap();
});

// The modal, its carousel and its footer animate; unmounting mid-animation rejects in happy-dom.
vi.mock('framer-motion', async () => {
	const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
	const {forwardRef} = await import('react');
	const div = forwardRef<HTMLDivElement, Record<string, unknown>>(
		({initial, animate, exit, transition, variants, custom, onAnimationStart, onAnimationComplete, ...props}, ref) => (
			<div ref={ref} data-flx="guild.fork-add-guild-modal-community-creation-test.div.div" {...props} />
		),
	);
	return {...actual, motion: {div}, AnimatePresence: ({children}: {children?: unknown}) => children ?? null};
});

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

// Observable, as the account and the runtime config the real rule reads are.
const rule = await vi.hoisted(async () => {
	const {observable} = await import('mobx');
	return observable({allowed: true});
});
vi.mock('@app/features/guild/utils/ForkCommunityCreation', () => ({canCreateCommunities: () => rule.allowed}));

import {AddGuildModal} from '@app/features/guild/components/modals/AddGuildModal';
import {runInAction} from 'mobx';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LANDING = '[data-flx="guild.add-guild-modal.landing-view.landing-container"]';
const JOIN_FORM = '[data-flx="guild.add-guild-modal.guild-join-form.form-container"]';
const BACK = '[data-flx="guild.add-guild-modal.guild-join-form.button.back"]';

const setAllowed = (allowed: boolean) => {
	act(() => {
		runInAction(() => {
			rule.allowed = allowed;
		});
	});
};

describe('the add community modal for an account that may not create one', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		setAllowed(true);
	});

	const open = async (initialView?: 'landing' | 'create_guild' | 'join_guild') => {
		await act(async () => {
			root.render(
				<AddGuildModal
					initialView={initialView}
					data-flx="guild.fork-add-guild-modal-community-creation-test.open.add-guild-modal"
				/>,
			);
		});
	};

	it('opens on the landing view for an account that may create one', async () => {
		await open();
		expect(document.querySelector(LANDING)).not.toBeNull();
	});

	it.each([undefined, 'landing', 'create_guild', 'join_guild'] as const)(
		'opens on the join form without a way back, whatever view it is asked for (%s)',
		async (initialView) => {
			setAllowed(false);
			await open(initialView);
			expect(document.querySelector(LANDING)).toBeNull();
			expect(document.querySelector(JOIN_FORM)).not.toBeNull();
			expect(document.querySelector(BACK)).toBeNull();
		},
	);

	it("keeps the join form's way back for an account that may create one", async () => {
		await open('join_guild');
		expect(document.querySelector(JOIN_FORM)).not.toBeNull();
		expect(document.querySelector(BACK)).not.toBeNull();
	});

	it('moves to the join form when the account loses the right while the modal is open', async () => {
		await open('create_guild');
		expect(document.querySelector(JOIN_FORM)).toBeNull();
		setAllowed(false);
		expect(document.querySelector(JOIN_FORM)).not.toBeNull();
		expect(document.querySelector(BACK)).toBeNull();
	});

	it('offers the way back once the account gains the right while the modal is open', async () => {
		setAllowed(false);
		await open();
		expect(document.querySelector(BACK)).toBeNull();
		setAllowed(true);
		expect(document.querySelector(JOIN_FORM)).not.toBeNull();
		expect(document.querySelector(BACK)).not.toBeNull();
	});
});
