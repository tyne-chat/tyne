// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {
	type PersonaImportStoredImages,
	PLURALKIT_MEMBER_PRIVACY_KEYS,
	personaImportItem,
	readPluralKitExport,
	readTyneBundleManifest,
} from '@fluxer/schema/src/domains/persona/PluralKitFormat';
import sharp from 'sharp';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {createTestAccount, type TestAccount} from '../../auth/tests/AuthTestUtils';
import {createUserID} from '../../BrandedTypes';
import {Config} from '../../Config';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';
import {forgetPersonaImageSourcesOfUser, loadPersonaImageSources} from '../PersonaImageSourceStore';
import {readZipForTests} from './ReadZipForTests';

const PUBLIC = Object.fromEntries(PLURALKIT_MEMBER_PRIVACY_KEYS.map((k) => [k, 'public']));
const PRIVATE = Object.fromEntries(PLURALKIT_MEMBER_PRIVACY_KEYS.map((k) => [k, 'private']));
const HIDDEN = {...PUBLIC, visibility: 'private'};

// A PluralKit export cut down to what Tyne imports: the files the round trip gives back unchanged.
const PLURALKIT_FILE = {
	version: 2,
	tag: '⚞Example⚟',
	members: [
		{
			id: 'abcde',
			name: 'Alice',
			color: 'ff8800',
			pronouns: 'she/her',
			avatar_url: 'https://cdn.pluralkit.me/m/abcde/avatar.png',
			webhook_avatar_url: null,
			banner: 'https://cdn.pluralkit.me/m/abcde/banner.png',
			description: 'Keeper of the keys.',
			proxy_tags: [
				{prefix: 'a:', suffix: null},
				{prefix: '[', suffix: ']'},
			],
			privacy: PUBLIC,
		},
		{
			id: 'fghijk',
			name: 'Bea Two',
			color: null,
			pronouns: null,
			avatar_url: null,
			webhook_avatar_url: 'https://cdn.pluralkit.me/m/fghijk/proxy.png',
			banner: null,
			description: null,
			proxy_tags: [],
			privacy: HIDDEN,
		},
		{
			id: 'lmnop',
			name: 'Alice',
			color: '00ff00',
			pronouns: 'xe/xem',
			avatar_url: null,
			webhook_avatar_url: null,
			banner: null,
			description: 'The other Alice.',
			proxy_tags: [{prefix: 'A2:', suffix: null}],
			privacy: PRIVATE,
		},
	],
	groups: [],
	switches: [],
};

let colourSeed = 0;
async function distinctPng(): Promise<string> {
	colourSeed++;
	const png = await sharp({
		create: {width: 4, height: 4, channels: 3, background: {r: colourSeed % 256, g: (colourSeed * 7) % 256, b: 99}},
	})
		.png()
		.toBuffer();
	return `data:image/png;base64,${png.toString('base64')}`;
}

describe('Persona export', () => {
	let harness: ApiTestHarness;
	let account: TestAccount;

	// PluralKit only takes https links, so the export leaves out links to a plain http media server
	// (as in local development). Production's is https.
	const originalMediaEndpoint = Config.endpoints.media;
	beforeAll(async () => {
		harness = await createApiTestHarness();
		Config.endpoints.media = 'https://media.tyne.test/media';
	});
	afterAll(async () => {
		Config.endpoints.media = originalMediaEndpoint;
		await harness?.shutdown();
	});
	beforeEach(async () => {
		await harness.reset();
		account = await createTestAccount(harness);
	});

	const storeImage = async (token: string, kind: 'avatar' | 'banner', image: string) =>
		createBuilder<{hash: string; avatar_color?: number | null}>(harness, token)
			.post('/users/@me/personas/import-image')
			.body({kind, image})
			.expect(HTTP_STATUS.OK)
			.execute();

	// What the web app's import does with a PluralKit file. Remote images stand in as freshly made
	// PNGs (fetching them is tested with the batch route); images from a Tyne export come from its zip.
	const importLikeTheApp = async (
		token: string,
		file: unknown,
		zip?: Map<string, Buffer>,
	): Promise<Array<PersonaResponse>> => {
		const read = readPluralKitExport(file);
		if (!read.ok) throw new Error(read.reason);
		const manifest = zip ? readTyneBundleManifest(JSON.parse(zip.get('tyne.json')!.toString('utf8'))) : null;
		const asDataUri = (path: string | undefined) =>
			path && zip?.get(path) ? `data:image/png;base64,${zip.get(path)!.toString('base64')}` : null;
		const items = [];
		for (const member of read.system.members) {
			if (!member.name) continue;
			const extras = member.id ? manifest?.members[member.id] : undefined;
			const images: PersonaImportStoredImages = {avatar: null, banner: null};
			const avatarImage = manifest ? asDataUri(extras?.avatar) : member.avatarUrl ? await distinctPng() : null;
			if (avatarImage) {
				const stored = await storeImage(token, 'avatar', avatarImage);
				images.avatar = {hash: stored.hash, avatarColor: stored.avatar_color ?? null};
			}
			const bannerImage = manifest ? asDataUri(extras?.banner) : member.bannerUrl ? await distinctPng() : null;
			if (bannerImage) images.banner = {hash: (await storeImage(token, 'banner', bannerImage)).hash};
			items.push(personaImportItem({...member, name: member.name}, images, extras));
		}
		const imported = await createBuilder<Array<PersonaResponse>>(harness, token)
			.post('/users/@me/personas/import')
			.body(items)
			.expect(HTTP_STATUS.OK)
			.execute();
		const tag = manifest?.tag_text ?? read.system.tag;
		if (tag) {
			await createBuilder(harness, token)
				.patch('/users/@me/personas/settings')
				.body({display_tag_text: tag})
				.expect(HTTP_STATUS.OK)
				.execute();
		}
		return imported;
	};

	const exportZip = async (token: string): Promise<{response: Response; files: Map<string, Buffer>}> => {
		const response = await harness.requestJson({
			path: '/users/@me/personas/export',
			headers: {authorization: token},
		});
		expect(response.status).toBe(HTTP_STATUS.OK);
		const files = readZipForTests(new Uint8Array(await response.arrayBuffer()));
		return {response, files};
	};

	const pluralKitJsonOf = (files: Map<string, Buffer>) => JSON.parse(files.get('pluralkit.json')!.toString('utf8'));

	it('gives back a PluralKit file unchanged after importing it', async () => {
		await importLikeTheApp(account.token, PLURALKIT_FILE);
		const {response, files} = await exportZip(account.token);

		expect(response.headers.get('content-type')).toBe('application/zip');
		expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename\*=UTF-8''Tyne%20personas%20/);
		expect(pluralKitJsonOf(files)).toEqual(PLURALKIT_FILE);
	});

	it("puts every image in the zip under the persona's name, numbering shared names", async () => {
		await importLikeTheApp(account.token, PLURALKIT_FILE);
		const avatar = await storeImage(account.token, 'avatar', await distinctPng());
		const personas = await createBuilder<Array<PersonaResponse>>(harness, account.token)
			.get('/users/@me/personas')
			.execute();
		const otherAlice = personas.find((p) => p.external_uuid === 'lmnop')!;
		await createBuilder(harness, account.token)
			.patch(`/users/@me/personas/${otherAlice.id}`)
			.body({avatar_hash: avatar.hash})
			.expect(HTTP_STATUS.OK)
			.execute();

		const {files} = await exportZip(account.token);

		expect([...files.keys()].sort()).toEqual([
			'README.txt',
			'avatars/Alice (2).png',
			'avatars/Alice.png',
			'avatars/Bea Two.png',
			'banners/Alice.png',
			'pluralkit.json',
			'tyne.json',
		]);
		expect(files.get('avatars/Alice (2).png')!.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		const manifest = readTyneBundleManifest(JSON.parse(files.get('tyne.json')!.toString('utf8')));
		expect(manifest?.members).toEqual({
			abcde: {avatar: 'avatars/Alice.png', banner: 'banners/Alice.png'},
			fghijk: {avatar: 'avatars/Bea Two.png'},
			lmnop: {avatar: 'avatars/Alice (2).png'},
		});
	});

	it("links an image changed in Tyne to Tyne's copy, and says how to move it to PluralKit", async () => {
		await importLikeTheApp(account.token, PLURALKIT_FILE);
		const personas = await createBuilder<Array<PersonaResponse>>(harness, account.token)
			.get('/users/@me/personas')
			.execute();
		const alice = personas.find((p) => p.external_uuid === 'abcde')!;
		const avatar = await storeImage(account.token, 'avatar', await distinctPng());
		await createBuilder(harness, account.token)
			.patch(`/users/@me/personas/${alice.id}`)
			.body({avatar_hash: avatar.hash})
			.expect(HTTP_STATUS.OK)
			.execute();

		const {files} = await exportZip(account.token);
		const member = pluralKitJsonOf(files).members.find((m: {id: string}) => m.id === 'abcde');

		const media = Config.endpoints.media.replace(/\/+$/, '');
		expect(member.avatar_url).toBe(`${media}/avatars/${account.userId}/${avatar.hash}.png`);
		expect(member.banner).toBe('https://cdn.pluralkit.me/m/abcde/banner.png');
		const readme = files.get('README.txt')!.toString('utf8');
		expect(readme).toContain('pk;member abcde avatar\n      attach: avatars/Alice.png');
		expect(readme).not.toContain('pk;member abcde banner');
	});

	it('writes a persona made in Tyne under its own ID, and keeps what PluralKit has no place for', async () => {
		const created = await createBuilder<PersonaResponse>(harness, account.token)
			.post('/users/@me/personas')
			.body({
				name: 'Alvis',
				bio: 'x'.repeat(1500),
				visibility: 'public',
				auto_tag_disabled: true,
				signature_emojis: [{name: '🌸'}],
				persona_tags: [{prefix: 'v:'}],
			})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		const {files} = await exportZip(account.token);
		const file = pluralKitJsonOf(files);

		expect(file.members[0]).toMatchObject({id: created.id, name: 'Alvis', privacy: PUBLIC});
		expect(file.members[0].description).toHaveLength(1000);
		const manifest = readTyneBundleManifest(JSON.parse(files.get('tyne.json')!.toString('utf8')));
		expect(manifest?.members[created.id]).toEqual({
			bio: 'x'.repeat(1500),
			auto_tag_disabled: true,
			signature_emojis: [{name: '🌸'}],
		});
	});

	it('updates personas in place when an account re-imports its own export', async () => {
		await importLikeTheApp(account.token, PLURALKIT_FILE);
		await createBuilder(harness, account.token)
			.post('/users/@me/personas')
			.body({name: 'Alvis', signature_emojis: [{name: '🌸'}], persona_tags: [{prefix: 'v:'}]})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const first = await exportZip(account.token);
		const before = await createBuilder<Array<PersonaResponse>>(harness, account.token)
			.get('/users/@me/personas')
			.execute();

		await importLikeTheApp(account.token, pluralKitJsonOf(first.files), first.files);

		const after = await createBuilder<Array<PersonaResponse>>(harness, account.token)
			.get('/users/@me/personas')
			.execute();
		expect(after.map((p) => p.id).sort()).toEqual(before.map((p) => p.id).sort());
		const second = await exportZip(account.token);
		expect(pluralKitJsonOf(second.files).members.map((m: {id: string}) => m.id)).toEqual(
			pluralKitJsonOf(first.files).members.map((m: {id: string}) => m.id),
		);
	});

	it('gives another account the same personas from the zip, linking images to its own copies', async () => {
		await importLikeTheApp(account.token, PLURALKIT_FILE);
		await createBuilder(harness, account.token)
			.post('/users/@me/personas')
			.body({name: 'Alvis', bio: 'y'.repeat(1200), signature_emojis: [{name: '🦊'}]})
			.expect(HTTP_STATUS.CREATED)
			.execute();
		const alvisAvatar = await storeImage(account.token, 'avatar', await distinctPng());
		const alvis = (
			await createBuilder<Array<PersonaResponse>>(harness, account.token).get('/users/@me/personas').execute()
		).find((p) => p.name === 'Alvis')!;
		await createBuilder(harness, account.token)
			.patch(`/users/@me/personas/${alvis.id}`)
			.body({avatar_hash: alvisAvatar.hash})
			.expect(HTTP_STATUS.OK)
			.execute();
		const original = await exportZip(account.token);

		const other = await createTestAccount(harness);
		await importLikeTheApp(other.token, pluralKitJsonOf(original.files), original.files);
		const copy = await exportZip(other.token);

		const media = Config.endpoints.media.replace(/\/+$/, '');
		const withoutTyneLinks = (file: {members: Array<Record<string, unknown>>}) => ({
			...file,
			members: file.members.map((member) => ({
				...member,
				avatar_url:
					typeof member.avatar_url === 'string' && member.avatar_url.startsWith(media) ? 'tyne' : member.avatar_url,
			})),
		});
		expect(withoutTyneLinks(pluralKitJsonOf(copy.files))).toEqual(withoutTyneLinks(pluralKitJsonOf(original.files)));
		const alvisInCopy = pluralKitJsonOf(copy.files).members.find((m: {id: string}) => m.id === alvis.id);
		expect(alvisInCopy.avatar_url).toMatch(new RegExp(`^${media}/avatars/${other.userId}/`));
		expect(copy.files.get('tyne.json')!.toString('utf8')).toBe(original.files.get('tyne.json')!.toString('utf8'));
		expect([...copy.files.keys()].sort()).toEqual([...original.files.keys()].sort());
	});

	it('refuses an import that gives a signature emoji to two personas', async () => {
		await createBuilder(harness, account.token)
			.post('/users/@me/personas')
			.body({name: 'Holder', signature_emojis: [{name: '🌸'}]})
			.expect(HTTP_STATUS.CREATED)
			.execute();

		await createBuilder(harness, account.token)
			.post('/users/@me/personas/import')
			.body([{name: 'Newcomer', external_uuid: 'qwert', signature_emojis: [{name: '🌸'}]}])
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
	});

	it('forgets image sources with the persona and with the account', async () => {
		const imported = await importLikeTheApp(account.token, PLURALKIT_FILE);
		const userId = createUserID(BigInt(account.userId));
		expect((await loadPersonaImageSources(userId)).size).toBe(2);

		await createBuilder(harness, account.token)
			.delete(`/users/@me/personas/${imported.find((p) => p.external_uuid === 'abcde')!.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		expect([...(await loadPersonaImageSources(userId)).values()].map((row) => row.avatar_field)).toEqual([
			'webhook_avatar_url',
		]);

		await forgetPersonaImageSourcesOfUser(userId);
		expect((await loadPersonaImageSources(userId)).size).toBe(0);
	});

	it('leaves out links to a media server PluralKit cannot read', async () => {
		Config.endpoints.media = 'http://localhost:8088/media';
		try {
			await createBuilder(harness, account.token)
				.post('/users/@me/personas')
				.body({name: 'Alvis', avatar_hash: (await storeImage(account.token, 'avatar', await distinctPng())).hash})
				.expect(HTTP_STATUS.CREATED)
				.execute();
			const {files} = await exportZip(account.token);
			expect(pluralKitJsonOf(files).members[0].avatar_url).toBeNull();
			expect(files.has('avatars/Alvis.png')).toBe(true);
		} finally {
			Config.endpoints.media = 'https://media.tyne.test/media';
		}
	});

	it('exports an account without personas', async () => {
		const {files} = await exportZip(account.token);
		expect(pluralKitJsonOf(files)).toEqual({version: 2, tag: null, members: [], groups: [], switches: []});
	});
});
