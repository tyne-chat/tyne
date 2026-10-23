// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {beforeEach, describe, test} from 'node:test';
import {installElectronStub} from './LocalAppTestSupport.test.mjs';

process.env.FLUXER_FORK_RELEASES = 'tyne-chat/tyne';

const velopack = {checkResult: null, calls: []};

class FakeUpdateManager {
	getCurrentVersion() {
		return '2.1.6';
	}

	getUpdatePendingRestart() {
		return null;
	}

	async checkForUpdatesAsync() {
		velopack.calls.push('checkForUpdatesAsync');
		return velopack.checkResult;
	}

	async downloadUpdateAsync() {
		velopack.calls.push('downloadUpdateAsync');
	}

	waitExitThenApplyUpdate(update) {
		velopack.calls.push(`waitExitThenApplyUpdate:${update.TargetFullRelease.Version}`);
	}
}

const requireFromHere = createRequire(import.meta.url);
const VELOPACK_PATH = requireFromHere.resolve('velopack');
requireFromHere.cache[VELOPACK_PATH] = {
	id: VELOPACK_PATH,
	filename: VELOPACK_PATH,
	loaded: true,
	exports: {UpdateManager: FakeUpdateManager},
};

// What the release server holds: url -> {status, body}.
const served = new Map();
const fetched = [];
async function fakeFetch(url) {
	fetched.push(url);
	const file = served.get(url);
	if (file == null) return new Response('Not Found', {status: 404});
	return new Response(file.body, {status: file.status ?? 200});
}

const userDataPath = mkdtempSync(path.join(tmpdir(), 'tyne-release-signature-'));
process.on('exit', () => {
	rmSync(userDataPath, {recursive: true, force: true});
});
installElectronStub({
	app: {getVersion: () => '2.1.6', getPath: () => userDataPath, quit: () => {}},
	autoUpdater: {on() {}, removeListener() {}},
	net: {fetch: fakeFetch},
});

const {
	FORK_RELEASE_SIGNING_KEYS,
	fetchSignedReleaseChecksum,
	forkAppImageUpdateRefusal,
	forkVelopackUpdateRefusal,
	isSignedByReleaseKey,
	parseReleaseChecksums,
} = await import('@electron/main/ForkReleaseSignature');
const {forkReleaseAssetName} = await import('@electron/main/ShellDownloadFormats');
const {DESKTOP_ARTIFACT_PRODUCT_NAME, WINDOWS_VELOPACK_ID} = await import('@electron/common/DesktopIdentity');
const {runShellSelfUpdate} = await import('@electron/main/ShellSelfUpdate');

function newKey() {
	const {publicKey, privateKey} = generateKeyPairSync('ed25519');
	return {privateKey, pem: publicKey.export({type: 'spki', format: 'pem'})};
}

const releaseKey = newKey();
const otherKey = newKey();
const keys = [releaseKey.pem];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const NUPKG = `${WINDOWS_VELOPACK_ID}-2.1.7-full.nupkg`;
const APPIMAGE = forkReleaseAssetName(DESKTOP_ARTIFACT_PRODUCT_NAME, '2.1.7', 'appimage');
const NUPKG_SHA256 = sha256('the 2.1.7 package');
const APPIMAGE_SHA256 = sha256('the 2.1.7 AppImage');
const BASE = 'https://github.com/tyne-chat/tyne/releases/download/desktop-v2.1.7';

// Publishes a release's SHA256SUMS.txt and its signature, as the release workflow does.
function publishRelease({base = BASE, lines, signer = releaseKey.privateKey, signature = null}) {
	const sums = Buffer.from(`${lines.join('\n')}\n`);
	served.set(`${base}/SHA256SUMS.txt`, {body: sums});
	served.set(`${base}/SHA256SUMS.txt.sig`, {body: signature ?? sign(null, sums, signer)});
}

function publishGenuineRelease() {
	publishRelease({lines: [`${NUPKG_SHA256}  ${NUPKG}`, `${APPIMAGE_SHA256}  ${APPIMAGE}`]});
}

function velopackAsset(overrides = {}) {
	return {Version: '2.1.7', FileName: NUPKG, SHA256: NUPKG_SHA256.toUpperCase(), Size: 1, ...overrides};
}

beforeEach(() => {
	served.clear();
	fetched.length = 0;
	velopack.checkResult = null;
	velopack.calls.length = 0;
});

describe('the release signing key', () => {
	test('is an Ed25519 key, and the same one the release workflow checks with', () => {
		assert.ok(FORK_RELEASE_SIGNING_KEYS.length > 0, 'no release signing key is built into the app');
		for (const pem of FORK_RELEASE_SIGNING_KEYS) {
			assert.equal(isSignedByReleaseKey(Buffer.from('x'), Buffer.alloc(64), [pem]), false);
			assert.match(pem, /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+-----END PUBLIC KEY-----\n$/u);
		}
		const workflowKeys = readFileSync(new URL('../../scripts/fork-release-signing-keys.pem', import.meta.url), 'utf8');
		assert.equal(workflowKeys, FORK_RELEASE_SIGNING_KEYS.join(''));
	});
});

describe('signature checks', () => {
	test('read sha256sum output in text and binary mode', () => {
		const checksums = parseReleaseChecksums(`${'a'.repeat(64)}  one.txt\n${'b'.repeat(64)} *two words.bin\nnoise\n`);
		assert.deepEqual(
			[...checksums],
			[
				['one.txt', 'a'.repeat(64)],
				['two words.bin', 'b'.repeat(64)],
			],
		);
	});

	test('accept the release key only, and only for the bytes it signed', () => {
		const data = Buffer.from(`${NUPKG_SHA256}  ${NUPKG}\n`);
		const signature = sign(null, data, releaseKey.privateKey);
		assert.equal(isSignedByReleaseKey(data, signature, keys), true);
		assert.equal(isSignedByReleaseKey(Buffer.from(`${APPIMAGE_SHA256}  ${NUPKG}\n`), signature, keys), false);
		assert.equal(isSignedByReleaseKey(data, sign(null, data, otherKey.privateKey), keys), false);
		assert.equal(isSignedByReleaseKey(data, signature, ['not a key']), false);
		assert.equal(isSignedByReleaseKey(data, signature, []), false);
	});

	test('fetch the list and signature of the version asked for', async () => {
		publishGenuineRelease();
		assert.equal(
			await fetchSignedReleaseChecksum('tyne-chat/tyne', '2.1.7', NUPKG, {fetchImpl: fakeFetch, keys}),
			NUPKG_SHA256,
		);
		assert.deepEqual(fetched.sort(), [`${BASE}/SHA256SUMS.txt`, `${BASE}/SHA256SUMS.txt.sig`]);
	});

	test('fail when the signature is missing, wrong, or the file is not listed', async () => {
		const check = (name = NUPKG) =>
			fetchSignedReleaseChecksum('tyne-chat/tyne', '2.1.7', name, {fetchImpl: fakeFetch, keys});
		await assert.rejects(check(), /SHA256SUMS\.txt answered 404/u);
		publishGenuineRelease();
		served.delete(`${BASE}/SHA256SUMS.txt.sig`);
		await assert.rejects(check(), /SHA256SUMS\.txt\.sig answered 404/u);
		publishRelease({lines: [`${NUPKG_SHA256}  ${NUPKG}`], signer: otherKey.privateKey});
		await assert.rejects(check(), /does not verify/u);
		publishGenuineRelease();
		await assert.rejects(check('Tyne-Setup-2.1.7-win-x64.exe'), /is not in the signed SHA256SUMS\.txt/u);
	});
});

describe('the Windows update', () => {
	test('is allowed when the feed matches the signed list', async () => {
		publishGenuineRelease();
		assert.equal(
			await forkVelopackUpdateRefusal({TargetFullRelease: velopackAsset()}, {fetchImpl: fakeFetch, keys}),
			null,
		);
		assert.equal(await forkVelopackUpdateRefusal(velopackAsset(), {fetchImpl: fakeFetch, keys}), null);
	});

	test('is refused when the feed gives another checksum, none, or an older package as newer', async () => {
		publishGenuineRelease();
		const refusal = (asset) => forkVelopackUpdateRefusal(asset, {fetchImpl: fakeFetch, keys});
		assert.match(
			await refusal(velopackAsset({SHA256: sha256('something else')})),
			/does not match the signed checksum/u,
		);
		assert.match(await refusal(velopackAsset({SHA256: ''})), /gives no SHA-256/u);
		assert.match(
			await refusal(velopackAsset({Version: '9.0.0'})),
			new RegExp(`offers ${NUPKG} for version 9\\.0\\.0, expected ${WINDOWS_VELOPACK_ID}-9\\.0\\.0-full\\.nupkg`, 'u'),
		);
	});

	test('is refused when the signed list cannot be read', async () => {
		assert.match(
			await forkVelopackUpdateRefusal(velopackAsset(), {fetchImpl: fakeFetch, keys}),
			/^update refused: .*answered 404/u,
		);
		assert.match(
			await forkVelopackUpdateRefusal(velopackAsset(), {
				fetchImpl: async () => {
					throw new Error('offline');
				},
				keys,
			}),
			/^update refused: offline$/u,
		);
	});
});

describe('the AppImage update', () => {
	test('is allowed only with the signed checksum', async () => {
		publishGenuineRelease();
		const refusal = (checksum) => forkAppImageUpdateRefusal('2.1.7', checksum, {fetchImpl: fakeFetch, keys});
		assert.equal(await refusal(APPIMAGE_SHA256.toUpperCase()), null);
		assert.match(await refusal(sha256('a tampered AppImage')), /does not match the signed one/u);
	});

	test('is refused when the release has no signature', async () => {
		publishRelease({lines: [`${APPIMAGE_SHA256}  ${APPIMAGE}`], signature: Buffer.alloc(64)});
		assert.match(
			await forkAppImageUpdateRefusal('2.1.7', APPIMAGE_SHA256, {fetchImpl: fakeFetch, keys}),
			/does not verify/u,
		);
	});
});

describe('the Windows self update', () => {
	const hooks = {onDownloading: () => {}, onRestarting: () => {}};

	test('never installs a package the signed list does not give', async () => {
		// The app's own key, since runShellSelfUpdate uses it: nothing signed with a test key passes.
		publishGenuineRelease();
		velopack.checkResult = {TargetFullRelease: velopackAsset()};
		const result = await runShellSelfUpdate({capability: 'self-update', updater: 'velopack'}, hooks);
		assert.equal(result.reason, 'check-failed');
		assert.match(
			result.detail,
			/^update refused: the signature of SHA256SUMS\.txt in release 2\.1\.7 does not verify$/u,
		);
		assert.deepEqual(velopack.calls, ['checkForUpdatesAsync', 'downloadUpdateAsync']);
	});

	test('installs a package the signed list gives', async () => {
		// Stands in for the release key for this test only.
		FORK_RELEASE_SIGNING_KEYS.push(releaseKey.pem);
		try {
			publishGenuineRelease();
			velopack.checkResult = {TargetFullRelease: velopackAsset()};
			let settled = false;
			void runShellSelfUpdate({capability: 'self-update', updater: 'velopack'}, hooks).then(() => {
				settled = true;
			});
			for (let turn = 0; turn < 20 && !velopack.calls.includes('waitExitThenApplyUpdate:2.1.7'); turn += 1) {
				await new Promise((resolve) => setImmediate(resolve));
			}
			assert.deepEqual(velopack.calls, [
				'checkForUpdatesAsync',
				'downloadUpdateAsync',
				'waitExitThenApplyUpdate:2.1.7',
			]);
			assert.equal(settled, false, 'an update that installs quits the app instead of resolving');
		} finally {
			FORK_RELEASE_SIGNING_KEYS.pop();
		}
	});
});
