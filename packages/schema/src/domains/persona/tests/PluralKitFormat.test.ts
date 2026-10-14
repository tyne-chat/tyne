// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it} from 'vitest';
import {
	assignPersonaFileBaseNames,
	buildPersonaBundleText,
	buildPluralKitExport,
	colorFromPluralKit,
	colorToPluralKit,
	imageFileExtension,
	isPluralKitImageUrl,
	ownTyneMediaImageHash,
	type PersonaBundlePersona,
	PLURALKIT_MEMBER_PRIVACY_KEYS,
	type PluralKitExportPersona,
	type PluralKitImportedMember,
	personaImportItem,
	pluralKitMemberReference,
	pluralKitPrivacyFromVisibility,
	readPluralKitExport,
	readTyneBundleManifest,
	safeFileBaseName,
	shortenForPluralKit,
	tyneMediaImageUrl,
	visibilityFromPluralKitPrivacy,
} from '../PluralKitFormat';

// What Tyne keeps of an imported member: the import request the app sends (with each image stored
// under a made-up hash), read back the way the export reads a stored persona whose images are
// unchanged. The API's export test runs the same trip through the real routes and storage.
function throughTyne(file: unknown): unknown {
	const read = readPluralKitExport(file);
	if (!read.ok) throw new Error(read.reason);
	const personas: Array<PluralKitExportPersona> = read.system.members.map((member: PluralKitImportedMember) => {
		const item = personaImportItem(
			{...member, name: member.name ?? ''},
			{
				avatar: member.avatarUrl ? {hash: 'aaaaaaaa', avatarColor: null} : null,
				banner: member.bannerUrl ? {hash: 'bbbbbbbb'} : null,
			},
		);
		const avatarSource = item.image_sources?.avatar ?? null;
		return {
			exportId: item.external_uuid ?? '',
			name: item.name,
			color: item.color ?? null,
			pronouns: item.pronouns ?? null,
			bio: item.bio ?? null,
			personaTags: item.persona_tags ?? [],
			visibility: item.visibility ?? 'unlisted',
			avatarUrl: item.avatar_hash ? (avatarSource?.url ?? null) : null,
			avatarOrigin: avatarSource
				? {field: avatarSource.field, mainAvatarEmpty: avatarSource.main_avatar_empty === true}
				: null,
			bannerUrl: item.banner_hash ? (item.image_sources?.banner?.url ?? null) : null,
		};
	});
	return JSON.parse(JSON.stringify(buildPluralKitExport({tag: read.system.tag, personas}).file));
}

// "Formatting differences": key order and whitespace (gone once parsed), colour case and "#",
// and an empty string where PluralKit would write null.
function normalise(value: unknown, key?: string): unknown {
	if (Array.isArray(value)) return value.map((item) => normalise(item));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v, k)]));
	}
	if (value === '') return null;
	if (key === 'color' && typeof value === 'string') return value.replace(/^#/, '').toLowerCase();
	return value;
}

const PUBLIC = Object.fromEntries(PLURALKIT_MEMBER_PRIVACY_KEYS.map((k) => [k, 'public']));
const PRIVATE = Object.fromEntries(PLURALKIT_MEMBER_PRIVACY_KEYS.map((k) => [k, 'private']));
const HIDDEN = {...PUBLIC, visibility: 'private'};

// A file in the shape `pk;export` writes (PluralKit.Core DataFileService, PKMember/PKSystem.ToJson),
// with every field, including the ones Tyne does not keep.
const FULL_PLURALKIT_EXPORT = {
	version: 2,
	id: 'exmpl',
	uuid: '7f1b3c8e-0000-4000-8000-000000000001',
	name: 'The Example System',
	description: 'We are an example.',
	tag: '⚞Example⚟',
	pronouns: 'we/us',
	avatar_url: 'https://cdn.pluralkit.me/s/exmpl/avatar.webp',
	banner: null,
	color: 'AA3355',
	created: '2021-03-04T05:06:07.000000Z',
	webhook_url: null,
	privacy: {
		name_privacy: 'public',
		avatar_privacy: 'public',
		description_privacy: 'public',
		banner_privacy: 'public',
		pronoun_privacy: 'public',
		member_list_privacy: 'public',
		group_list_privacy: 'public',
		front_privacy: 'public',
		front_history_privacy: 'public',
	},
	config: {timezone: 'UTC', pings_enabled: true, member_default_private: false},
	accounts: [123456789012345],
	members: [
		{
			id: 'abcde',
			uuid: '7f1b3c8e-0000-4000-8000-000000000002',
			name: 'Alice',
			display_name: 'Alice 🌸',
			color: 'FF8800',
			birthday: '2000-01-01',
			pronouns: 'she/her',
			avatar_url: 'https://cdn.pluralkit.me/m/abcde/avatar.png',
			webhook_avatar_url: null,
			banner: 'https://cdn.pluralkit.me/m/abcde/banner.png',
			description: 'Keeper of the keys.\nLikes **bold** text.',
			created: '2021-03-04T05:06:07.000000Z',
			keep_proxy: false,
			tts: false,
			autoproxy_enabled: true,
			message_count: 1234,
			last_message_timestamp: '2026-10-01T00:00:00.000000Z',
			proxy_tags: [
				{prefix: 'a:', suffix: null},
				{prefix: '[', suffix: ']'},
				{prefix: null, suffix: '-a'},
			],
			privacy: PUBLIC,
		},
		{
			id: 'fghijk',
			uuid: '7f1b3c8e-0000-4000-8000-000000000003',
			name: 'Bea Two',
			display_name: null,
			color: null,
			birthday: null,
			pronouns: null,
			avatar_url: null,
			webhook_avatar_url: 'https://cdn.pluralkit.me/m/fghijk/proxy.png',
			banner: null,
			description: null,
			created: '2022-03-04T05:06:07.000000Z',
			keep_proxy: true,
			tts: false,
			autoproxy_enabled: false,
			message_count: 0,
			last_message_timestamp: null,
			proxy_tags: [],
			privacy: HIDDEN,
		},
		{
			id: 'lmnop',
			uuid: '7f1b3c8e-0000-4000-8000-000000000004',
			name: 'Alice',
			display_name: null,
			color: '00ff00',
			birthday: null,
			pronouns: 'xe/xem',
			avatar_url: 'https://cdn.pluralkit.me/m/lmnop/avatar.gif',
			webhook_avatar_url: null,
			banner: null,
			description: 'The other Alice.',
			created: '2023-03-04T05:06:07.000000Z',
			keep_proxy: false,
			tts: true,
			autoproxy_enabled: true,
			message_count: 9,
			last_message_timestamp: null,
			proxy_tags: [{prefix: 'A2:', suffix: null}],
			privacy: PRIVATE,
		},
	],
	groups: [
		{
			id: 'grpaa',
			name: 'Front',
			members: ['abcde'],
		},
	],
	switches: [{timestamp: '2026-10-01T00:00:00.000000Z', members: ['abcde']}],
};

const SUPPORTED_SYSTEM_KEYS = ['version', 'tag', 'members'];
const SUPPORTED_MEMBER_KEYS = [
	'id',
	'name',
	'color',
	'pronouns',
	'avatar_url',
	'webhook_avatar_url',
	'banner',
	'description',
	'proxy_tags',
	'privacy',
];

// The same file with only what Tyne imports, and groups and switches emptied: the files the round
// trip promises to give back unchanged.
function cutDown(file: typeof FULL_PLURALKIT_EXPORT): Record<string, unknown> {
	const system: Record<string, unknown> = {};
	for (const key of SUPPORTED_SYSTEM_KEYS) system[key] = (file as Record<string, unknown>)[key];
	system.members = file.members.map((member) => {
		const kept: Record<string, unknown> = {};
		for (const key of SUPPORTED_MEMBER_KEYS) kept[key] = (member as Record<string, unknown>)[key];
		return kept;
	});
	system.groups = [];
	system.switches = [];
	return system;
}

// PluralKit's own checks on an imported file, copied from its importer at commit c4679ccf
// (BulkImporter.PerformImport, ImportPluralKit, ImportMember, MemberPatch.AssertIsValid,
// SystemPatch.AssertIsValid, MiscUtils.TryMatchUri, ProxyTag.Valid, Limits). Returns the first
// reason PluralKit would refuse the file, or null.
function pluralKitWouldRefuse(file: unknown): string | null {
	if (!file || typeof file !== 'object') return 'not an object';
	const system = file as Record<string, unknown>;
	if (!('switches' in system)) return 'File type is unknown.';
	if (!Array.isArray(system.switches)) return 'switches is not a list';
	if (!Array.isArray(system.members)) return 'members missing';
	if ('groups' in system && system.groups !== null && !Array.isArray(system.groups)) return 'groups is not a list';
	const isUri = (value: unknown) => {
		if (value === null || value === undefined || value === '') return true;
		if (typeof value !== 'string' || value.length > 256) return false;
		try {
			return new URL(value).protocol === 'https:';
		} catch {
			return false;
		}
	};
	const isLevel = (value: unknown) => value === 'public' || value === 'private';
	if (typeof system.tag === 'string' && system.tag.length > 79) return 'tag too long';
	const ids = new Set<string>();
	for (const raw of system.members as Array<Record<string, unknown>>) {
		if (typeof raw.id !== 'string') return 'member without id';
		ids.add(raw.id);
		if (typeof raw.name !== 'string' || raw.name.length === 0) return 'Member name can not be set to null.';
		if (raw.name.length > 100) return 'name too long';
		if (raw.color !== null && raw.color !== undefined && !/^[0-9a-fA-F]{6}$/.test(String(raw.color))) return 'color';
		if (typeof raw.pronouns === 'string' && raw.pronouns.length > 100) return 'pronouns too long';
		if (typeof raw.description === 'string' && raw.description.length > 1000) return 'description too long';
		for (const key of ['avatar_url', 'webhook_avatar_url', 'banner']) {
			if (!isUri(raw[key])) return `${key} is not an https link of at most 256 characters`;
		}
		if (raw.proxy_tags !== undefined) {
			if (!Array.isArray(raw.proxy_tags) || raw.proxy_tags.length > 100) return 'proxy_tags';
			for (const tag of raw.proxy_tags as Array<Record<string, unknown>>) {
				const proxyString = `${tag.prefix ?? ''}text${tag.suffix ?? ''}`;
				if (proxyString.length > 100) return 'proxy tag too long';
			}
		}
		if (raw.privacy !== undefined) {
			for (const value of Object.values(raw.privacy as Record<string, unknown>)) {
				if (!isLevel(value)) return 'privacy level';
			}
		}
	}
	for (const sw of system.switches as Array<Record<string, unknown>>) {
		for (const member of sw.members as Array<string>) {
			if (!ids.has(member)) return "One or more switches include members that haven't been imported.";
		}
	}
	return null;
}

// A small seeded generator, so a failure names the seed that reproduces it.
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ALPHABET = [
	'a',
	'B',
	'z',
	'0',
	'9',
	' ',
	'-',
	'!',
	'é',
	'ß',
	'Ж',
	'中',
	'🌸',
	'🦊',
	'⚞',
	'⚟',
	'"',
	"'",
	'.',
	'/',
];

function randomSystem(seed: number): Record<string, unknown> {
	const random = mulberry32(seed);
	const int = (max: number) => Math.floor(random() * max);
	const pick = <T>(items: ReadonlyArray<T>): T => items[int(items.length)] as T;
	const word = (min: number, max: number) => {
		let out = '';
		const length = min + int(max - min + 1);
		while (out.length < length) out += pick(ALPHABET);
		// What the import keeps: no surrounding spaces, and not longer than allowed.
		out = out.slice(0, max).trim();
		if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1).trim();
		return out.length >= Math.max(min, 1) ? out : `x${out}`.slice(0, max);
	};
	const maybe = <T>(value: () => T): T | null => (random() < 0.3 ? null : value());
	const url = (path: string) => `https://cdn.pluralkit.me/${path}/${word(1, 20).replace(/[^a-z0-9]/gi, 'x')}.png`;
	const privacy = pick([PUBLIC, HIDDEN, PRIVATE]);
	const members = Array.from({length: 1 + int(6)}, (_, index) => {
		const tags: Array<{prefix: string | null; suffix: string | null}> = [];
		const seen = new Set<string>();
		for (let i = int(6); i > 0; i--) {
			const prefix = random() < 0.7 ? word(1, 32) : null;
			const suffix = random() < 0.4 || prefix === null ? word(1, 32) : null;
			const key = `${prefix}\u0000${suffix}`;
			if (seen.has(key)) continue;
			seen.add(key);
			tags.push({prefix, suffix});
		}
		const avatarShape = int(3);
		return {
			id: `${'abcdefghij'[index]}${word(4, 4)
				.replace(/[^a-z]/gi, 'q')
				.toLowerCase()}`.slice(0, 5),
			name: word(1, 100),
			color: maybe(() => int(0x1000000).toString(16).padStart(6, '0')),
			pronouns: maybe(() => word(1, 100)),
			avatar_url: avatarShape === 1 ? url('avatar') : null,
			webhook_avatar_url: avatarShape === 2 ? url('proxy') : null,
			banner: maybe(() => url('banner')),
			description: maybe(() => word(1, 1000)),
			proxy_tags: tags,
			privacy: pick([PUBLIC, HIDDEN, PRIVATE, privacy]),
		};
	});
	// Member ids must be unique for PluralKit; the generator's are by position.
	return {version: 2, tag: maybe(() => word(1, 79)), members, groups: [], switches: []};
}

describe('PluralKit round trip', () => {
	it('gives back a cut-down PluralKit export unchanged', () => {
		const original = cutDown(FULL_PLURALKIT_EXPORT);
		expect(normalise(throughTyne(original))).toEqual(normalise(original));
	});

	it('gives back the same as the cut-down file when given the whole PluralKit export', () => {
		expect(normalise(throughTyne(FULL_PLURALKIT_EXPORT))).toEqual(normalise(cutDown(FULL_PLURALKIT_EXPORT)));
	});

	it('only differs in formatting for colours written with "#" and capitals, and empty strings', () => {
		const original = cutDown(FULL_PLURALKIT_EXPORT);
		const members = original.members as Array<Record<string, unknown>>;
		members[0] = {...members[0], color: '#FF8800'};
		members[1] = {...members[1], pronouns: ''};
		expect(normalise(throughTyne(original))).toEqual(normalise(original));
	});

	it('round-trips 300 random systems', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const original = randomSystem(seed);
			const back = throughTyne(original);
			expect({seed, file: normalise(back)}).toEqual({seed, file: normalise(original)});
		}
	});

	it('writes files PluralKit accepts, for random systems', () => {
		for (let seed = 1; seed <= 300; seed++) {
			expect({seed, refusal: pluralKitWouldRefuse(throughTyne(randomSystem(seed)))}).toEqual({seed, refusal: null});
		}
	});
});

describe('buildPluralKitExport', () => {
	const persona = (overrides: Partial<PluralKitExportPersona> = {}): PluralKitExportPersona => ({
		exportId: '1428573920012345678',
		name: 'Alvis',
		color: 0x336699,
		pronouns: 'they/it',
		bio: 'A bookkeeper of sorts.',
		personaTags: [{prefix: 'a:'}],
		visibility: 'unlisted',
		avatarUrl: 'https://media.example/avatars/1/abcdef12.png',
		avatarOrigin: null,
		bannerUrl: null,
		...overrides,
	});

	it("writes PluralKit's keys in its order and leaves out what Tyne does not keep", () => {
		const {file} = buildPluralKitExport({tag: 'TAG', personas: [persona()]});
		expect(Object.keys(file)).toEqual(['version', 'tag', 'members', 'groups', 'switches']);
		expect(Object.keys(file.members[0]!)).toEqual([
			'id',
			'name',
			'color',
			'pronouns',
			'avatar_url',
			'webhook_avatar_url',
			'banner',
			'description',
			'proxy_tags',
			'privacy',
		]);
		expect(file.members[0]).toMatchObject({
			color: '336699',
			proxy_tags: [{prefix: 'a:', suffix: null}],
			privacy: {visibility: 'private', description_privacy: 'public'},
		});
	});

	it('shortens text PluralKit would refuse and reports the full text', () => {
		const longBio = 'b'.repeat(1500);
		const longTag = 't'.repeat(90);
		const {file, shortened} = buildPluralKitExport({tag: longTag, personas: [persona({bio: longBio})]});
		expect(file.members[0]!.description).toHaveLength(1000);
		expect(file.members[0]!.description!.endsWith('…')).toBe(true);
		expect(file.tag).toHaveLength(79);
		expect(shortened).toEqual([
			{exportId: null, field: 'tag', fullText: longTag},
			{exportId: '1428573920012345678', field: 'description', fullText: longBio},
		]);
		expect(pluralKitWouldRefuse(file)).toBeNull();
	});

	it('leaves out image links PluralKit would refuse, and colours it cannot hold', () => {
		const {file} = buildPluralKitExport({
			tag: null,
			personas: [
				persona({
					avatarUrl: 'http://insecure.example/a.png',
					bannerUrl: `https://example.com/${'x'.repeat(300)}.png`,
					color: 0x1000000,
				}),
			],
		});
		expect(file.members[0]).toMatchObject({avatar_url: null, banner: null, color: null});
		expect(pluralKitWouldRefuse(file)).toBeNull();
	});

	it('writes a proxy avatar back as the proxy avatar and leaves the main avatar to PluralKit', () => {
		const {file} = buildPluralKitExport({
			tag: null,
			personas: [persona({avatarOrigin: {field: 'webhook_avatar_url', mainAvatarEmpty: false}})],
		});
		expect(file.members[0]).not.toHaveProperty('avatar_url');
		expect(file.members[0]!.webhook_avatar_url).toBe('https://media.example/avatars/1/abcdef12.png');
	});

	it('keeps leaving the main avatar alone after the proxy avatar was removed in Tyne', () => {
		const {file} = buildPluralKitExport({
			tag: null,
			personas: [persona({avatarUrl: null, avatarOrigin: {field: 'webhook_avatar_url', mainAvatarEmpty: false}})],
		});
		expect(file.members[0]).not.toHaveProperty('avatar_url');
		expect(file.members[0]!.webhook_avatar_url).toBeNull();
	});
});

describe('reading a PluralKit export', () => {
	it('refuses what is not an export', () => {
		expect(readPluralKitExport(null)).toEqual({ok: false, reason: 'not_object'});
		expect(readPluralKitExport([])).toEqual({ok: false, reason: 'not_object'});
		expect(readPluralKitExport({name: 'x'})).toEqual({ok: false, reason: 'no_members'});
	});

	it('takes the proxy avatar over the main avatar, as PluralKit shows it on messages', () => {
		const read = readPluralKitExport({
			members: [
				{id: 'aaaaa', name: 'A', avatar_url: 'https://x/main.png', webhook_avatar_url: 'https://x/proxy.png'},
				{id: 'bbbbb', name: 'B', avatar_url: 'https://x/same.png', webhook_avatar_url: 'https://x/same.png'},
				{id: 'ccccc', name: 'C', avatar_url: 'https://x/main.png'},
			],
		});
		if (!read.ok) throw new Error('not read');
		expect(read.system.members.map((m) => [m.avatarUrl, m.avatarOrigin])).toEqual([
			['https://x/proxy.png', {field: 'webhook_avatar_url', mainAvatarEmpty: false}],
			['https://x/same.png', {field: 'avatar_url', mainAvatarEmpty: false}],
			['https://x/main.png', {field: 'avatar_url', mainAvatarEmpty: false}],
		]);
	});

	it('trims text, falls back to the display name, and drops tags Tyne cannot hold', () => {
		const read = readPluralKitExport({
			members: [
				{
					id: ' aaaaa ',
					name: '   ',
					display_name: ' Shown ',
					proxy_tags: [
						{prefix: ' a: ', suffix: null},
						{prefix: 'a:', suffix: ''},
						{prefix: null, suffix: null},
						{prefix: 'x'.repeat(33), suffix: null},
						{prefix: '1'},
						{prefix: '2'},
						{prefix: '3'},
						{prefix: '4'},
						{prefix: '5'},
					],
				},
			],
		});
		if (!read.ok) throw new Error('not read');
		const member = read.system.members[0]!;
		expect(member.id).toBe('aaaaa');
		expect(member.name).toBe('Shown');
		expect(member.personaTags).toEqual([{prefix: 'a:'}, {prefix: '1'}, {prefix: '2'}, {prefix: '3'}, {prefix: '4'}]);
		expect(member.droppedTagCount).toBe(2);
	});
});

describe('privacy', () => {
	it('maps each Tyne visibility to one PluralKit pattern and back', () => {
		for (const visibility of ['public', 'unlisted', 'private'] as const) {
			expect(visibilityFromPluralKitPrivacy(pluralKitPrivacyFromVisibility(visibility))).toBe(visibility);
		}
		expect(pluralKitPrivacyFromVisibility('public')).toEqual(PUBLIC);
		expect(pluralKitPrivacyFromVisibility('unlisted')).toEqual(HIDDEN);
		expect(pluralKitPrivacyFromVisibility('private')).toEqual(PRIVATE);
	});

	it('never makes a member less private: any private switch besides visibility means private', () => {
		for (const key of PLURALKIT_MEMBER_PRIVACY_KEYS) {
			if (key === 'visibility') continue;
			expect(visibilityFromPluralKitPrivacy({...PUBLIC, [key]: 'private'})).toBe('private');
			expect(visibilityFromPluralKitPrivacy({...HIDDEN, [key]: 'private'})).toBe('private');
		}
		expect(visibilityFromPluralKitPrivacy({...PUBLIC, name_privacy: 'something else'})).toBe('private');
	});

	it("treats a member without privacy settings as unlisted, and reads old files' top-level switches", () => {
		const read = readPluralKitExport({
			members: [
				{id: 'aaaaa', name: 'A'},
				{id: 'bbbbb', name: 'B', visibility: 'private'},
				{id: 'ccccc', name: 'C', privacy: {visibility: 'public'}},
			],
		});
		if (!read.ok) throw new Error('not read');
		expect(read.system.members.map((m) => m.visibility)).toEqual(['unlisted', 'unlisted', 'public']);
	});
});

describe('values', () => {
	it('converts colours', () => {
		expect(colorFromPluralKit('ff8800')).toBe(0xff8800);
		expect(colorFromPluralKit('#FF8800')).toBe(0xff8800);
		expect(colorFromPluralKit('fff')).toBeNull();
		expect(colorFromPluralKit(null)).toBeNull();
		expect(colorToPluralKit(0x0000ff)).toBe('0000ff');
		expect(colorToPluralKit(-1)).toBeNull();
	});

	it('accepts only https links of at most 256 characters, as PluralKit does', () => {
		expect(isPluralKitImageUrl('https://cdn.pluralkit.me/a.png')).toBe(true);
		expect(isPluralKitImageUrl('http://cdn.pluralkit.me/a.png')).toBe(false);
		expect(isPluralKitImageUrl('avatars/Alice.png')).toBe(false);
		expect(isPluralKitImageUrl(`https://a.example/${'x'.repeat(240)}`)).toBe(false);
	});

	it('never splits a character when shortening', () => {
		const text = `${'a'.repeat(8)}🌸🌸`;
		const cut = shortenForPluralKit(text, 10);
		expect(cut).toBe(`${'a'.repeat(8)}…`);
		expect(cut.length).toBeLessThanOrEqual(10);
	});
});

describe("links to this instance's media", () => {
	const media = 'https://media.example.com/media';

	it('builds the public link of a persona image', () => {
		expect(tyneMediaImageUrl(`${media}/`, 'avatar', '42', 'abcdef12')).toBe(`${media}/avatars/42/abcdef12.png`);
		expect(tyneMediaImageUrl(media, 'banner', '42', 'a_abcdef12')).toBe(
			`${media}/banners/42/a_abcdef12.gif?animated=true`,
		);
	});

	it("recognises the account's own images, and nobody else's", () => {
		const own = tyneMediaImageUrl(media, 'avatar', '42', 'abcdef12');
		expect(ownTyneMediaImageHash(own, media, 'avatar', '42')).toBe('abcdef12');
		expect(ownTyneMediaImageHash(`${media}/avatars/42/a_abcdef12.webp?size=80`, media, 'avatar', '42')).toBe(
			'a_abcdef12',
		);
		expect(ownTyneMediaImageHash(own, media, 'avatar', '43')).toBeNull();
		expect(ownTyneMediaImageHash(own, media, 'banner', '42')).toBeNull();
		expect(
			ownTyneMediaImageHash('https://elsewhere.example/media/avatars/42/abcdef12.png', media, 'avatar', '42'),
		).toBeNull();
		expect(ownTyneMediaImageHash(`${media}/avatars/42/../43/abcdef12.png`, media, 'avatar', '42')).toBeNull();
	});
});

describe('file names in the bundle', () => {
	it('keeps names readable and safe on every system', () => {
		expect(safeFileBaseName('Bea 🌸')).toBe('Bea 🌸');
		expect(safeFileBaseName('AC/DC: "live"?')).toBe('AC_DC_ _live__');
		expect(safeFileBaseName('  ..hidden. ')).toBe('hidden');
		expect(safeFileBaseName('con')).toBe('con_');
		expect(safeFileBaseName('Alice‮gnp.exe')).toBe('Alice_gnp.exe');
		expect(safeFileBaseName('a\u0007b\u0085c\u2067d')).toBe('a_b_c_d');
		expect(safeFileBaseName('...')).toBe('Persona');
		expect(new TextEncoder().encode(safeFileBaseName('🦊'.repeat(100))).length).toBeLessThanOrEqual(150);
	});

	it('numbers personas that share a name, ignoring case', () => {
		const names = assignPersonaFileBaseNames([
			{key: '1', name: 'Alice'},
			{key: '2', name: 'alice'},
			{key: '3', name: 'Alice (2)'},
			{key: '4', name: 'Alice'},
		]);
		expect([...names.values()]).toEqual(['Alice', 'alice (2)', 'Alice (2) (2)', 'Alice (3)']);
	});

	it('never hands out a reserved name', () => {
		const names = assignPersonaFileBaseNames([{key: '1', name: 'Tag icon'}], ['Tag icon']);
		expect(names.get('1')).toBe('Tag icon (2)');
	});

	it('names the file after the image format', () => {
		expect(imageFileExtension(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('png');
		expect(imageFileExtension(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
		expect(imageFileExtension(new TextEncoder().encode('GIF89a'))).toBe('gif');
		expect(imageFileExtension(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8'))).toBe('webp');
		expect(imageFileExtension(new TextEncoder().encode('\u0000\u0000\u0000\u001cftypavif'))).toBe('avif');
		expect(imageFileExtension(new TextEncoder().encode('<svg xmlns=""/>'))).toBe('svg');
		expect(imageFileExtension(Uint8Array.from([1, 2, 3]))).toBe('bin');
	});
});

describe("the bundle's text files", () => {
	const bundlePersona = (overrides: Partial<PersonaBundlePersona> = {}): PersonaBundlePersona => ({
		exportId: 'abcde',
		name: 'Alice',
		color: null,
		pronouns: null,
		bio: null,
		personaTags: [],
		visibility: 'public',
		avatarOrigin: {field: 'avatar_url', mainAvatarEmpty: false},
		avatar: {path: 'avatars/Alice.png', url: 'https://cdn.pluralkit.me/a.png', hostedOnTyne: false},
		banner: null,
		autoTagDisabled: false,
		signatureEmojis: [],
		...overrides,
	});

	it('lists the files in tyne.json and keeps what PluralKit has no place for', () => {
		const text = buildPersonaBundleText({
			exportedAt: new Date('2026-10-14T12:00:00Z'),
			mediaHost: 'media.example.com',
			tagText: 'T'.repeat(90),
			tagIcon: {path: 'Tag icon.png'},
			personas: [
				bundlePersona({bio: 'x'.repeat(1200), autoTagDisabled: true, signatureEmojis: [{name: '🌸'}]}),
				bundlePersona({exportId: '1428573920012345678', name: 'Bea', avatar: null}),
			],
		});
		const manifest = readTyneBundleManifest(JSON.parse(text.manifestJson));
		expect(manifest).toEqual({
			format: 'tyne-personas',
			version: 1,
			pluralkit_file: 'pluralkit.json',
			tag_text: 'T'.repeat(90),
			tag_icon: 'Tag icon.png',
			members: {
				abcde: {
					avatar: 'avatars/Alice.png',
					bio: 'x'.repeat(1200),
					auto_tag_disabled: true,
					signature_emojis: [{name: '🌸'}],
				},
				'1428573920012345678': {},
			},
		});
		expect(pluralKitWouldRefuse(JSON.parse(text.pluralKitJson))).toBeNull();
		expect(text.readme).toContain('The bio of Alice was cut to 1000 characters');
		expect(text.readme).toContain('Your system tag was cut to 79 characters');
		expect(text.readme).toContain('PluralKit has no tag icon');
	});

	it('gives PluralKit commands only for images that link to Tyne, by ID or by name', () => {
		const text = buildPersonaBundleText({
			exportedAt: new Date('2026-10-14T12:00:00Z'),
			mediaHost: 'media.example.com',
			tagText: null,
			tagIcon: null,
			personas: [
				bundlePersona(),
				bundlePersona({
					exportId: 'fghij',
					name: 'Proxy',
					avatarOrigin: {field: 'webhook_avatar_url', mainAvatarEmpty: true},
					avatar: {path: 'avatars/Proxy.png', url: 'https://media.example.com/a.png', hostedOnTyne: true},
				}),
				bundlePersona({
					exportId: '1428573920012345678',
					name: 'Bea Two',
					avatarOrigin: null,
					avatar: {path: 'avatars/Bea Two.png', url: 'https://media.example.com/b.png', hostedOnTyne: true},
					banner: {path: 'banners/Bea Two.png', url: 'https://media.example.com/c.png', hostedOnTyne: true},
				}),
			],
		});
		expect(text.readme).not.toContain('pk;member abcde');
		expect(text.readme).toContain('pk;member fghij proxyavatar\n      attach: avatars/Proxy.png');
		expect(text.readme).toContain('pk;member "Bea Two" avatar\n      attach: avatars/Bea Two.png');
		expect(text.readme).toContain('pk;member "Bea Two" banner\n      attach: banners/Bea Two.png');
		expect(text.readme).toContain('media.example.com');
	});

	it('names members in commands by PluralKit ID when they have one', () => {
		expect(pluralKitMemberReference('ABCDE', 'Alice')).toBe('abcde');
		expect(pluralKitMemberReference('1428573920012345678', 'Alice')).toBe('Alice');
		expect(pluralKitMemberReference('1428573920012345678', 'Bea Two')).toBe('"Bea Two"');
	});

	it('ignores malformed values in tyne.json', () => {
		expect(readTyneBundleManifest({format: 'other', version: 1})).toBeNull();
		expect(
			readTyneBundleManifest({
				format: 'tyne-personas',
				version: 1,
				members: {a: {avatar: 5, bio: '', auto_tag_disabled: 'yes', signature_emojis: [null, {name: 'x'}]}, b: 'no'},
			}),
		).toEqual({
			format: 'tyne-personas',
			version: 1,
			pluralkit_file: 'pluralkit.json',
			members: {a: {signature_emojis: [{name: 'x'}]}},
		});
	});
});
