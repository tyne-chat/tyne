// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import {
	buildActions,
	buildPreviewRequest,
	defaultDecision,
	findConflicts,
	picturesNeeded,
	type ReviewDecision,
	summarize,
} from '@app/features/persona/utils/PersonaImportReview';
import type {PersonaImportPreviewEntry} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import type {PluralKitImportedMember} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import {describe, expect, it} from 'vitest';

function pkMember(
	index: number,
	fields: Partial<PluralKitImportedMember> & {name: string | null},
): PluralKitImportedMember {
	return {
		index,
		id: null,
		color: null,
		pronouns: null,
		bio: null,
		personaTags: [],
		droppedTagCount: 0,
		visibility: 'public',
		avatarUrl: null,
		avatarOrigin: null,
		bannerUrl: null,
		...fields,
	};
}

function pkSource(members: Array<PluralKitImportedMember>, tag: string | null = null): PersonaImportSource {
	return {kind: 'pluralkit', system: {name: 'The Lantern Collective', tag, members}};
}

const MEDIA = 'https://media.tyne.example';

describe('the preview request', () => {
	it("leaves out unnamed members, sends own-media links as hashes, and takes the system's tag, never its name", () => {
		const {request, members} = buildPreviewRequest(
			pkSource([
				pkMember(0, {name: 'Wren', id: 'aaaaa', avatarUrl: `${MEDIA}/avatars/42/0a1b2c3d.png`}),
				pkMember(1, {name: null}),
				pkMember(2, {name: 'Pip', avatarUrl: 'https://cdn.example/pip.png'}),
			]),
			'42',
			MEDIA,
		);
		expect(members.map((m) => m.member.name)).toEqual(['Wren', 'Pip']);
		expect(request.members[0]?.avatar).toEqual({url: `${MEDIA}/avatars/42/0a1b2c3d.png`, hash: '0a1b2c3d'});
		expect(request.members[1]?.avatar).toEqual({url: 'https://cdn.example/pip.png'});
		expect(request.display_tag).toBeNull();
		expect(buildPreviewRequest(pkSource([], '[ Lantern ]'), '42', MEDIA).request.display_tag).toEqual({
			text: '[ Lantern ]',
			has_icon: false,
		});
	});
});

describe('decisions', () => {
	const entries: Array<PersonaImportPreviewEntry> = [
		{index: 0, kind: 'up_to_date', persona_id: '1'},
		{index: 1, kind: 'differs', persona_id: '2'},
		{index: 2, kind: 'deleted', persona_id: '3'},
		{index: 3, kind: 'probably_same', persona_id: '4'},
		{index: 4, kind: 'cant_tell', candidates: []},
		{index: 5, kind: 'tag_in_use'},
		{index: 6, kind: 'new'},
	];

	it('start on the safest choice for every kind', () => {
		expect(entries.map((entry) => defaultDecision(entry))).toEqual([
			{choice: 'keep'},
			{choice: 'keep'},
			{choice: 'keep'},
			{choice: 'link', personaId: '4'},
			{choice: 'skip'},
			{choice: 'skip'},
			{choice: 'add', withTags: true},
		]);
	});

	it('add up to the footer summary as the choices change', () => {
		expect(summarize(entries, new Map())).toEqual({
			link: 1,
			add: 1,
			restore: 0,
			useFile: 0,
			skip: 2,
			kept: 2,
			stayDeleted: 1,
		});
		const changed = new Map<number, ReviewDecision>([
			[1, {choice: 'use_file'}],
			[2, {choice: 'restore'}],
		]);
		expect(summarize(entries, changed)).toMatchObject({useFile: 1, restore: 1, kept: 1, stayDeleted: 0});
	});
});

describe('clashes between choices', () => {
	it("finds a linked persona taking the file's tag while a new member with the same tag is added", () => {
		const {members} = buildPreviewRequest(
			pkSource([
				pkMember(0, {name: 'Wren', id: 'aaaaa', personaTags: [{prefix: 'x:'}]}),
				pkMember(1, {name: 'Xan', personaTags: [{prefix: 'x:'}]}),
			]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [
			{index: 0, kind: 'differs', persona_id: 'p1'},
			{index: 1, kind: 'new'},
		];
		const live = [{id: 'p1', name: 'Wren', persona_tags: [{prefix: 'w:'}], signature_emojis: []}];
		expect(findConflicts(entries, new Map(), members, live, false)).toEqual([]);
		expect(findConflicts(entries, new Map([[0, {choice: 'use_file'}]]), members, live, false)).toEqual([
			{label: 'x:text', names: ['Wren', 'Xan']},
		]);
	});

	it('leaves out the tags another persona holds when a member is added separately', () => {
		const {members} = buildPreviewRequest(
			pkSource([pkMember(0, {name: 'Kestrel', personaTags: [{prefix: 'ke:'}]})]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [
			{index: 0, kind: 'probably_same', persona_id: 'p1', clashes: [{tag: {prefix: 'ke:'}, held_by_persona_id: 'p1'}]},
		];
		const live = [{id: 'p1', name: 'Kestrel', persona_tags: [{prefix: 'ke:'}], signature_emojis: []}];
		const add = new Map<number, ReviewDecision>([[0, {choice: 'add', withTags: false}]]);
		expect(findConflicts(entries, add, members, live, false)).toEqual([]);
		expect(buildActions(entries, add, members, new Map())[0]).toMatchObject({
			action: 'add',
			drop_tags: [{prefix: 'ke:'}],
		});
	});
});

describe('pictures and actions', () => {
	const {members} = buildPreviewRequest(
		pkSource([
			pkMember(0, {name: 'Same', id: 'aaaaa', avatarUrl: 'https://cdn.example/a.png'}),
			pkMember(1, {name: 'Changed', id: 'bbbbb', avatarUrl: 'https://cdn.example/b.png'}),
			pkMember(2, {name: 'Gone', id: 'ccccc'}),
		]),
		'42',
		MEDIA,
	);
	const entries: Array<PersonaImportPreviewEntry> = [
		{index: 0, kind: 'differs', persona_id: 'p0', differences: [{field: 'bio', change: 'changed'}]},
		{index: 1, kind: 'differs', persona_id: 'p1', differences: [{field: 'avatar', change: 'changed'}]},
		{index: 2, kind: 'differs', persona_id: 'p2', differences: [{field: 'avatar', change: 'removed'}]},
	];
	const useFile = new Map<number, ReviewDecision>(entries.map((entry) => [entry.index, {choice: 'use_file'}]));

	it("stores only the pictures that change, and keeps a picture that's the same or failed", () => {
		expect(entries.map((entry) => picturesNeeded(entry, {choice: 'use_file'}).avatar)).toEqual([false, true, false]);
		const actions = buildActions(
			entries,
			useFile,
			members,
			new Map([[1, {images: {avatar: null, banner: null}, avatarFailed: true, bannerFailed: false}]]),
		);
		expect(actions.map((action) => action.keep_avatar)).toEqual([true, true, false]);
		// The persona whose file has no picture loses it, as its row said ("removes avatar").
		expect(actions[2]?.item?.avatar_hash ?? null).toBeNull();
	});

	it('sends nothing for kept, skipped and deleted-and-left members', () => {
		expect(buildActions(entries, new Map(), members, new Map())).toEqual([]);
	});
});
