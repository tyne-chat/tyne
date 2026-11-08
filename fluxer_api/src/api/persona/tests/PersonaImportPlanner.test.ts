// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: how the reviewed import classifies members (tyne-chat/tyne#243), on personas built in memory.

import {createPersonaID, createUserID} from '@app/api/BrandedTypes';
import type {PersonaImageSourceRow} from '@app/api/database/types/PersonaTypes';
import {Persona} from '@app/api/models/Persona';
import {type PersonaImportPlanInput, planPersonaImport} from '@app/api/persona/PersonaImportPlanner';
import type {PersonaTag, SignatureEmoji} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {PersonaImportPreviewMember} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {describe, expect, it} from 'vitest';

const OWNER = createUserID(1000n);
let nextId = 1n;

function persona(fields: {
	name: string;
	tags?: Array<PersonaTag>;
	external?: string | null;
	deletedAt?: Date | null;
	useCount?: number;
	bio?: string | null;
	pronouns?: string | null;
	avatar?: string | null;
	banner?: string | null;
	visibility?: 'public' | 'unlisted' | 'private';
	emojis?: Array<SignatureEmoji>;
	autoTagDisabled?: boolean;
}): Persona {
	const id = createPersonaID(nextId++);
	return new Persona({
		user_id: OWNER,
		persona_id: id,
		name: fields.name,
		avatar_hash: fields.avatar ?? null,
		banner_hash: fields.banner ?? null,
		pronouns: fields.pronouns ?? null,
		color: null,
		avatar_color: null,
		bio: fields.bio ?? null,
		auto_tag_disabled: fields.autoTagDisabled ?? false,
		persona_tags: JSON.stringify(fields.tags ?? []),
		signature_emojis: JSON.stringify(fields.emojis ?? []),
		use_count: fields.useCount ?? 0,
		last_used_at_ms: null,
		visibility: fields.visibility ?? 'unlisted',
		external_uuid: fields.external ?? null,
		created_at: new Date('2026-09-01T00:00:00Z'),
		updated_at: new Date('2026-09-01T00:00:00Z'),
		deleted_at: fields.deletedAt ?? null,
		version: 1,
	});
}

function member(fields: Partial<PersonaImportPreviewMember> & {name: string}): PersonaImportPreviewMember {
	return {persona_tags: [], ...fields};
}

function plan(
	personas: Array<Persona>,
	members: Array<PersonaImportPreviewMember>,
	extra: Partial<PersonaImportPlanInput> = {},
) {
	return planPersonaImport({
		source: 'pluralkit',
		members,
		live: personas.filter((p) => !p.isDeleted),
		deleted: personas.filter((p) => p.isDeleted),
		imageSources: new Map(),
		ownImageHash: () => null,
		...extra,
	});
}

function source(p: Persona, fields: Partial<PersonaImageSourceRow>): [string, PersonaImageSourceRow] {
	return [
		p.id.toString(),
		{
			user_id: OWNER,
			persona_id: p.id,
			avatar_field: 'avatar_url',
			avatar_main_empty: false,
			avatar_url: null,
			avatar_hash: null,
			banner_url: null,
			banner_hash: null,
			updated_at: new Date(),
			...fields,
		},
	];
}

describe('pass 1: the PluralKit id', () => {
	it('finds a linked persona identical to the member up to date, and one with other details different', () => {
		const same = persona({name: 'Wren', tags: [{prefix: 'wr:'}], external: 'aaaaa', bio: 'Writer.'});
		const changed = persona({name: 'Marlowe', external: 'bbbbb', bio: 'Old bio', pronouns: 'he/him'});
		const result = plan(
			[same, changed],
			[
				member({name: 'Wren', persona_tags: [{prefix: 'wr:'}], external_uuid: 'aaaaa', bio: 'Writer.'}),
				member({name: 'Marlowe K', external_uuid: 'bbbbb', bio: null, pronouns: 'he/him'}),
			],
		);
		expect(result.entries[0]).toMatchObject({kind: 'up_to_date', persona_id: same.id.toString(), differences: []});
		expect(result.entries[1]?.kind).toBe('differs');
		expect(result.entries[1]?.differences).toEqual([
			{field: 'name', change: 'changed'},
			{field: 'bio', change: 'removed'},
		]);
	});

	it('shows a visibility difference as information only, so the persona stays up to date', () => {
		const p = persona({name: 'Isolde', external: 'ccccc', visibility: 'private'});
		const result = plan([p], [member({name: 'Isolde', external_uuid: 'ccccc', visibility: 'public'})]);
		expect(result.entries[0]).toMatchObject({kind: 'up_to_date'});
		expect(result.entries[0]?.differences).toEqual([{field: 'visibility', change: 'info'}]);
	});

	it('compares pictures only where their origin is known', () => {
		const known = persona({name: 'A', external: 'aaaaa', avatar: 'aaaa0001'});
		const editedInTyne = persona({name: 'B', external: 'bbbbb', avatar: 'bbbb0002'});
		const unknown = persona({name: 'C', external: 'ccccc', avatar: 'cccc0003'});
		const removed = persona({name: 'D', external: 'ddddd', avatar: 'dddd0004'});
		const own = persona({name: 'E', external: 'eeeee', avatar: 'eeee0005'});
		const result = plan(
			[known, editedInTyne, unknown, removed, own],
			[
				member({name: 'A', external_uuid: 'aaaaa', avatar: {url: 'https://cdn.example/a.png'}}),
				member({name: 'B', external_uuid: 'bbbbb', avatar: {url: 'https://cdn.example/b.png'}}),
				member({name: 'C', external_uuid: 'ccccc', avatar: {url: 'https://cdn.example/c.png'}}),
				member({name: 'D', external_uuid: 'ddddd'}),
				member({name: 'E', external_uuid: 'eeeee', avatar: {url: 'https://media.tyne.example/own'}}),
			],
			{
				imageSources: new Map([
					source(known, {avatar_url: 'https://cdn.example/a.png', avatar_hash: 'aaaa0001'}),
					source(editedInTyne, {avatar_url: 'https://cdn.example/b.png', avatar_hash: 'ffff0009'}),
				]),
				ownImageHash: (url) => (url === 'https://media.tyne.example/own' ? 'eeee0005' : null),
			},
		);
		expect(result.entries.map((e) => e.kind)).toEqual(['up_to_date', 'differs', 'up_to_date', 'differs', 'up_to_date']);
		expect(result.entries[1]?.differences).toEqual([{field: 'avatar', change: 'changed'}]);
		expect(result.entries[1]?.avatar_hash).toBe('ffff0009');
		expect(result.entries[2]?.differences).toEqual([{field: 'avatar', change: 'not_compared'}]);
		expect(result.entries[2]?.avatar_hash).toBeNull();
		expect(result.entries[3]?.differences).toEqual([{field: 'avatar', change: 'removed'}]);
	});

	it('compares signature emojis and auto-tag only for a Tyne export', () => {
		const p = persona({name: 'Ash', external: 'aaaaa', emojis: [{name: '🌿'}], autoTagDisabled: true});
		const members = [member({name: 'Ash', external_uuid: 'aaaaa'})];
		expect(plan([p], members).entries[0]?.kind).toBe('up_to_date');
		const fromTyne = plan([p], members, {source: 'tyne'});
		expect(fromTyne.entries[0]?.kind).toBe('differs');
		expect(fromTyne.entries[0]?.differences).toEqual([
			{field: 'signature_emojis', change: 'removed'},
			{field: 'auto_tag_disabled', change: 'changed'},
		]);
	});

	it('finds a member linked only to deleted personas deleted in Tyne, choosing the most used', () => {
		const empty = persona({name: 'Pip', external: 'ppppp', deletedAt: new Date('2026-10-02'), useCount: 0});
		const used = persona({name: 'Pip', external: 'ppppp', deletedAt: new Date('2026-09-25'), useCount: 41});
		const result = plan([empty, used], [member({name: 'Pip', external_uuid: 'ppppp'})]);
		expect(result.entries[0]).toMatchObject({kind: 'deleted', persona_id: used.id.toString()});
	});

	it('prefers a live persona over a deleted one with the same id', () => {
		const dead = persona({name: 'Pip', external: 'ppppp', deletedAt: new Date('2026-09-25'), useCount: 90});
		const alive = persona({name: 'Pip', external: 'ppppp'});
		const result = plan([dead, alive], [member({name: 'Pip', external_uuid: 'ppppp'})]);
		expect(result.entries[0]).toMatchObject({kind: 'up_to_date', persona_id: alive.id.toString()});
	});

	it("can't tell when two live personas carry the same id", () => {
		const one = persona({name: 'Rook', external: 'rrrrr'});
		const two = persona({name: 'Rook', external: 'rrrrr'});
		const result = plan([one, two], [member({name: 'Rook', external_uuid: 'rrrrr'})]);
		expect(result.entries[0]?.kind).toBe('cant_tell');
		expect(result.entries[0]?.candidates?.map((c) => c.persona_id).sort()).toEqual(
			[one.id.toString(), two.id.toString()].sort(),
		);
	});

	it('matches a Tyne export by the persona id it writes for a persona made in Tyne', () => {
		const p = persona({name: 'Kit', tags: [{prefix: 'ki:'}]});
		const result = plan([p], [member({name: 'Kit', persona_tags: [{prefix: 'ki:'}], external_uuid: p.id.toString()})]);
		expect(result.entries[0]).toMatchObject({kind: 'up_to_date', persona_id: p.id.toString()});
	});
});

describe('pass 2: name and tag, one to one', () => {
	it('finds the one unlinked persona with the same name and a shared tag probably the same', () => {
		const p = persona({name: 'Kestrel', tags: [{prefix: 'ke:'}]});
		const result = plan([p], [member({name: 'Kestrel', persona_tags: [{prefix: 'ke:'}], external_uuid: 'kkkkk'})]);
		expect(result.entries[0]).toMatchObject({kind: 'probably_same', persona_id: p.id.toString()});
		// A plain add would clash with the persona's own tag, so the review offers "without the tag".
		expect(result.entries[0]?.clashes).toEqual([{tag: {prefix: 'ke:'}, held_by_persona_id: p.id.toString()}]);
	});

	it("sends every member to can't tell when two match the same persona, whatever their order", () => {
		const p = persona({name: 'Lyra', tags: [{prefix: 'ly:'}]});
		const members = [
			member({name: 'Lyra', persona_tags: [{prefix: 'ly:'}], external_uuid: 'lllll'}),
			member({name: 'Lyra', persona_tags: [{prefix: 'ly:'}], external_uuid: 'mmmmm'}),
		];
		for (const order of [members, [...members].reverse()]) {
			const result = plan([p], order);
			expect(result.entries.map((e) => e.kind)).toEqual(['cant_tell', 'cant_tell']);
		}
	});

	it("never calls a persona linked to another member probably the same: can't tell, marked linked elsewhere", () => {
		const p = persona({name: 'Fen', tags: [{prefix: 'fe:'}], external: 'gone1'});
		const result = plan([p], [member({name: 'Fen', persona_tags: [{prefix: 'fe:'}], external_uuid: 'fffff'})]);
		expect(result.entries[0]?.kind).toBe('cant_tell');
		expect(result.entries[0]?.candidates).toEqual([
			{persona_id: p.id.toString(), matched_on: 'name_and_tag', linked_elsewhere: true},
		]);
	});
});

describe('pass 3: name or tag', () => {
	it("can't tell on a name alone, a tag alone, or a tag differing only in case", () => {
		const byName = persona({name: 'Juniper', tags: [{prefix: 'ju:'}]});
		const byTag = persona({name: 'Saffron', tags: [{prefix: 'sf:'}]});
		const byCase = persona({name: 'Opal', tags: [{prefix: 'op:'}]});
		const result = plan(
			[byName, byTag, byCase],
			[
				member({name: 'Juniper', persona_tags: [{prefix: 'jun:'}]}),
				member({name: 'Saffy', persona_tags: [{prefix: 'sf:'}]}),
				member({name: 'Opaline', persona_tags: [{prefix: 'OP:'}]}),
			],
		);
		expect(result.entries.map((e) => e.candidates?.[0]?.matched_on)).toEqual(['name', 'tag', 'tag_case']);
		expect(result.entries.every((e) => e.kind === 'cant_tell')).toBe(true);
	});
});

describe('pass 4: tags taken, then new', () => {
	it('finds a tag held by a linked persona in use, and leaves a tag differing in case alone', () => {
		const linked = persona({name: 'Lyra ✦', tags: [{prefix: 'ly:'}], external: 'lllll'});
		const result = plan(
			[linked],
			[
				member({name: 'Lyra ✦', persona_tags: [{prefix: 'ly:'}], external_uuid: 'lllll'}),
				member({name: 'Lyra ✧', persona_tags: [{prefix: 'ly:'}], external_uuid: 'nnnnn'}),
				member({name: 'Lyric', persona_tags: [{prefix: 'Ly:'}], external_uuid: 'ooooo'}),
			],
		);
		expect(result.entries[1]).toMatchObject({
			kind: 'tag_in_use',
			clashes: [{tag: {prefix: 'ly:'}, held_by_persona_id: linked.id.toString()}],
		});
		expect(result.entries[2]?.kind).toBe('new');
	});

	it('sends both members that share a tag to review, neither winning by file order', () => {
		const result = plan(
			[],
			[
				member({name: 'Moth', persona_tags: [{prefix: 'm:'}]}),
				member({name: 'Mica', persona_tags: [{prefix: 'm:'}]}),
				member({name: 'Nettle', persona_tags: [{prefix: 'ne:'}]}),
			],
		);
		expect(result.entries.map((e) => e.kind)).toEqual(['tag_in_use', 'tag_in_use', 'new']);
		expect(result.entries[0]?.clashes).toEqual([{tag: {prefix: 'm:'}, shared_with_member: 1}]);
		expect(result.entries[1]?.clashes).toEqual([{tag: {prefix: 'm:'}, shared_with_member: 0}]);
	});

	it('counts the personas no member matched as untouched', () => {
		const linked = persona({name: 'Wren', external: 'aaaaa'});
		const candidate = persona({name: 'Juniper', tags: [{prefix: 'ju:'}]});
		const alone = persona({name: 'Hazel', tags: [{prefix: 'ha:'}]});
		const result = plan(
			[linked, candidate, alone],
			[member({name: 'Wren', external_uuid: 'aaaaa'}), member({name: 'Juniper', persona_tags: [{prefix: 'jn:'}]})],
		);
		expect(result.untouched).toBe(1);
	});
});
