// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	type GuildSignalBarSettings,
	resolveSignalBarEnabled,
} from '@fluxer/schema/src/domains/signal_bar/SignalBarSchemas';

export interface SignalBarTreeChannel {
	id: string;
	name: string;
}

export interface SignalBarTreeCategory {
	id: string;
	name: string;
	channels: ReadonlyArray<SignalBarTreeChannel>;
}

/** The community's text channels: uncategorised ones first, then each category. */
export interface SignalBarTree {
	channels: ReadonlyArray<SignalBarTreeChannel>;
	categories: ReadonlyArray<SignalBarTreeCategory>;
}

export type SignalBarCheckState = 'on' | 'off' | 'mixed';

interface TreeSourceChannel {
	id: string;
	name?: string;
	type: number;
	position?: number;
	parentId: string | null;
}

const CATEGORY_TYPE = 4;
const TEXT_TYPES = new Set([0, 5]);

export function buildSignalBarTree(source: ReadonlyArray<TreeSourceChannel>): SignalBarTree {
	const byPosition = (a: TreeSourceChannel, b: TreeSourceChannel) =>
		(a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id);
	const text = source.filter((channel) => TEXT_TYPES.has(channel.type)).sort(byPosition);
	const categories = source.filter((channel) => channel.type === CATEGORY_TYPE).sort(byPosition);
	const categoryIds = new Set(categories.map((category) => category.id));
	const toNode = (channel: TreeSourceChannel): SignalBarTreeChannel => ({id: channel.id, name: channel.name ?? ''});
	return {
		channels: text.filter((channel) => channel.parentId === null || !categoryIds.has(channel.parentId)).map(toNode),
		categories: categories.map((category) => ({
			id: category.id,
			name: category.name ?? '',
			channels: text.filter((channel) => channel.parentId === category.id).map(toNode),
		})),
	};
}

function combine(states: ReadonlyArray<boolean>, whenEmpty: boolean): SignalBarCheckState {
	if (states.length === 0) return whenEmpty ? 'on' : 'off';
	if (states.every(Boolean)) return 'on';
	return states.some(Boolean) ? 'mixed' : 'off';
}

export function channelState(settings: GuildSignalBarSettings, channelId: string, categoryId: string | null): boolean {
	return resolveSignalBarEnabled(settings, channelId, categoryId);
}

export function categoryState(settings: GuildSignalBarSettings, category: SignalBarTreeCategory): SignalBarCheckState {
	return combine(
		category.channels.map((channel) => channelState(settings, channel.id, category.id)),
		settings.categories[category.id] ?? settings.default,
	);
}

export function rootState(settings: GuildSignalBarSettings, tree: SignalBarTree): SignalBarCheckState {
	const states = [
		...tree.channels.map((channel) => channelState(settings, channel.id, null)),
		...tree.categories.map((category) => categoryState(settings, category)),
	];
	if (states.length === 0) return settings.default ? 'on' : 'off';
	if (states.every((state) => state === true || state === 'on')) return 'on';
	if (states.every((state) => state === false || state === 'off')) return 'off';
	return 'mixed';
}

/**
 * Folds settings into the smallest form that shows the same ticks: a category whose
 * channels all agree becomes a category default, and a community where everything
 * agrees becomes the community default. Defaults are what new channels inherit.
 */
function normalize(settings: GuildSignalBarSettings, tree: SignalBarTree): GuildSignalBarSettings {
	const next: GuildSignalBarSettings = {
		default: settings.default,
		categories: {...settings.categories},
		channels: {...settings.channels},
	};
	for (const category of tree.categories) {
		const state = categoryState(next, category);
		if (state === 'mixed') continue;
		next.categories[category.id] = state === 'on';
		for (const channel of category.channels) delete next.channels[channel.id];
	}
	const root = rootState(next, tree);
	if (root !== 'mixed') return {default: root === 'on', categories: {}, channels: {}};
	for (const [id, value] of Object.entries(next.categories)) {
		if (value === next.default) delete next.categories[id];
	}
	for (const category of tree.categories) {
		for (const channel of category.channels) {
			const inherited = next.categories[category.id] ?? next.default;
			if (next.channels[channel.id] === inherited) delete next.channels[channel.id];
		}
	}
	for (const channel of tree.channels) {
		if (next.channels[channel.id] === next.default) delete next.channels[channel.id];
	}
	return next;
}

export function setRoot(_settings: GuildSignalBarSettings, enabled: boolean): GuildSignalBarSettings {
	return {default: enabled, categories: {}, channels: {}};
}

export function setCategory(
	settings: GuildSignalBarSettings,
	tree: SignalBarTree,
	categoryId: string,
	enabled: boolean,
): GuildSignalBarSettings {
	const category = tree.categories.find((candidate) => candidate.id === categoryId);
	const channels = {...settings.channels};
	for (const channel of category?.channels ?? []) delete channels[channel.id];
	return normalize(
		{default: settings.default, categories: {...settings.categories, [categoryId]: enabled}, channels},
		tree,
	);
}

export function setChannel(
	settings: GuildSignalBarSettings,
	tree: SignalBarTree,
	channelId: string,
	enabled: boolean,
): GuildSignalBarSettings {
	return normalize(
		{
			default: settings.default,
			categories: {...settings.categories},
			channels: {...settings.channels, [channelId]: enabled},
		},
		tree,
	);
}
