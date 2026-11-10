// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaImportSource} from '@app/features/persona/utils/PersonaImportFile';
import {
	addedTags,
	buildActions,
	buildPreviewRequest,
	copyName,
	defaultDecision,
	findConflicts,
	keepBothDecision,
	parseTagInput,
	picturesNeeded,
	type ReviewDecision,
	reviewNeedCount,
	samePictureFile,
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
		// Then the tag being replaced, with a number.
		expect(suggestTag({prefix: 'ly:'}, 'Lyra ✧', takenFrom('lyr:text', 'lyra:text'))).toEqual({prefix: 'ly2:'});
		expect(suggestTag({prefix: 'ly:'}, 'Lyra ✧', takenFrom('lyr:text', 'lyra:text', 'ly2:text'))).toEqual({
			prefix: 'ly3:',
		});
	});

	it('takes from the name only letters anyone can type', () => {
		expect(suggestTag({prefix: 'zo:'}, 'Zoë', takenFrom())).toEqual({prefix: 'zoe:'});
		expect(suggestTag({prefix: 'sa:'}, 'S𐒰TVRN 𓆩♅𓆪', takenFrom())).toEqual({prefix: 'stv:'});
		// A name with no such letters goes straight to the numbered tag; so does a capital one.
		expect(suggestTag({prefix: 'mi:'}, 'ミク', takenFrom())).toEqual({prefix: 'mi2:'});
		expect(suggestTag({prefix: 'Mi:'}, 'ミク', takenFrom('Mi2:text'))).toEqual({prefix: 'Mi3:'});
		// The tag's own punctuation stays: it is the one already typed.
		expect(suggestTag({prefix: '✦ly:'}, 'Lyra', takenFrom())).toEqual({prefix: '✦lyr:'});
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

describe('keeping both versions of a differing persona', () => {
	it('names the copy as a file manager names a copy, within the longest name the API takes', () => {
		const taken =
			(...names: Array<string>) =>
			(name: string) =>
				names.includes(name);
		expect(copyName('Wren', taken())).toBe('Wren');
		expect(copyName('Wren', taken('Wren'))).toBe('Wren (2)');
		expect(copyName('Wren', taken('Wren', 'Wren (2)'))).toBe('Wren (3)');
		const long = 'W'.repeat(100);
		expect(copyName(long, taken(long))).toBe(`${'W'.repeat(96)} (2)`);
	});

	// The API counts UTF-16 code units, where 🌙 is two (tyne-chat/tyne#601).
	it('keeps the copy within the limit as the API counts it, without cutting a character', () => {
		const moons = '🌙'.repeat(50);
		const flagged = `${'W'.repeat(92)}🏳️‍🌈`;
		const taken = (name: string) => name === moons || name === flagged;
		const copy = copyName(moons, taken);
		expect(copy).toBe(`${'🌙'.repeat(48)} (2)`);
		expect(copy.length).toBe(100);
		expect(copyName(flagged, taken)).toBe(`${'W'.repeat(92)} (2)`);
	});

	it("adds the file's version unlinked, renamed and with a free tag, and leaves Tyne's as it is", () => {
		const {members} = buildPreviewRequest(
			pkSource([pkMember(0, {name: 'Wren', id: 'aaaaa', bio: 'Keeps the log.', personaTags: [{prefix: 'wr:'}]})]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [
			{index: 0, kind: 'differs', persona_id: 'p1', differences: [{field: 'bio', change: 'changed'}]},
		];
		const live = [
			{id: 'p1', name: 'Wren', persona_tags: [{prefix: 'wr:'}], signature_emojis: []},
			{id: 'p2', name: 'Wren (2)', persona_tags: [{prefix: 'wre:'}], signature_emojis: []},
		];
		const decision = keepBothDecision(entries[0]!, entries, new Map(), members, live, false);
		expect(decision).toEqual({
			choice: 'add',
			withTags: true,
			replacements: [{prefix: 'wren:'}],
			copy: {name: 'Wren (3)', replacedTags: [{prefix: 'wr:'}], droppedEmojis: []},
		});

		const decisions = new Map<number, ReviewDecision>([[0, decision]]);
		const actions = buildActions(entries, decisions, members, new Map());
		// One action: the copy is added; Tyne's Wren gets none, so it stays as it is and keeps the link.
		expect(actions).toHaveLength(1);
		expect(actions[0]).toMatchObject({
			action: 'add',
			item: {name: 'Wren (3)', bio: 'Keeps the log.', persona_tags: [{prefix: 'wren:'}], external_uuid: null},
		});
		expect(actions[0]).not.toHaveProperty('drop_tags');
		expect(PersonaImportActionSchema.safeParse(actions[0]).success).toBe(true);
		expect(findConflicts(entries, decisions, members, live, false)).toEqual([]);
		expect(summarize(entries, decisions)).toMatchObject({add: 1, kept: 0, useFile: 0});

		// A tag typed over the suggestion that Tyne's Wren has is a clash again.
		if (decision.choice !== 'add') throw new Error('Keep both is an add');
		const clashing = new Map<number, ReviewDecision>([[0, {...decision, replacements: [{prefix: 'wr:'}]}]]);
		expect(findConflicts(entries, clashing, members, live, false)).toEqual([
			{label: 'wr:text', names: ['Wren', 'Wren (3)']},
		]);
	});

	it('keeps a member whose tag is taken as a new persona linked to its member, with a free tag', () => {
		const {members} = buildPreviewRequest(
			pkSource([pkMember(0, {name: 'Lyra ✧', id: 'ccccc', personaTags: [{prefix: 'ly:'}]})]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [
			{index: 0, kind: 'tag_in_use', clashes: [{tag: {prefix: 'ly:'}, held_by_persona_id: 'p1'}]},
		];
		const live = [{id: 'p1', name: 'Lyra ✦', persona_tags: [{prefix: 'ly:'}], signature_emojis: []}];
		const decision = keepBothDecision(entries[0]!, entries, new Map(), members, live, false, true);
		expect(decision).toMatchObject({
			replacements: [{prefix: 'lyr:'}],
			copy: {name: 'Lyra ✧', replacedTags: [{prefix: 'ly:'}], linked: true},
		});
		const [action] = buildActions(entries, new Map([[0, decision]]), members, new Map());
		expect(action).toMatchObject({
			action: 'add',
			item: {name: 'Lyra ✧', persona_tags: [{prefix: 'lyr:'}], external_uuid: 'ccccc'},
		});
		expect(PersonaImportActionSchema.safeParse(action).success).toBe(true);
	});

	it("leaves off the signature emojis Tyne's version keeps, for a Tyne export", () => {
		const emoji = {name: '🕯️'};
		const {members} = buildPreviewRequest(
			pkSource([pkMember(0, {name: 'Wren', id: 'aaaaa', personaTags: []})]),
			'42',
			MEDIA,
		);
		members[0]!.preview.signature_emojis = [emoji];
		const entries: Array<PersonaImportPreviewEntry> = [{index: 0, kind: 'differs', persona_id: 'p1'}];
		const live = [{id: 'p1', name: 'Wren', persona_tags: [], signature_emojis: [emoji]}];
		const decision = keepBothDecision(entries[0]!, entries, new Map(), members, live, true);
		expect(decision).toMatchObject({copy: {name: 'Wren (2)', replacedTags: [], droppedEmojis: [emoji]}});
		const [action] = buildActions(entries, new Map([[0, decision]]), members, new Map());
		expect(action).toMatchObject({action: 'add', drop_signature_emojis: [emoji]});
		expect(findConflicts(entries, new Map([[0, decision]]), members, live, true)).toEqual([]);
	});
});

describe('a member that might be one of the personas', () => {
	const setup = () => {
		const {members} = buildPreviewRequest(
			pkSource([
				pkMember(0, {
					name: 'Lily & Lisica',
					id: 'lllll',
					personaTags: [{prefix: 'Lils:'}],
					avatarUrl: 'https://temple.example/media/avatars/1523/0a1b2c3d.png',
				}),
			]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [
			{
				index: 0,
				kind: 'cant_tell',
				candidates: [{persona_id: '100000000000000001', matched_on: 'tag', linked_elsewhere: false}],
				avatar_hash: 'd2e533ce',
			},
		];
		const live = [
			{id: '100000000000000001', name: 'Lisica & Lily', persona_tags: [{prefix: 'Lils:'}], signature_emojis: []},
		];
		const pictures = [{id: '100000000000000001', avatar_hash: '0a1b2c3d', banner_hash: null}];
		return {members, entries, live, pictures};
	};

	it("connects the picked persona as it is with Use Tyne's", () => {
		const {members, entries, pictures} = setup();
		const decisions = new Map<number, ReviewDecision>([[0, {choice: 'link', personaId: '100000000000000001'}]]);
		expect(buildActions(entries, decisions, members, new Map(), pictures)).toEqual([
			{action: 'link', persona_id: '100000000000000001', external_uuid: 'lllll'},
		]);
	});

	it("takes the file's version into the picked persona, keeping a picture that is the same file", () => {
		const {members, entries, live, pictures} = setup();
		const decisions = new Map<number, ReviewDecision>([[0, {choice: 'use_file', personaId: '100000000000000001'}]]);
		const stored = new Map([
			[
				0,
				{
					images: {avatar: {hash: 'd2e533ce', avatarColor: null}, banner: null},
					avatarFailed: false,
					bannerFailed: false,
				},
			],
		]);
		const [action] = buildActions(entries, decisions, members, stored, pictures);
		// The link names 0a1b2c3d, the picture the persona has: it stays (exactly the same file).
		expect(action).toMatchObject({
			action: 'use_file',
			persona_id: '100000000000000001',
			keep_avatar: true,
			item: {name: 'Lily & Lisica', external_uuid: 'lllll'},
		});
		expect(PersonaImportActionSchema.safeParse(action).success).toBe(true);
		expect(findConflicts(entries, decisions, members, live, false)).toEqual([]);
		// Another picture is taken from the file.
		const [other] = buildActions(entries, decisions, members, stored, [{...pictures[0]!, avatar_hash: '99999999'}]);
		expect(other).toMatchObject({keep_avatar: false, item: {avatar_hash: 'd2e533ce'}});
		// One that could not be stored leaves the persona's as it is.
		const failed = new Map([[0, {images: {avatar: null, banner: null}, avatarFailed: true, bannerFailed: false}]]);
		const [kept] = buildActions(entries, decisions, members, failed, [{...pictures[0]!, avatar_hash: '99999999'}]);
		expect(kept).toMatchObject({keep_avatar: true, keep_banner: false});
	});

	it('keeps both: connects the picked persona as it is and adds the copy unlinked, with a free tag', () => {
		const {members, entries, live, pictures} = setup();
		const kept = keepBothDecision(entries[0]!, entries, new Map(), members, live, false);
		if (kept.choice !== 'add' || !kept.copy) throw new Error('Keep both is an add with a copy');
		const decisions = new Map<number, ReviewDecision>([
			[0, {...kept, copy: {...kept.copy, connectTo: '100000000000000001'}}],
		]);
		const actions = buildActions(entries, decisions, members, new Map(), pictures);
		expect(actions[0]).toEqual({action: 'link', persona_id: '100000000000000001', external_uuid: 'lllll'});
		expect(actions[1]).toMatchObject({action: 'add', item: {name: 'Lily & Lisica', external_uuid: null}});
		expect(actions[1]?.item?.persona_tags).not.toContainEqual({prefix: 'Lils:'});
		expect(findConflicts(entries, decisions, members, live, false)).toEqual([]);
	});
});

describe('a member whose persona was deleted', () => {
	const setup = () => {
		const {members} = buildPreviewRequest(
			pkSource([pkMember(0, {name: 'Pip', id: 'ppppp', bio: 'From the file', personaTags: [{prefix: 'pi:'}]})]),
			'42',
			MEDIA,
		);
		const entries: Array<PersonaImportPreviewEntry> = [{index: 0, kind: 'deleted', persona_id: '100000000000000003'}];
		const deleted = {
			id: '100000000000000003',
			name: 'Pip',
			persona_tags: [{prefix: 'pi:'}],
			signature_emojis: [],
			avatar_hash: null,
			banner_hash: null,
		};
		return {members, entries, deleted};
	};

	it("brings it back with the file's details in one action", () => {
		const {members, entries, deleted} = setup();
		const decisions = new Map<number, ReviewDecision>([[0, {choice: 'use_file', personaId: deleted.id}]]);
		const [action] = buildActions(entries, decisions, members, new Map(), [deleted]);
		expect(action).toMatchObject({
			action: 'use_file',
			persona_id: deleted.id,
			item: {name: 'Pip', bio: 'From the file', external_uuid: 'ppppp'},
		});
		expect(PersonaImportActionSchema.safeParse(action).success).toBe(true);
	});

	it('keeps both: brings it back as it was and adds the copy with a name and tag the deleted one does not have', () => {
		const {members, entries, deleted} = setup();
		const kept = keepBothDecision(entries[0]!, entries, new Map(), members, [], false, false, deleted);
		if (kept.choice !== 'add' || !kept.copy) throw new Error('Keep both is an add with a copy');
		expect(kept.copy).toMatchObject({name: 'Pip (2)', replacedTags: [{prefix: 'pi:'}]});
		const decisions = new Map<number, ReviewDecision>([[0, {...kept, copy: {...kept.copy, restore: deleted.id}}]]);
		const actions = buildActions(entries, decisions, members, new Map(), [deleted]);
		expect(actions[0]).toEqual({action: 'restore', persona_id: deleted.id});
		expect(actions[1]).toMatchObject({action: 'add', item: {name: 'Pip (2)', external_uuid: null}});
		expect(actions[1]?.item?.persona_tags).not.toContainEqual({prefix: 'pi:'});
	});
});

describe('the same picture file', () => {
	it('matches by the hash a Tyne media link names or the stored copy, an animated one included, and nothing else', () => {
		const {members} = buildPreviewRequest(
			pkSource([
				pkMember(0, {
					name: 'Aurora',
					avatarUrl: 'https://temple.example/media/avatars/1523/a_7b6aea26.gif',
					bannerUrl: 'https://cdn.example/banner.png',
				}),
			]),
			'42',
			MEDIA,
		);
		const entry: PersonaImportPreviewEntry = {
			index: 0,
			kind: 'differs',
			avatar_hash: 'd2e533ce',
			banner_hash: 'eeeeeee1',
		};
		expect(samePictureFile(members[0]!, entry, 'avatar', 'a_7b6aea26')).toBe(true);
		expect(samePictureFile(members[0]!, entry, 'avatar', '7b6aea26')).toBe(true);
		expect(samePictureFile(members[0]!, entry, 'avatar', 'd2e533ce')).toBe(true);
		expect(samePictureFile(members[0]!, entry, 'avatar', '7b6aea27')).toBe(false);
		expect(samePictureFile(members[0]!, entry, 'banner', 'eeeeeee1')).toBe(true);
		expect(samePictureFile(members[0]!, entry, 'banner', 'eeeeeee2')).toBe(false);
		expect(samePictureFile(members[0]!, entry, 'banner', null)).toBe(false);
	});
});
