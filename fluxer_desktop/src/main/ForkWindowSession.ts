// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the saved layout of the app's windows. This fork lets the app open more than one app
// window (the fork block at the end of Window.ts owns them); this module holds everything about
// that feature that does not need Electron, so it can be unit tested: which routes may open in a
// window, how the layout is written to and read from disk, and where a window may be placed.

import {isReservedLocalAppProxyPath} from '@electron/main/LocalAppURL';
import {isRestorableDesktopRoutePath} from '@fluxer/desktop_ipc/src/LastRouteContract';

export const FORK_WINDOW_SESSION_FILE_NAME = 'window-session.json';
export const FORK_EXTRA_APP_WINDOWS_MAX = 12;

const SESSION_VERSION = 1;
const WINDOW_SIZE_MIN = 120;
const WINDOW_SIZE_MAX = 32767;
const WINDOW_POSITION_MAX = 1_000_000;
const VISIBLE_MARGIN = 32;
const CASCADE_OFFSET = 32;

export interface ForkWindowBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

// One window of a saved layout. A layout lists its windows from the back of the stack to the front.
export interface ForkWindowSessionEntry {
	readonly route: string | null;
	readonly bounds: ForkWindowBounds;
	readonly isMaximized: boolean;
	readonly isMainWindow: boolean;
	readonly isFocused: boolean;
}

export interface ForkWindowRestorePlan {
	// Extra windows to create, back to front.
	readonly extraWindows: ReadonlyArray<ForkWindowSessionEntry>;
	// Every window of the layout, back to front, as an index into extraWindows or 'main'.
	readonly stackingOrder: ReadonlyArray<number | 'main'>;
	// The window that had focus, same form as a stackingOrder element.
	readonly focused: number | 'main';
}

// A route a window may open on: an in-app path, as upstream accepts for the main window's last
// route, that is not one of the local app's reserved proxy paths.
export function isForkAppWindowRoute(value: unknown): value is string {
	return isRestorableDesktopRoutePath(value) && !isReservedLocalAppProxyPath(value.split(/[?#]/u)[0]);
}

export function forkAppWindowUrl(route: string, appUrl: string): string | null {
	if (!isForkAppWindowRoute(route)) {
		return null;
	}
	let resolved: URL;
	try {
		resolved = new URL(route.replace(/^\/+/u, ''), appUrl);
	} catch {
		return null;
	}
	return resolved.href.startsWith(appUrl) ? resolved.href : null;
}

export function forkAppWindowRouteFromUrl(url: string, appUrl: string): string | null {
	if (!url.startsWith(appUrl)) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const route = `${parsed.pathname}${parsed.search}`;
	return isForkAppWindowRoute(route) ? route : null;
}

function readInteger(value: unknown, min: number, max: number): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return null;
	}
	const rounded = Math.round(value);
	return rounded < min || rounded > max ? null : rounded;
}

// App windows have no minimum size, so a window can be saved smaller than is usable.
function readSize(value: unknown): number | null {
	const size = readInteger(value, 1, WINDOW_SIZE_MAX);
	return size == null ? null : Math.max(WINDOW_SIZE_MIN, size);
}

function readBounds(value: unknown): ForkWindowBounds | null {
	if (value == null || typeof value !== 'object') {
		return null;
	}
	const record = value as Record<string, unknown>;
	const x = readInteger(record.x, -WINDOW_POSITION_MAX, WINDOW_POSITION_MAX);
	const y = readInteger(record.y, -WINDOW_POSITION_MAX, WINDOW_POSITION_MAX);
	const width = readSize(record.width);
	const height = readSize(record.height);
	if (x == null || y == null || width == null || height == null) {
		return null;
	}
	return {x, y, width, height};
}

function readEntry(value: unknown): ForkWindowSessionEntry | null {
	if (value == null || typeof value !== 'object') {
		return null;
	}
	const record = value as Record<string, unknown>;
	const bounds = readBounds(record.bounds);
	if (bounds == null) {
		return null;
	}
	const isMainWindow = record.isMainWindow === true;
	const route = isForkAppWindowRoute(record.route) ? record.route : null;
	if (route == null && !isMainWindow) {
		return null;
	}
	return {
		route,
		bounds,
		isMaximized: record.isMaximized === true,
		isMainWindow,
		isFocused: record.isFocused === true,
	};
}

// Reads a saved layout. Anything that is not a usable window is dropped, so a damaged or
// hand-edited file can cost windows but can never open one somewhere it should not be.
export function parseForkWindowSession(raw: string): Array<ForkWindowSessionEntry> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (parsed == null || typeof parsed !== 'object') {
		return [];
	}
	const document = parsed as {version?: unknown; windows?: unknown};
	if (document.version !== SESSION_VERSION || !Array.isArray(document.windows)) {
		return [];
	}
	const entries: Array<ForkWindowSessionEntry> = [];
	let hasMainWindow = false;
	let extraWindows = 0;
	for (const candidate of document.windows) {
		const entry = readEntry(candidate);
		if (entry == null) {
			continue;
		}
		if (entry.isMainWindow) {
			if (hasMainWindow) continue;
			hasMainWindow = true;
		} else {
			if (extraWindows >= FORK_EXTRA_APP_WINDOWS_MAX) continue;
			extraWindows += 1;
		}
		entries.push(entry);
	}
	return entries;
}

export function serializeForkWindowSession(entries: ReadonlyArray<ForkWindowSessionEntry>): string {
	return JSON.stringify({version: SESSION_VERSION, windows: entries});
}

export function planForkWindowRestore(entries: ReadonlyArray<ForkWindowSessionEntry>): ForkWindowRestorePlan {
	const extraWindows: Array<ForkWindowSessionEntry> = [];
	const stackingOrder: Array<number | 'main'> = [];
	let focused: number | 'main' | null = null;
	for (const entry of entries) {
		const position = entry.isMainWindow ? 'main' : extraWindows.push(entry) - 1;
		stackingOrder.push(position);
		if (entry.isFocused) {
			focused = position;
		}
	}
	if (!stackingOrder.includes('main')) {
		stackingOrder.unshift('main');
	}
	return {extraWindows, stackingOrder, focused: focused ?? stackingOrder[stackingOrder.length - 1]};
}

function overlapsEnough(bounds: ForkWindowBounds, area: ForkWindowBounds): boolean {
	const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
	const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
	return overlapWidth >= VISIBLE_MARGIN && overlapHeight >= VISIBLE_MARGIN;
}

// Keeps a window where it was saved if enough of it is still on a connected display, and
// otherwise moves it onto the first display (a monitor may have been unplugged since).
export function fitForkWindowBounds(
	bounds: ForkWindowBounds,
	workAreas: ReadonlyArray<ForkWindowBounds>,
): ForkWindowBounds {
	if (workAreas.length === 0 || workAreas.some((area) => overlapsEnough(bounds, area))) {
		return bounds;
	}
	const area = workAreas[0];
	return {
		x: area.x + CASCADE_OFFSET,
		y: area.y + CASCADE_OFFSET,
		width: Math.max(WINDOW_SIZE_MIN, Math.min(bounds.width, area.width - 2 * CASCADE_OFFSET)),
		height: Math.max(WINDOW_SIZE_MIN, Math.min(bounds.height, area.height - 2 * CASCADE_OFFSET)),
	};
}

// Where a new window opened from an existing one goes: the same size, stepped down and right,
// wrapping back to the top left of the display when it would run off the edge.
export function cascadeForkWindowBounds(reference: ForkWindowBounds, workArea: ForkWindowBounds): ForkWindowBounds {
	const width = Math.max(WINDOW_SIZE_MIN, Math.min(reference.width, workArea.width));
	const height = Math.max(WINDOW_SIZE_MIN, Math.min(reference.height, workArea.height));
	let x = reference.x + CASCADE_OFFSET;
	let y = reference.y + CASCADE_OFFSET;
	if (x + width > workArea.x + workArea.width) {
		x = workArea.x;
	}
	if (y + height > workArea.y + workArea.height) {
		y = workArea.y;
	}
	return {x: Math.max(workArea.x, x), y: Math.max(workArea.y, y), width, height};
}
