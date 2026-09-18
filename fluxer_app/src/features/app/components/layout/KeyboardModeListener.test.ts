// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {installVoiceMenuTestBootstrap} from '@app/features/ui/action_menu/items/__fixtures__/VoiceMenuTestBootstrap';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

installVoiceMenuTestBootstrap();
vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));

const {canRedirectTabToComposer, isAutocompleteActive} = await import(
	'@app/features/app/components/layout/KeyboardModeListener'
);

describe('KeyboardModeListener', () => {
	let host: HTMLDivElement;

	beforeEach(() => {
		host = document.createElement('div');
		document.body.append(host);
	});

	afterEach(() => {
		host.remove();
		document.body.replaceChildren();
	});

	describe('isAutocompleteActive', () => {
		it('returns false when no active element or plain element has focus', () => {
			const input = document.createElement('input');
			host.append(input);
			input.focus();

			expect(isAutocompleteActive()).toBe(false);
		});

		it('returns true when active element has aria-controls pointing to an existing listbox', () => {
			const input = document.createElement('div');
			input.setAttribute('contenteditable', 'true');
			input.setAttribute('aria-controls', 'test-listbox-1');

			const listbox = document.createElement('div');
			listbox.id = 'test-listbox-1';
			listbox.setAttribute('role', 'listbox');

			host.append(input, listbox);
			input.focus();

			expect(isAutocompleteActive()).toBe(true);
		});

		it('returns false if aria-controls points to non-existent element', () => {
			const input = document.createElement('div');
			input.setAttribute('contenteditable', 'true');
			input.setAttribute('aria-controls', 'non-existent');
			host.append(input);
			input.focus();

			expect(isAutocompleteActive()).toBe(false);
		});

		it('returns true when active element has aria-activedescendant', () => {
			const input = document.createElement('div');
			input.setAttribute('contenteditable', 'true');
			input.setAttribute('aria-activedescendant', 'item-0');
			host.append(input);
			input.focus();

			expect(isAutocompleteActive()).toBe(true);
		});

		it('returns true when active element has aria-expanded="true" and aria-autocomplete="list"', () => {
			const input = document.createElement('input');
			input.setAttribute('aria-expanded', 'true');
			input.setAttribute('aria-autocomplete', 'list');
			host.append(input);
			input.focus();

			expect(isAutocompleteActive()).toBe(true);
		});

		it('returns false when aria-expanded is false', () => {
			const input = document.createElement('input');
			input.setAttribute('aria-expanded', 'false');
			input.setAttribute('aria-autocomplete', 'list');
			host.append(input);
			input.focus();

			expect(isAutocompleteActive()).toBe(false);
		});
	});

	describe('canRedirectTabToComposer', () => {
		it('returns false when composer is null', () => {
			expect(canRedirectTabToComposer(null)).toBe(false);
		});

		it('returns false when composer is disabled or aria-disabled', () => {
			const composer = document.createElement('textarea');
			composer.disabled = true;
			host.append(composer);
			expect(canRedirectTabToComposer(composer)).toBe(false);

			composer.disabled = false;
			composer.setAttribute('aria-disabled', 'true');
			expect(canRedirectTabToComposer(composer)).toBe(false);
		});

		it('returns false when composer is already the focused element', () => {
			const composer = document.createElement('div');
			composer.setAttribute('contenteditable', 'true');
			composer.setAttribute('data-channel-textarea', 'true');
			host.append(composer);
			composer.focus();

			expect(canRedirectTabToComposer(composer)).toBe(false);
		});

		it('returns false when a child inside composer is focused', () => {
			const composer = document.createElement('div');
			composer.setAttribute('contenteditable', 'true');
			const paragraph = document.createElement('p');
			paragraph.setAttribute('tabindex', '0');
			composer.append(paragraph);
			host.append(composer);
			paragraph.focus();

			expect(canRedirectTabToComposer(composer)).toBe(false);
		});

		it('returns true when active element is outside composer and not in a modal/dialog', () => {
			const composer = document.createElement('div');
			composer.setAttribute('contenteditable', 'true');
			const outsideButton = document.createElement('button');
			host.append(composer, outsideButton);
			outsideButton.focus();

			expect(canRedirectTabToComposer(composer)).toBe(true);
		});

		it('returns false when active element is inside a dialog or modal', () => {
			const composer = document.createElement('div');
			composer.setAttribute('contenteditable', 'true');

			const dialog = document.createElement('div');
			dialog.setAttribute('role', 'dialog');
			const dialogButton = document.createElement('button');
			dialog.append(dialogButton);

			host.append(composer, dialog);
			dialogButton.focus();

			expect(canRedirectTabToComposer(composer)).toBe(false);
		});
	});
});
