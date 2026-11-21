// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {NativeTitlebar} from '@app/features/app/components/layout/NativeTitlebar';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no popover API: these stand in for the browser's, recording which elements are shown.
type PopoverMethods = {showPopover?: () => void; hidePopover?: () => void};
const prototype = HTMLElement.prototype as unknown as PopoverMethods;
// Element.matches is declared with type-predicate overloads; a plain function stands in here.
type Matches = (this: Element, selector: string) => boolean;
const elementPrototype = Element.prototype as unknown as {matches: Matches};
const originalMatches = elementPrototype.matches;
let shown: Set<Element>;
let showCalls: number;

function installPopoverApi(): void {
	prototype.showPopover = function (this: HTMLElement) {
		if (this.getAttribute('popover') == null) throw new Error('NotSupportedError: not a popover');
		if (shown.has(this)) throw new Error('InvalidStateError: already showing');
		showCalls++;
		shown.add(this);
	};
	prototype.hidePopover = function (this: HTMLElement) {
		shown.delete(this);
	};
	elementPrototype.matches = function (selector) {
		if (selector === ':popover-open') return shown.has(this);
		return originalMatches.call(this, selector);
	};
}

function removePopoverApi(): void {
	delete prototype.showPopover;
	delete prototype.hidePopover;
	elementPrototype.matches = originalMatches;
}

let container: HTMLDivElement;
let root: Root;

function renderTitlebar(): HTMLElement {
	act(() =>
		root.render(
			<NativeTitlebar platform="linux" data-flx="app.native-titlebar.fork-native-titlebar-top-layer-test.titlebar" />,
		),
	);
	const titlebar = container.querySelector<HTMLElement>('[data-native-titlebar]');
	if (titlebar == null) throw new Error('the title bar did not render');
	return titlebar;
}

describe('the desktop title bar in the top layer (tyne-chat/tyne#851)', () => {
	beforeEach(() => {
		shown = new Set();
		showCalls = 0;
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		removePopoverApi();
	});

	it('is shown as a manual popover, so its drag region wins over scrolled content', () => {
		installPopoverApi();
		const titlebar = renderTitlebar();
		expect(titlebar.getAttribute('popover')).toBe('manual');
		expect(shown.has(titlebar)).toBe(true);
		expect(showCalls).toBe(1);
	});

	it('stays shown when the title bar re-renders', () => {
		installPopoverApi();
		renderTitlebar();
		const titlebar = renderTitlebar();
		expect(shown.has(titlebar)).toBe(true);
		expect(showCalls).toBe(1);
	});

	it('is hidden and no longer a popover once unmounted', () => {
		installPopoverApi();
		const titlebar = renderTitlebar();
		act(() => root.unmount());
		expect(shown.has(titlebar)).toBe(false);
		expect(titlebar.hasAttribute('popover')).toBe(false);
		root = createRoot(container);
	});

	it('is left as it was where the browser has no popover API', () => {
		const titlebar = renderTitlebar();
		expect(titlebar.hasAttribute('popover')).toBe(false);
	});

	it('is left as it was if the browser refuses to show it', () => {
		installPopoverApi();
		prototype.showPopover = () => {
			throw new Error('InvalidStateError');
		};
		const titlebar = renderTitlebar();
		expect(titlebar.hasAttribute('popover')).toBe(false);
	});
});
