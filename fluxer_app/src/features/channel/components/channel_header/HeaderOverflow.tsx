// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the channel header in a narrow window (tyne-chat/tyne#233). Upstream's header keeps every
// action at full size, so in a narrow window the action row covers the channel's name and the
// sidebar toggle. This component sits at the end of the action row (one line in ChannelHeader.tsx
// and in VoiceCallView.tsx), measures the header, and makes the row give way in the order
// HeaderOverflowLayout.ts sets: the search box becomes a magnifier, then actions move into a
// "More options" menu. It works on its sibling elements in the DOM instead of wrapping them, so
// upstream's JSX stays as it is.
//
// An action in the menu stays mounted, invisible and inert, where the menu button is. Its popout or
// menu, its keybind and its state keep working as upstream wrote them, and open at the menu button;
// choosing it in the menu clicks it.

import styles from '@app/features/channel/components/ChannelHeader.module.css';
import ownStyles from '@app/features/channel/components/channel_header/HeaderOverflow.module.css';
import {
	findHeaderItemRule,
	type HeaderItemRule,
	type HeaderLayout,
	type HeaderLayoutInput,
	type HeaderLayoutItem,
	layoutAtLevel,
	NAME_COMFORT_REM,
	NAME_FLOOR_REM,
	nextLevel,
	SEARCH_FULL_REM,
	SEARCH_NARROW_REM,
	TOPIC_MIN_REM,
	UNFOLD_BAND_REM,
	UNKNOWN_ITEM_FOLD_ORDER,
	widthsAtLevel,
} from '@app/features/channel/components/channel_header/HeaderOverflowLayout';
import {SEARCH_DESCRIPTOR} from '@app/features/channel/components/channel_header/shared';
import {ChannelHeaderIcon} from '@app/features/channel/components/channel_header_components/ChannelHeaderIcon';
import {MORE_OPTIONS_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {ComponentBus} from '@app/features/platform/utils/ComponentBus';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {useContextMenuTrigger} from '@app/features/ui/hooks/useContextMenuTrigger';
import ContextMenuState, {isContextMenuNodeTarget} from '@app/features/ui/state/ContextMenu';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import PopoutState from '@app/features/ui/state/Popout';
import {useLingui} from '@lingui/react/macro';
import {DotsThreeIcon, MagnifyingGlassIcon} from '@phosphor-icons/react';
import {reaction} from 'mobx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

// Set on the header (the grid): the overflow is active, the search box's size, and whether the
// collapsed search box is open.
const ACTIVE_ATTR = 'data-header-overflow';
const SEARCH_ATTR = 'data-header-search';
const SEARCH_OPEN_ATTR = 'data-header-search-open';
// Set on an item: moved into the menu, or (information, not an action) hidden.
const FOLDED_ATTR = 'data-header-folded';
const HIDDEN_ATTR = 'data-header-hidden';
// On this component's own elements, which are not items.
const OWN_ATTR = 'data-header-overflow-own';
const SEARCH_OPEN_WIDTH_VAR = '--header-search-open-width';
// Set on the header: the room the title side gets, what the action row leaves. Before the header is
// measured, the stylesheet falls back to 10rem.
const TITLE_MIN_VAR = '--header-title-min';
// Set on the header: the topic and its separator are hidden.
const TOPIC_HIDDEN_ATTR = 'data-header-topic-hidden';

const CRUMB_NAME = /thread-parent-crumb\.crumb-name/;
const FOLLOW = /channel-follow-button/;
// A dot or badge on an item: unread pins, or the fork's mention badge or unread dot on a header button.
const UNREAD_MARK = /unread-pin-indicator|header-button-badge|header-button-unread-dot/;

interface MeasuredItem {
	readonly item: HeaderLayoutItem;
	readonly element: HTMLElement;
	readonly rule: HeaderItemRule | null;
}

interface OverflowState {
	readonly count: number;
	readonly dot: boolean;
	readonly searchMode: HeaderLayout['searchMode'] | null;
	readonly searchFolded: boolean;
}

const INITIAL_STATE: OverflowState = {count: 0, dot: false, searchMode: null, searchFolded: false};

const flxOf = (element: Element): string | null =>
	element.getAttribute('data-flx') ?? element.querySelector('[data-flx]')?.getAttribute('data-flx') ?? null;

const px = (value: string): number => Number.parseFloat(value) || 0;

const horizontalMargins = (style: CSSStyleDeclaration): number => px(style.marginLeft) + px(style.marginRight);

interface NameCaps {
	readonly name: number;
	// A thread's parent channel.
	readonly crumb: number;
}

// The width the title side wants with its names at most as wide as `caps`: what shortens with an
// ellipsis is counted at its full length, up to the cap; the topic counts nothing, since it gives way
// first by itself.
function naturalWidth(element: Element, caps: NameCaps, cachedWidth: (element: Element) => number): number {
	const style = getComputedStyle(element);
	const margins = horizontalMargins(style);
	if (element.hasAttribute(FOLDED_ATTR)) return cachedWidth(element) + margins;
	if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') return 0;
	const {classList} = element;
	if (classList.contains(styles.topicContainer) || classList.contains(styles.topicDivider)) return 0;
	// One pixel more than scrollWidth, which rounds, so that a name that fits does not end in an ellipsis.
	if (classList.contains(styles.channelName)) return Math.min(element.scrollWidth + 1, caps.name) + margins;
	if (CRUMB_NAME.test(element.getAttribute('data-flx') ?? '')) {
		return Math.min(element.scrollWidth + 1, caps.crumb) + margins;
	}
	if (style.display.endsWith('flex') && !style.flexDirection.startsWith('column') && style.flexShrink !== '0') {
		let total = 0;
		let count = 0;
		for (const child of element.children) {
			const width = naturalWidth(child, caps, cachedWidth);
			if (width <= 0) continue;
			total += width;
			count += 1;
		}
		total += px(style.columnGap) * Math.max(0, count - 1);
		total += px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
		if (style.maxWidth.endsWith('px')) total = Math.min(total, px(style.maxWidth));
		return total + margins;
	}
	// Something that clips or scrolls its content (the Friends page's tabs) wants its content's width.
	if (style.overflowX !== 'visible') {
		let widest = Math.max(element.scrollWidth, element.getBoundingClientRect().width);
		for (const child of element.children) widest = Math.max(widest, naturalWidth(child, caps, cachedWidth));
		return widest + margins;
	}
	return element.getBoundingClientRect().width + margins;
}

interface MenuEntry {
	readonly key: string;
	readonly label: string;
	readonly disabled: boolean;
	// The search box has no icon of its own to copy; the Follow button has no icon at all.
	readonly icon: Element | 'search' | null;
	readonly activate: () => void;
}

// The icon of the button an entry stands for, so that it shows the same state (a filled star, a
// struck-through bell).
const MenuEntryIcon = ({icon}: {icon: Element | null}) => {
	const ref = useCallback(
		(node: HTMLSpanElement | null) => {
			if (node == null || icon == null) return;
			const copy = icon.cloneNode(true) as Element;
			// An id in the copy (a clip path) would name the original, which is hidden; give it its own.
			for (const element of copy.querySelectorAll('[id]')) {
				const id = element.id;
				const ownId = `${id}-header-overflow`;
				element.id = ownId;
				for (const user of copy.querySelectorAll('*')) {
					for (const attribute of user.attributes) {
						if (attribute.value.includes(`url(#${id})`)) {
							attribute.value = attribute.value.replaceAll(`url(#${id})`, `url(#${ownId})`);
						}
					}
				}
			}
			node.replaceChildren(copy);
		},
		[icon],
	);
	return <span ref={ref} className={ownStyles.menuIcon} aria-hidden data-flx="channel.header-overflow.menu-icon" />;
};

const menuEntryIcon = (icon: MenuEntry['icon']): React.ReactNode => {
	if (icon === 'search') {
		return <MagnifyingGlassIcon weight="bold" data-flx="channel.header-overflow.menu-search-icon" />;
	}
	if (icon == null) return undefined;
	return <MenuEntryIcon icon={icon} data-flx="channel.header-overflow.menu-entry-icon" />;
};

interface HeaderOverflowProps {
	// A search is typed in or its results are shown: the magnifier shows as pressed.
	searchActive?: boolean;
	// For the menu button, as the row's own buttons have (the call view's).
	buttonClassName?: string;
}

export const HeaderOverflow = observer(({searchActive = false, buttonClassName}: HeaderOverflowProps) => {
	const {i18n} = useLingui();
	const isMobile = MobileLayout.isMobileLayout();
	const anchorRef = useRef<HTMLSpanElement>(null);
	const moreRef = useRef<HTMLButtonElement>(null);
	const levelRef = useRef<number | null>(null);
	const measuredRef = useRef<Array<MeasuredItem>>([]);
	const widthCacheRef = useRef(new WeakMap<Element, number>());
	const focusMoreRef = useRef(false);
	const returnFocusArmedRef = useRef(false);
	const searchOpenRef = useRef(false);
	const [state, setState] = useState<OverflowState>(INITIAL_STATE);
	const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
	const [searchFocused, setSearchFocused] = useState(false);
	const {isOpen: isMenuOpen, withTracking} = useContextMenuTrigger();
	const countRef = useRef(0);
	countRef.current = state.count;

	const getParts = useCallback(() => {
		const row = anchorRef.current?.parentElement ?? null;
		const header = row?.parentElement ?? null;
		const left = header?.firstElementChild ?? null;
		if (row == null || header == null || !(left instanceof HTMLElement) || left === row) return null;
		return {row, header, left};
	}, []);

	const searchOpenWidth = useCallback(
		(slot: HTMLElement, left: HTMLElement, remPx: number): number => {
			const header = getParts()?.header;
			const rtl = header != null && getComputedStyle(header).direction === 'rtl';
			const slotRect = slot.getBoundingClientRect();
			const toggle = left.firstElementChild?.getBoundingClientRect();
			let room = SEARCH_FULL_REM * remPx;
			if (toggle != null && toggle.width > 0) room = rtl ? toggle.left - slotRect.left : slotRect.right - toggle.right;
			return Math.max(2 * remPx, Math.min(SEARCH_FULL_REM * remPx, room - 0.5 * remPx));
		},
		[getParts],
	);

	useLayoutEffect(() => {
		if (isMobile) return;
		const parts = getParts();
		if (parts == null) return;
		const {row, header, left} = parts;
		const widthCache = widthCacheRef.current;
		const cachedWidth = (element: Element): number => {
			const width = element.getBoundingClientRect().width;
			if (width > 0) widthCache.set(element, width);
			return width > 0 ? width : (widthCache.get(element) ?? 0);
		};
		const isFrozen = (): boolean => {
			const menuTarget = ContextMenuState.contextMenu?.target?.target ?? null;
			if (isContextMenuNodeTarget(menuTarget) && header.contains(menuTarget)) return true;
			return Object.values(PopoutState.popouts).some(
				(popout) => popout.target != null && header.contains(popout.target),
			);
		};

		const measure = () => {
			if (isFrozen() || !header.isConnected) return;
			const remPx = px(getComputedStyle(document.documentElement).fontSize) || 16;
			const headerStyle = getComputedStyle(header);
			const actionSize = (px(headerStyle.getPropertyValue('--channel-header-action-size')) || 2) * remPx;
			const available =
				header.clientWidth - px(headerStyle.paddingLeft) - px(headerStyle.paddingRight) - px(headerStyle.columnGap);
			const measured: Array<MeasuredItem> = [];
			let searchElement: HTMLElement | null = null;
			const topicDivider = left.querySelector(`.${CSS.escape(styles.topicDivider)}`);
			// Upstream hides the topic itself while a thread panel is open.
			const topicShown =
				topicDivider != null &&
				(header.hasAttribute(TOPIC_HIDDEN_ATTR) || getComputedStyle(topicDivider).display !== 'none');
			const follow = [...left.querySelectorAll<HTMLElement>('[data-flx]')].find((element) =>
				FOLLOW.test(element.getAttribute('data-flx') ?? ''),
			);
			if (follow != null) {
				const rule = findHeaderItemRule(follow.getAttribute('data-flx'));
				const width = cachedWidth(follow) + horizontalMargins(getComputedStyle(follow));
				measured.push({
					item: {
						key: 'title:follow',
						kind: 'action',
						width,
						foldOrder: rule?.foldOrder ?? 1,
						inTitle: true,
					},
					element: follow,
					rule,
				});
			}
			let index = 0;
			for (const child of row.children) {
				if (!(child instanceof HTMLElement) || child.hasAttribute(OWN_ATTR)) continue;
				const rule = findHeaderItemRule(flxOf(child));
				const kind = rule?.kind ?? 'action';
				const width = kind === 'search' ? actionSize : cachedWidth(child);
				index += 1;
				if (width <= 0) continue;
				if (kind === 'search') searchElement = child;
				const foldOrder = rule?.foldOrder ?? UNKNOWN_ITEM_FOLD_ORDER;
				measured.push({item: {key: `row:${index}`, kind, width, foldOrder}, element: child, rule});
			}
			const input: HeaderLayoutInput = {
				available,
				// A thread's parent channel keeps up to the floor's width until the name itself must shorten.
				leftComfort: naturalWidth(left, {name: NAME_COMFORT_REM * remPx, crumb: NAME_FLOOR_REM * remPx}, cachedWidth),
				leftFloor: naturalWidth(left, {name: NAME_FLOOR_REM * remPx, crumb: 0}, cachedWidth),
				topic:
					topicDivider != null && topicShown
						? cachedWidth(topicDivider) + horizontalMargins(getComputedStyle(topicDivider)) + TOPIC_MIN_REM * remPx
						: 0,
				gap: px(getComputedStyle(row).columnGap),
				// The menu button is as wide as the row's own buttons (2.125rem in the call view).
				moreWidth: measured.find(({item}) => item.kind === 'action' && !item.inTitle)?.item.width ?? actionSize,
				search: searchElement != null ? {full: SEARCH_FULL_REM * remPx, narrow: SEARCH_NARROW_REM * remPx} : null,
				items: measured.map(({item}) => item),
			};
			const level = nextLevel(input, levelRef.current, UNFOLD_BAND_REM * remPx);
			levelRef.current = level;
			const layout = layoutAtLevel(input, level);
			// The grid gives the title side at least this, so the row gets exactly what it was measured to
			// need: a fixed minimum larger than a short title would cut the row's first icon, and one that
			// leaves no room for the menu button would cut that. A pixel to spare for rounding.
			const {row: rowWidth} = widthsAtLevel(input, level);
			header.style.setProperty(TITLE_MIN_VAR, `${Math.max(0, Math.floor(available - rowWidth) - 1)}px`);
			measuredRef.current = measured;

			header.toggleAttribute(TOPIC_HIDDEN_ATTR, topicShown && layout.hideInfo);
			if (searchElement != null) header.setAttribute(SEARCH_ATTR, layout.searchMode);
			else header.removeAttribute(SEARCH_ATTR);
			let dot = false;
			let searchFolded = false;
			for (const {item, element, rule} of measured) {
				if (item.kind === 'info') {
					element.toggleAttribute(HIDDEN_ATTR, layout.hideInfo);
					continue;
				}
				const folded = layout.folded.has(item.key);
				element.toggleAttribute(FOLDED_ATTR, folded);
				// The search field must stay focusable for Ctrl+F; it is hidden by its own rules instead.
				if (item.kind !== 'search') element.inert = folded;
				if (!folded) continue;
				if (item.kind === 'search') searchFolded = true;
				if (element.contains(document.activeElement)) focusMoreRef.current = true;
				if (
					rule?.id === 'updater' ||
					[...element.querySelectorAll('[data-flx]')].some((node) =>
						UNREAD_MARK.test(node.getAttribute('data-flx') ?? ''),
					)
				) {
					dot = true;
				}
			}
			if (searchElement != null && searchOpenRef.current) {
				searchElement.style.setProperty(SEARCH_OPEN_WIDTH_VAR, `${searchOpenWidth(searchElement, left, remPx)}px`);
			}
			setSearchSlot(searchElement);
			setState((previous) => {
				const next: OverflowState = {
					count: layout.folded.size,
					dot,
					searchMode: searchElement != null ? layout.searchMode : null,
					searchFolded,
				};
				return previous.count === next.count &&
					previous.dot === next.dot &&
					previous.searchMode === next.searchMode &&
					previous.searchFolded === next.searchFolded
					? previous
					: next;
			});
		};

		let frame: number | null = null;
		const schedule = () => {
			if (frame != null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				measure();
			});
		};
		header.setAttribute(ACTIVE_ATTR, '');
		measure();
		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(header);
		resizeObserver.observe(row);
		resizeObserver.observe(left);
		// Typing in the search box changes nothing here.
		const mutationObserver = new MutationObserver((records) => {
			const search = row.querySelector(`.${CSS.escape(styles.messageSearchFocusWrapper)}`);
			if (search != null && records.every((record) => search.contains(record.target))) return;
			schedule();
		});
		mutationObserver.observe(header, {childList: true, subtree: true, characterData: true});
		// A header popout or menu keeps the layout as it is while open, so that nothing moves under it.
		const disposeReaction = reaction(isFrozen, (frozen) => {
			if (!frozen) schedule();
		});
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			disposeReaction();
			for (const attribute of [ACTIVE_ATTR, SEARCH_ATTR, SEARCH_OPEN_ATTR, TOPIC_HIDDEN_ATTR])
				header.removeAttribute(attribute);
			header.style.removeProperty(TITLE_MIN_VAR);
			for (const {element} of measuredRef.current) {
				element.removeAttribute(FOLDED_ATTR);
				element.removeAttribute(HIDDEN_ATTR);
				element.inert = false;
			}
		};
	}, [getParts, isMobile, searchOpenWidth]);

	// Something that moved into the menu while it had focus hands focus to the menu button.
	useLayoutEffect(() => {
		if (!focusMoreRef.current) return;
		focusMoreRef.current = false;
		moreRef.current?.focus();
	});

	// The collapsed search box opens while it has focus (a click on the magnifier, Ctrl+F, or Tab) and
	// while its scope menu is open; it folds back when it loses focus, also while its results are shown,
	// so that it does not hide the name and the icons beside it the whole time.
	useEffect(() => {
		if (searchSlot == null) return;
		const handleFocusIn = () => setSearchFocused(true);
		const handleFocusOut = (event: FocusEvent) => {
			if (event.relatedTarget instanceof Node && searchSlot.contains(event.relatedTarget)) return;
			setSearchFocused(false);
		};
		searchSlot.addEventListener('focusin', handleFocusIn);
		searchSlot.addEventListener('focusout', handleFocusOut);
		return () => {
			searchSlot.removeEventListener('focusin', handleFocusIn);
			searchSlot.removeEventListener('focusout', handleFocusOut);
		};
	}, [searchSlot]);

	const searchCollapsed = state.searchMode === 'icon';
	const menuTarget = ContextMenuState.contextMenu?.target?.target ?? null;
	const scopeMenuOpen = searchSlot != null && isContextMenuNodeTarget(menuTarget) && searchSlot.contains(menuTarget);
	const searchOpen = searchCollapsed && (searchFocused || scopeMenuOpen);
	// A scope menu opened with the pointer gives focus back to no one when it closes; in the collapsed
	// box that would close the box under the user. Give it to the field, as if they had gone on typing.
	const scopeMenuWasOpenRef = useRef(false);
	useEffect(() => {
		const wasOpen = scopeMenuWasOpenRef.current;
		scopeMenuWasOpenRef.current = scopeMenuOpen;
		if (!wasOpen || scopeMenuOpen || !searchCollapsed || searchSlot == null) return;
		const frame = requestAnimationFrame(() => {
			const active = document.activeElement;
			if (active != null && active !== document.body) return;
			searchSlot.querySelector<HTMLElement>('[role="combobox"]')?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [scopeMenuOpen, searchCollapsed, searchSlot]);
	useLayoutEffect(() => {
		searchOpenRef.current = searchOpen;
		const parts = getParts();
		if (parts == null) return;
		parts.header.toggleAttribute(SEARCH_OPEN_ATTR, searchOpen);
		if (searchOpen && searchSlot != null) {
			const remPx = px(getComputedStyle(document.documentElement).fontSize) || 16;
			searchSlot.style.setProperty(SEARCH_OPEN_WIDTH_VAR, `${searchOpenWidth(searchSlot, parts.left, remPx)}px`);
		}
	}, [getParts, searchOpen, searchOpenWidth, searchSlot]);

	// When something opened from a folded action closes (from the menu, or by its keybind), its focus
	// goes back to that action's button, which is inert and cannot take it, so it lands on the page.
	// Send it to the menu button. A click anywhere disarms this, so pointer users are left alone.
	useEffect(() => {
		const disarm = () => {
			returnFocusArmedRef.current = false;
		};
		const armIfFolded = () => {
			if (countRef.current > 0) returnFocusArmedRef.current = true;
		};
		const openFromFolded = (): boolean => {
			const targets: Array<unknown> = [
				ContextMenuState.contextMenu?.target?.target,
				...Object.values(PopoutState.popouts).map((popout) => popout.target),
			];
			return targets.some((target) => target instanceof Element && target.closest(`[${FOLDED_ATTR}]`) != null);
		};
		const disposeReaction = reaction(openFromFolded, (open) => {
			if (open || !returnFocusArmedRef.current) return;
			requestAnimationFrame(() => {
				const active = document.activeElement;
				if (!returnFocusArmedRef.current || (active != null && active !== document.body)) return;
				returnFocusArmedRef.current = false;
				if (moreRef.current?.isConnected) moreRef.current.focus();
			});
		});
		document.addEventListener('pointerdown', disarm, true);
		const unsubscribers = (['CHANNEL_PINS_OPEN', 'INBOX_OPEN', 'THREAD_BROWSER_OPEN'] as const).map((type) =>
			ComponentBus.subscribe(type, armIfFolded),
		);
		return () => {
			disposeReaction();
			document.removeEventListener('pointerdown', disarm, true);
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, []);

	// As a click on the search box does. Ctrl+F's handler (MESSAGE_SEARCH_OPEN) also adds an in: filter
	// for the channel, which a click does not.
	const openSearch = useCallback(() => {
		const field = searchSlot?.querySelector<HTMLElement>('[role="combobox"]');
		if (field == null) {
			ComponentBus.dispatch('MESSAGE_SEARCH_OPEN');
			return;
		}
		field.focus();
	}, [searchSlot]);

	const collectEntries = useCallback((): Array<MenuEntry> => {
		const entries: Array<MenuEntry> = [];
		for (const {item, element} of measuredRef.current) {
			if (item.kind === 'info' || !element.hasAttribute(FOLDED_ATTR)) continue;
			if (item.kind === 'search') {
				entries.push({
					key: item.key,
					label: i18n._(SEARCH_DESCRIPTOR),
					disabled: false,
					icon: 'search',
					activate: openSearch,
				});
				continue;
			}
			const button = element instanceof HTMLButtonElement ? element : element.querySelector('button');
			if (button == null) continue;
			entries.push({
				key: item.key,
				label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
				disabled: button.disabled,
				icon: button.querySelector('svg'),
				activate: () => {
					if (!item.inTitle) returnFocusArmedRef.current = true;
					button.click();
				},
			});
		}
		return entries;
	}, [i18n, openSearch]);

	const handleOpenMenu = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			const entries = collectEntries();
			ContextMenuCommands.openFromElementBottomRight(
				event,
				({onClose}) => (
					<MenuGroup data-flx="channel.header-overflow.menu-group">
						{entries.map((entry) => (
							<MenuItem
								key={entry.key}
								icon={menuEntryIcon(entry.icon)}
								disabled={entry.disabled}
								onClick={() => {
									onClose();
									// After the menu has closed and given focus back to its button (in a microtask),
									// so that the action can take focus itself.
									window.setTimeout(entry.activate, 0);
								}}
								data-flx="channel.header-overflow.menu-item"
							>
								{entry.label}
							</MenuItem>
						))}
					</MenuGroup>
				),
				withTracking(),
			);
		},
		[collectEntries, withTracking],
	);

	if (isMobile) return null;
	return (
		<>
			<span ref={anchorRef} hidden {...{[OWN_ATTR]: ''}} data-flx="channel.header-overflow.anchor" />
			{state.count > 0 && (
				<ChannelHeaderIcon
					ref={moreRef}
					icon={DotsThreeIcon}
					iconWeight="bold"
					label={i18n._(MORE_OPTIONS_DESCRIPTOR)}
					hasUnread={state.dot}
					isSelected={isMenuOpen}
					className={buttonClassName}
					aria-haspopup="menu"
					aria-expanded={isMenuOpen}
					onClick={handleOpenMenu}
					{...{[OWN_ATTR]: ''}}
					data-flx="channel.header-overflow.more"
				/>
			)}
			{/* The magnifier is for the pointer: Tab reaches the search field itself, which opens on focus. */}
			{searchSlot != null &&
				searchCollapsed &&
				!state.searchFolded &&
				createPortal(
					<span className={ownStyles.magnifier} {...{[OWN_ATTR]: ''}} data-flx="channel.header-overflow.magnifier">
						<ChannelHeaderIcon
							icon={MagnifyingGlassIcon}
							iconWeight="bold"
							label={i18n._(SEARCH_DESCRIPTOR)}
							keybindAction="misc_search"
							isSelected={searchActive}
							onClick={openSearch}
							tabIndex={-1}
							onMouseDown={(event: React.MouseEvent) => event.preventDefault()}
							data-flx="channel.header-overflow.magnifier-button"
						/>
					</span>,
					searchSlot,
				)}
		</>
	);
});
