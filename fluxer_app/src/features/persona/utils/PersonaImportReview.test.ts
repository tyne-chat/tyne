// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import {
	addedTags,
	buildActions,
	buildPreviewRequest,
	defaultDecision,
	findConflicts,
	parseTagInput,
	picturesNeeded,
	type ReviewDecision,
	reviewNeedCount,
	suggestTag,
	summarize,
	tagHolder,
	tagInputText,
} from '@app/features/persona/utils/PersonaImportReview';
import {
	PersonaImportActionSchema,
	type PersonaImportPreviewEntry,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
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

describe('a tag of its own for a clashing member', () => {
	const takenFrom =
		(...taken: Array<string>) =>
		(tag: {prefix?: string | null; suffix?: string | null}) =>
			taken.includes(`${tag.prefix ?? ''}text${tag.suffix ?? ''}`);

	it('suggests more of the name in the same style until one is free', () => {
		expect(suggestTag({prefix: 'ly:'}, 'Lyra ✧', takenFrom())).toEqual({prefix: 'lyr:'});
		expect(suggestTag({prefix: 'ly:'}, 'Lyra ✧', takenFrom('lyr:text'))).toEqual({prefix: 'lyra:'});
		expect(suggestTag({prefix: 'ly:'}, 'Lyra ✧', takenFrom('lyr:text', 'lyra:text'))).toEqual({prefix: 'lyra2:'});
	});

	it('keeps a capital, a suffix tag and the punctuation around the letters', () => {
		expect(suggestTag({prefix: 'Ly:'}, 'Lyra', takenFrom())).toEqual({prefix: 'Lyr:'});
		expect(suggestTag({prefix: '', suffix: '-w2'}, 'Wren', takenFrom())).toEqual({suffix: '-wre'});
		expect(suggestTag({prefix: '{ly'}, 'Lyra', takenFrom())).toEqual({prefix: '{lyr'});
	});

	it('gives a tag with no letters a plain prefix from the name', () => {
		expect(suggestTag({prefix: '[', suffix: ']'}, 'Moss 🌿', takenFrom())).toEqual({prefix: 'm:'});
	});

	it('sends a tag typed or suggested in the field as the API takes it, without an empty side', () => {
		const {members} = buildPreviewRequest(
			pkSource([pkMember(0, {name: 'Yael', personaTags: [{prefix: 'ya:'}]})]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [
			{index: 0, kind: 'cant_tell', clashes: [{tag: {prefix: 'ya:'}, held_by_persona_id: 'p1'}]},
		];
		for (const typed of ['yae:', ' yae: ', '[text]', 'text-y']) {
			const decision: ReviewDecision = {choice: 'add', withTags: false, replacements: [parseTagInput(typed)]};
			const [action] = buildActions(entries, new Map([[0, decision]]), members, new Map());
			expect(PersonaImportActionSchema.safeParse(action).success, typed).toBe(true);
		}
		const suggested = suggestTag({prefix: 'ya:'}, 'Yael', () => false)!;
		const decision: ReviewDecision = {choice: 'add', withTags: false, replacements: [suggested]};
		const [action] = buildActions(entries, new Map([[0, decision]]), members, new Map());
		expect(action?.item?.persona_tags).toEqual([{prefix: 'yae:'}]);
		expect(PersonaImportActionSchema.safeParse(action).success).toBe(true);
	});

	it('reads and shows a tag in one field', () => {
		expect(parseTagInput(' lyr: ')).toEqual({prefix: 'lyr:'});
		expect(parseTagInput('[text]')).toEqual({prefix: '[', suffix: ']'});
		expect(tagInputText({prefix: 'lyr:'})).toBe('lyr:');
		expect(tagInputText({prefix: '[', suffix: ']'})).toBe('[text]');
	});

	it('adds the member with the new tag in place of the taken one, and finds who holds a tag', () => {
		const {members} = buildPreviewRequest(
			pkSource([
				pkMember(0, {name: 'Lyra ✧', personaTags: [{prefix: 'ly:'}, {prefix: 'lyra:'}]}),
				pkMember(1, {name: 'Moth', personaTags: [{prefix: 'mo:'}]}),
			]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [
			{index: 0, kind: 'tag_in_use', clashes: [{tag: {prefix: 'ly:'}, held_by_persona_id: 'p1'}]},
			{index: 1, kind: 'new'},
		];
		const live = [{id: 'p1', name: 'Lyra ✦', persona_tags: [{prefix: 'ly:'}], signature_emojis: []}];
		const decision: ReviewDecision = {choice: 'add', withTags: false, replacements: [{prefix: 'lyr:'}]};
		const decisions = new Map<number, ReviewDecision>([[0, decision]]);

		expect(addedTags(entries[0]!, decision, [{prefix: 'ly:'}, {prefix: 'lyra:'}])).toEqual([
			{prefix: 'lyra:'},
			{prefix: 'lyr:'},
		]);
		const [action] = buildActions(entries, decisions, members, new Map());
		expect(action).toMatchObject({action: 'add', item: {name: 'Lyra ✧'}});
		expect(action?.item?.persona_tags).toEqual([{prefix: 'lyra:'}, {prefix: 'lyr:'}]);
		expect(action).not.toHaveProperty('drop_tags');
		expect(findConflicts(entries, decisions, members, live, false)).toEqual([]);
		// The action passes the API's own schema: an empty tag side used to go out as "" and the whole
		// import was refused with "Invalid form body".
		expect(PersonaImportActionSchema.safeParse(action).success).toBe(true);

		expect(tagHolder({prefix: 'ly:'}, 0, entries, decisions, members, live, false)).toBe('Lyra ✦');
		expect(tagHolder({prefix: 'mo:'}, 0, entries, decisions, members, live, false)).toBe('Moth');
		expect(tagHolder({prefix: 'lyr:'}, 0, entries, decisions, members, live, false)).toBeNull();
		// Moth's field would see Lyra ✧'s new tag as taken.
		expect(tagHolder({prefix: 'lyr:'}, 1, entries, decisions, members, live, false)).toBe('Lyra ✧');
	});

	it('counts only the members that need a choice for the title', () => {
		const entries: Array<PersonaImportPreviewEntry> = [
			{index: 0, kind: 'cant_tell'},
			{index: 1, kind: 'tag_in_use'},
			{index: 2, kind: 'differs'},
			{index: 3, kind: 'deleted'},
			{index: 4, kind: 'probably_same'},
			{index: 5, kind: 'new'},
			{index: 6, kind: 'up_to_date'},
		];
		expect(reviewNeedCount(entries)).toBe(4);
	});
});
