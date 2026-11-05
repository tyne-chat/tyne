// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children ?? null,
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor.message ?? '', locale: 'en'}}),
}));

import {
	SettingsNarrowNav,
	SettingsNarrowNavButton,
} from '@app/features/app/components/dialogs/shared/SettingsNarrowNav';
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom lays nothing out: the dialog's width and the size of a rem are set here, and the
// ResizeObserver callbacks run when a test says so.
let dialogWidthPx = 0;
let remPx = 16;
const observers: Array<() => void> = [];

class TestResizeObserver {
	constructor(private readonly callback: () => void) {}
	observe() {
		observers.push(this.callback);
	}
	disconnect() {
		observers.splice(observers.indexOf(this.callback), 1);
	}
}

function rect(width: number): DOMRect {
	return {width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({})};
}

function resize(widthPx: number, rem = remPx): void {
	dialogWidthPx = widthPx;
	remPx = rem;
	act(() => {
		for (const callback of [...observers]) callback();
	});
}

describe('SettingsNarrowNav', () => {
	let container: HTMLDivElement;
	let root: Root;
	const onSectionClick = vi.fn();
	const onOpenEntryClick = vi.fn();
	const onClose = vi.fn();

	const navRoot = () => container.querySelector<HTMLElement>('[data-settings-narrow-view]')!;
	const view = () => navRoot().getAttribute('data-settings-narrow-view');
	const isNarrow = () => navRoot().hasAttribute('data-settings-narrow');
	const isTight = () => navRoot().hasAttribute('data-settings-tight');
	const click = (element: Element) => act(() => (element as HTMLElement).click());
	const backButton = () => container.querySelector<HTMLButtonElement>('[role="region"] button')!;
	const entry = (label: string) =>
		[...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')].find((b) => b.textContent === label)!;

	function render(widthPx: number): void {
		dialogWidthPx = widthPx;
		act(() => {
			root.render(
				<SettingsNarrowNav data-flx="app.settings-narrow-nav-test.settings-narrow-nav">
					<div data-sidebar data-flx="app.settings-narrow-nav-test.div">
						<div role="search" data-flx="app.settings-narrow-nav-test.search">
							<input aria-label="Search" data-flx="app.settings-narrow-nav-test.search--2" />
						</div>
						<div role="tree" data-flx="app.settings-narrow-nav-test.tree">
							<button
								type="button"
								role="treeitem"
								aria-selected="true"
								aria-expanded="true"
								onClick={onOpenEntryClick}
								data-flx="app.settings-narrow-nav-test.treeitem.open-entry-click.button"
							>
								Privacy
							</button>
							<button
								type="button"
								role="treeitem"
								aria-selected="false"
								onClick={onSectionClick}
								data-flx="app.settings-narrow-nav-test.treeitem.section-click.button"
							>
								Appearance
							</button>
						</div>
					</div>
					<div role="region" tabIndex={-1} data-flx="app.settings-narrow-nav-test.region">
						<SettingsNarrowNavButton
							onClose={onClose}
							data-flx="app.settings-narrow-nav-test.settings-narrow-nav-button"
						/>
					</div>
				</SettingsNarrowNav>,
			);
		});
	}

	beforeEach(() => {
		remPx = 16;
		observers.length = 0;
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
			if (this.hasAttribute('data-settings-narrow-view')) return rect(dialogWidthPx);
			if (
				this.getAttribute('aria-hidden') === 'true' &&
				this.parentElement?.hasAttribute('data-settings-narrow-view')
			) {
				return rect(remPx);
			}
			return rect(0);
		});
		Element.prototype.checkVisibility ??= () => true;
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		onSectionClick.mockClear();
		onOpenEntryClick.mockClear();
		onClose.mockClear();
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('turns narrow below 42rem and wide again only above 47rem', () => {
		render(50 * 16);
		expect(isNarrow()).toBe(false);
		resize(42.5 * 16);
		expect(isNarrow()).toBe(false);
		resize(41.5 * 16);
		expect(isNarrow()).toBe(true);
		resize(46.5 * 16);
		expect(isNarrow()).toBe(true);
		resize(47.5 * 16);
		expect(isNarrow()).toBe(false);
	});

	it('starts narrow when it opens narrow', () => {
		render(30 * 16);
		expect(isNarrow()).toBe(true);
		expect(view()).toBe('section');
	});

	it('counts app zoom, which changes the rem and not the px', () => {
		render(800);
		expect(isNarrow()).toBe(false);
		resize(800, 24);
		expect(isNarrow()).toBe(true);
		resize(800, 16);
		expect(isNarrow()).toBe(false);
	});

	it('keeps the arrow only below 25rem, until above 27rem', () => {
		render(26 * 16);
		expect(isTight()).toBe(false);
		resize(24.5 * 16);
		expect(isTight()).toBe(true);
		resize(26.5 * 16);
		expect(isTight()).toBe(true);
		resize(27.5 * 16);
		expect(isTight()).toBe(false);
	});

	it('shows the list from the Settings button and the section once one is chosen', () => {
		render(30 * 16);
		click(backButton());
		expect(view()).toBe('list');
		click(entry('Appearance'));
		expect(view()).toBe('section');
		expect(onSectionClick).toHaveBeenCalledTimes(1);
	});

	it('goes back to the open section from its own entry without folding its subsections', () => {
		render(30 * 16);
		click(backButton());
		click(entry('Privacy'));
		expect(view()).toBe('section');
		expect(onOpenEntryClick).not.toHaveBeenCalled();
	});

	it('leaves the open entry to fold and unfold when the dialog is wide', () => {
		render(50 * 16);
		click(entry('Privacy'));
		expect(onOpenEntryClick).toHaveBeenCalledTimes(1);
	});

	it('stays in the list for clicks in the search, and shows the results on Enter', () => {
		render(30 * 16);
		click(backButton());
		const input = container.querySelector('input')!;
		click(input);
		expect(view()).toBe('list');
		act(() => {
			input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
		});
		expect(view()).toBe('section');
	});

	it("closes the dialog from the list with the header's close action", () => {
		render(30 * 16);
		click(backButton());
		click(container.querySelector('[data-settings-narrow-list-header] button')!);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('shows the section again once the dialog is wide', () => {
		render(30 * 16);
		click(backButton());
		expect(view()).toBe('list');
		resize(50 * 16);
		expect(view()).toBe('section');
	});
});
