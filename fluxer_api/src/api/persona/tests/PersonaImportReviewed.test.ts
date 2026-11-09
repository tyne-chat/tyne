// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the reviewed import's routes end to end (tyne-chat/tyne#243): the preview changes nothing,
// each action does only what it says, a refused import writes nothing, and a deleted persona comes
// back as itself.

import {createTestAccount, type TestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {HTTP_STATUS} from '@app/api/test/TestConstants';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import type {PersonaImportItem, PersonaResponse} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import type {
	PersonaImportAction,
	PersonaImportApplyResponse,
	PersonaImportPreviewMember,
	PersonaImportPreviewResponse,
	PersonaRestoreResponse,
} from '@fluxer/schema/src/domains/persona/PersonaImportPlanSchemas';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

describe('reviewed persona import', () => {
	let harness: ApiTestHarness;
	let owner: TestAccount;

	beforeAll(async () => {
		harness = await createApiTestHarness();
	});

	beforeEach(async () => {
		await harness.reset();
		owner = await createTestAccount(harness);
	});

	afterAll(async () => {
		await harness?.shutdown();
	});

	const legacyImport = (items: Array<PersonaImportItem>) =>
		createBuilder<Array<PersonaResponse>>(harness, owner.token)
			.post('/users/@me/personas/import')
			.body(items)
			.expect(HTTP_STATUS.OK)
			.execute();

	const create = (body: Record<string, unknown>) =>
		createBuilder<PersonaResponse>(harness, owner.token)
			.post('/users/@me/personas')
			.body(body)
			.expect(HTTP_STATUS.CREATED)
			.execute();

	const remove = (id: string) =>
		createBuilder(harness, owner.token).delete(`/users/@me/personas/${id}`).expect(HTTP_STATUS.NO_CONTENT).execute();

	const list = () => createBuilder<Array<PersonaResponse>>(harness, owner.token).get('/users/@me/personas').execute();

	const preview = (members: Array<PersonaImportPreviewMember>, displayTag?: string) =>
		createBuilder<PersonaImportPreviewResponse>(harness, owner.token)
			.post('/users/@me/personas/import/preview')
			.body({source: 'pluralkit', members, display_tag: displayTag ? {text: displayTag} : null})
			.expect(HTTP_STATUS.OK)
			.execute();

	const apply = (actions: Array<PersonaImportAction>) =>
		createBuilder<PersonaImportApplyResponse>(harness, owner.token)
			.post('/users/@me/personas/import/apply')
			.body({source: 'pluralkit', actions});

	const snapshot = async () =>
		(await list())
			.map((p) => JSON.stringify([p.id, p.name, p.persona_tags, p.external_uuid, p.bio, p.visibility]))
			.sort();

	it('classifies the members against live and deleted personas, and changes nothing', async () => {
		const [wren, pip] = await legacyImport([
			{name: 'Wren', persona_tags: [{prefix: 'wr:'}], external_uuid: 'aaaaa'},
			{name: 'Pip', persona_tags: [{prefix: 'pi:'}], external_uuid: 'ppppp'},
		]);
		const kestrel = await create({name: 'Kestrel', persona_tags: [{prefix: 'ke:'}]});
		await remove(pip!.id);
		const before = await snapshot();

		const result = await preview(
			[
				{name: 'Wren', persona_tags: [{prefix: 'wr:'}], external_uuid: 'aaaaa'},
				{name: 'Pip', persona_tags: [{prefix: 'pi:'}], external_uuid: 'ppppp'},
				{name: 'Kestrel', persona_tags: [{prefix: 'ke:'}], external_uuid: 'kkkkk'},
				{name: 'Sorrel', persona_tags: [{prefix: 'so:'}], external_uuid: 'sssss'},
			],
			'[ Lantern ]',
		);

		expect(result.entries.map((e) => [e.kind, e.persona_id ?? null])).toEqual([
			['up_to_date', wren!.id],
			['deleted', pip!.id],
			['probably_same', kestrel.id],
			['new', null],
		]);
		expect(result.personas.find((p) => p.id === pip!.id)?.deleted_at).toBeTruthy();
		expect(result.needs_review).toBe(true);
		expect(result.display_tag.decision).toBe('ask');
		expect(await snapshot()).toEqual(before);
	});

	it('links, restores, adds and uses the file, each doing only what it says', async () => {
		const [wren, pip] = await legacyImport([
			{name: 'Wren', bio: 'Old bio', visibility: 'unlisted', external_uuid: 'aaaaa'},
			{name: 'Pip', persona_tags: [{prefix: 'pi:'}], external_uuid: 'ppppp'},
		]);
		const kestrel = await create({name: 'Kestrel', bio: 'Made here', persona_tags: [{prefix: 'ke:'}]});
		await remove(pip!.id);

		const result = await apply([
			{action: 'link', persona_id: kestrel.id, external_uuid: 'kkkkk'},
			{action: 'restore', persona_id: pip!.id},
			{action: 'add', item: {name: 'Sorrel', persona_tags: [{prefix: 'so:'}], external_uuid: 'sssss'}},
			{
				action: 'use_file',
				persona_id: wren!.id,
				item: {name: 'Wren Ashby', bio: 'New bio', visibility: 'public', external_uuid: 'aaaaa'},
			},
		])
			.expect(HTTP_STATUS.OK)
			.execute();

		expect(result.personas.map((p) => p.name)).toEqual(['Kestrel', 'Pip', 'Sorrel', 'Wren Ashby']);
		const after = new Map((await list()).map((p) => [p.id, p]));
		expect(after.get(kestrel.id)).toMatchObject({name: 'Kestrel', bio: 'Made here', external_uuid: 'kkkkk'});
		expect(after.get(pip!.id)).toMatchObject({name: 'Pip', persona_tags: [{prefix: 'pi:'}]});
		expect(after.get(pip!.id)?.deleted_at ?? null).toBeNull();
		expect(after.get(wren!.id)).toMatchObject({name: 'Wren Ashby', bio: 'New bio', visibility: 'unlisted'});
		expect([...after.values()].some((p) => p.name === 'Sorrel' && p.external_uuid === 'sssss')).toBe(true);
	});

	it("connects a persona the review asked about when the file's version is used, and one of several linked to a member", async () => {
		const kestrel = await create({name: 'Kestrel', bio: 'Made here', persona_tags: [{prefix: 'ke:'}]});
		// Two personas linked to one member, as an older import could leave them (tyne-chat/tyne#571).
		const first = await create({name: 'Kenoma', external_uuid: 'ddddd'});
		const second = await create({name: 'Kenoma', external_uuid: 'ddddd'});

		await apply([
			{
				action: 'use_file',
				persona_id: kestrel.id,
				item: {name: 'Kestrel', bio: 'From the file', external_uuid: 'kkkkk'},
			},
			{action: 'link', persona_id: second.id, external_uuid: 'ddddd'},
		])
			.expect(HTTP_STATUS.OK)
			.execute();

		const after = new Map((await list()).map((p) => [p.id, p]));
		expect(after.get(kestrel.id)).toMatchObject({bio: 'From the file', external_uuid: 'kkkkk'});
		// The chosen one keeps the link; the other keeps everything else and is no longer connected.
		expect(after.get(second.id)).toMatchObject({name: 'Kenoma', external_uuid: 'ddddd'});
		expect(after.get(first.id)).toMatchObject({name: 'Kenoma'});
		expect(after.get(first.id)?.external_uuid ?? null).toBeNull();
	});

	it("brings a deleted persona back with the file's details, or as it was beside a copy", async () => {
		const [pip, moss] = await legacyImport([
			{name: 'Pip', bio: 'Old', persona_tags: [{prefix: 'pi:'}], external_uuid: 'ppppp'},
			{name: 'Moss', bio: 'Mossy', persona_tags: [{prefix: 'mo:'}], external_uuid: 'mmmmm'},
		]);
		await remove(pip!.id);
		await remove(moss!.id);

		await apply([
			{
				action: 'use_file',
				persona_id: pip!.id,
				item: {name: 'Pip', bio: 'From the file', persona_tags: [{prefix: 'pip:'}], external_uuid: 'ppppp'},
			},
			{action: 'restore', persona_id: moss!.id},
			{action: 'add', item: {name: 'Moss (2)', persona_tags: [{prefix: 'mos:'}], external_uuid: null}},
		])
			.expect(HTTP_STATUS.OK)
			.execute();

		const after = await list();
		expect(after.find((p) => p.id === pip!.id)).toMatchObject({
			bio: 'From the file',
			persona_tags: [{prefix: 'pip:'}],
			external_uuid: 'ppppp',
		});
		expect(after.find((p) => p.id === pip!.id)?.deleted_at ?? null).toBeNull();
		expect(after.find((p) => p.id === moss!.id)).toMatchObject({bio: 'Mossy', persona_tags: [{prefix: 'mo:'}]});
		expect(after.some((p) => p.name === 'Moss (2)' && (p.external_uuid ?? null) === null)).toBe(true);
	});

	it('moves a persona connected to another member to the one the review gave it', async () => {
		const [kestrel] = await legacyImport([{name: 'Kestrel', external_uuid: 'aaaaa'}]);
		await apply([{action: 'link', persona_id: kestrel!.id, external_uuid: 'bbbbb'}])
			.expect(HTTP_STATUS.OK)
			.execute();
		expect((await list()).find((p) => p.id === kestrel!.id)?.external_uuid).toBe('bbbbb');
	});

	it('writes nothing when the import would go over the persona cap', async () => {
		await create({name: 'Already here'});
		const actions: Array<PersonaImportAction> = Array.from({length: 250}, (_, i) => ({
			action: 'add',
			item: {name: `Member ${i}`},
		}));
		await apply(actions).expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.PERSONA_LIMIT_REACHED).execute();
		expect((await list()).map((p) => p.name)).toEqual(['Already here']);
	});

	it("keeps a persona's picture when the file's could not be stored, and never its signature emojis from PluralKit", async () => {
		const [ash] = await legacyImport([
			{name: 'Ash', avatar_hash: 'aaaa0001', external_uuid: 'aaaaa', signature_emojis: [{name: '🌿'}]},
		]);
		await apply([
			{action: 'use_file', persona_id: ash!.id, keep_avatar: true, item: {name: 'Ash', external_uuid: 'aaaaa'}},
		])
			.expect(HTTP_STATUS.OK)
			.execute();
		const after = (await list()).find((p) => p.id === ash!.id);
		expect(after?.avatar_hash).toBe('aaaa0001');
		expect(after?.signature_emojis).toEqual([{name: '🌿'}]);
	});

	it('writes nothing when the actions contradict each other or would leave a tag on two personas', async () => {
		const [wren] = await legacyImport([{name: 'Wren', persona_tags: [{prefix: 'wr:'}], external_uuid: 'aaaaa'}]);
		const before = await snapshot();

		await apply([
			{action: 'add', item: {name: 'Sorrel'}},
			{action: 'link', persona_id: wren!.id, external_uuid: 'bbbbb'},
			{action: 'use_file', persona_id: wren!.id, item: {name: 'Wren', external_uuid: 'aaaaa'}},
		])
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.PERSONA_IMPORT_CONFLICT)
			.execute();
		await apply([{action: 'add', item: {name: 'Wrennie', persona_tags: [{prefix: 'wr:'}]}}])
			.expect(HTTP_STATUS.BAD_REQUEST, APIErrorCodes.DUPLICATE_PERSONA_TAG)
			.execute();
		await apply([
			{action: 'add', item: {name: 'Wrennie', persona_tags: [{prefix: 'wr:'}]}, drop_tags: [{prefix: 'wr:'}]},
		])
			.expect(HTTP_STATUS.OK)
			.execute();

		const after = await snapshot();
		expect(after.filter((row) => !row.includes('Wrennie'))).toEqual(before);
	});

	it('lists deleted personas and restores one as itself, leaving off a tag another persona took meanwhile', async () => {
		const quince = await create({name: 'Quince', persona_tags: [{prefix: 'qu:'}]});
		await remove(quince.id);
		await create({name: 'Quill', persona_tags: [{prefix: 'qu:'}]});

		const deleted = await createBuilder<Array<PersonaResponse>>(harness, owner.token)
			.get('/users/@me/personas/deleted')
			.execute();
		expect(deleted.map((p) => p.id)).toEqual([quince.id]);
		expect((await list()).map((p) => p.name)).toEqual(['Quill']);

		const restored = await createBuilder<PersonaRestoreResponse>(harness, owner.token)
			.post(`/users/@me/personas/deleted/${quince.id}/restore`)
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(restored.persona).toMatchObject({id: quince.id, name: 'Quince', persona_tags: []});
		expect(restored.dropped_tags).toEqual([{prefix: 'qu:'}]);
		expect((await list()).map((p) => p.name).sort()).toEqual(['Quill', 'Quince']);
	});

	it("keeps a deleted persona's image sources, so after a restore its picture still compares", async () => {
		const [ash] = await legacyImport([
			{
				name: 'Ash',
				avatar_hash: 'aaaa0001',
				external_uuid: 'aaaaa',
				image_sources: {avatar: {url: 'https://cdn.example/ash.png', field: 'avatar_url'}},
			},
		]);
		await remove(ash!.id);
		await createBuilder(harness, owner.token)
			.post(`/users/@me/personas/deleted/${ash!.id}/restore`)
			.expect(HTTP_STATUS.OK)
			.execute();

		const result = await preview([{name: 'Ash', external_uuid: 'aaaaa', avatar: {url: 'https://cdn.example/ash.png'}}]);
		expect(result.entries[0]).toMatchObject({kind: 'up_to_date', differences: [], avatar_hash: 'aaaa0001'});
	});
});
