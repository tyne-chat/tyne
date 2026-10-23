// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: an installed app replaces itself only with files its maintainers signed. The release
// workflow (.github/workflows/fork-desktop-release.yaml) lists the SHA-256 of every file of a
// release in SHA256SUMS.txt and signs that list with an Ed25519 key kept as a secret of the
// "desktop-release" environment, publishing the signature as SHA256SUMS.txt.sig. Before installing,
// the app fetches both files of that version's release, checks the signature against a public key
// below, and installs only a package whose name and SHA-256 the list gives. Write access to the
// repository alone (a stolen token, a compromised workflow step) can then publish a release but not
// one that installed apps accept.
//
// - The package name carries its version, and the list is fetched by that version's tag, so a
//   release cannot pass an older signed package off as a newer one.
// - Rotating the key: add the new public key here and to scripts/fork-release-signing-keys.pem,
//   ship a release signed with the old key, then switch the secret. Keep the old key here until
//   no installed app is older than that release.
// - Builds without FLUXER_FORK_RELEASES (upstream's) are not fork releases: nothing is checked.

import {createPublicKey, type KeyObject, verify} from 'node:crypto';
import {DESKTOP_ARTIFACT_PRODUCT_NAME, WINDOWS_VELOPACK_ID} from '@electron/common/DesktopIdentity';
import {forkReleaseAssetName, forkReleaseRepository} from '@electron/main/ShellDownloadFormats';
import {net} from 'electron';
import type {UpdateInfo, VelopackAsset} from 'velopack';

// The same keys as scripts/fork-release-signing-keys.pem, which the release workflow checks the
// signature with before publishing (ForkReleaseSignature.test.mjs keeps the two equal).
export const FORK_RELEASE_SIGNING_KEYS: ReadonlyArray<string> = [
	// Created 2026-10-22, the first key.
	'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAIIaScqvSJiAkm1L+iflaTDW8UUd+Q8YcjlSJDsTf+CE=\n-----END PUBLIC KEY-----\n',
];

export const FORK_RELEASE_CHECKSUMS_NAME = 'SHA256SUMS.txt';
export const FORK_RELEASE_SIGNATURE_NAME = `${FORK_RELEASE_CHECKSUMS_NAME}.sig`;
const FORK_RELEASE_TAG_PREFIX = 'desktop-v';
const FETCH_TIMEOUT_MS = 30_000;
const CHECKSUM_LINE = /^([0-9a-f]{64}) [ *](.+)$/u;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

interface SignatureOptions {
	readonly fetchImpl?: FetchImpl;
	readonly keys?: ReadonlyArray<string>;
}

export function parseReleaseChecksums(text: string): Map<string, string> {
	const checksums = new Map<string, string>();
	for (const line of text.split('\n')) {
		const match = CHECKSUM_LINE.exec(line.trimEnd());
		if (match != null) checksums.set(match[2], match[1]);
	}
	return checksums;
}

export function isSignedByReleaseKey(
	data: Uint8Array,
	signature: Uint8Array,
	keys: ReadonlyArray<string> = FORK_RELEASE_SIGNING_KEYS,
): boolean {
	return keys.some((pem) => {
		let key: KeyObject;
		try {
			key = createPublicKey(pem);
		} catch {
			return false;
		}
		return key.asymmetricKeyType === 'ed25519' && verify(null, data, key, signature);
	});
}

async function fetchReleaseFile(fetchImpl: FetchImpl, url: string): Promise<Uint8Array> {
	const response = await fetchImpl(url, {cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
	if (!response.ok) {
		throw new Error(`${url} answered ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

// The SHA-256 the signed list of release desktop-v<version> gives for fileName. Throws when the
// list or its signature is missing, the signature does not verify, or the file is not listed.
export async function fetchSignedReleaseChecksum(
	repository: string,
	version: string,
	fileName: string,
	{fetchImpl = net.fetch, keys = FORK_RELEASE_SIGNING_KEYS}: SignatureOptions = {},
): Promise<string> {
	const base = `https://github.com/${repository}/releases/download/${encodeURIComponent(`${FORK_RELEASE_TAG_PREFIX}${version}`)}`;
	const [checksums, signature] = await Promise.all([
		fetchReleaseFile(fetchImpl, `${base}/${FORK_RELEASE_CHECKSUMS_NAME}`),
		fetchReleaseFile(fetchImpl, `${base}/${FORK_RELEASE_SIGNATURE_NAME}`),
	]);
	if (!isSignedByReleaseKey(checksums, signature, keys)) {
		throw new Error(`the signature of ${FORK_RELEASE_CHECKSUMS_NAME} in release ${version} does not verify`);
	}
	const sha256 = parseReleaseChecksums(new TextDecoder().decode(checksums)).get(fileName);
	if (sha256 == null) {
		throw new Error(`${fileName} is not in the signed ${FORK_RELEASE_CHECKSUMS_NAME} of release ${version}`);
	}
	return sha256;
}

async function refusal(check: () => Promise<string | null>): Promise<string | null> {
	try {
		return await check();
	} catch (error) {
		return `update refused: ${error instanceof Error ? error.message : String(error)}`;
	}
}

// Why the Windows package Velopack downloaded must not be installed, or null if it may be.
export function forkVelopackUpdateRefusal(
	staged: UpdateInfo | VelopackAsset,
	options: SignatureOptions = {},
): Promise<string | null> {
	return refusal(async () => {
		const repository = forkReleaseRepository();
		if (repository == null) return null;
		const asset = 'TargetFullRelease' in staged ? staged.TargetFullRelease : staged;
		const expectedName = `${WINDOWS_VELOPACK_ID}-${asset.Version}-full.nupkg`;
		if (asset.FileName !== expectedName) {
			return `update refused: the feed offers ${asset.FileName} for version ${asset.Version}, expected ${expectedName}`;
		}
		if (!/^[0-9a-f]{64}$/iu.test(asset.SHA256 ?? '')) {
			return `update refused: the feed gives no SHA-256 for ${asset.FileName}`;
		}
		const signed = await fetchSignedReleaseChecksum(repository, asset.Version, asset.FileName, options);
		return signed === asset.SHA256.toLowerCase()
			? null
			: `update refused: ${asset.FileName} in the feed does not match the signed checksum`;
	});
}

// Why the AppImage of this version must not be installed with this checksum, or null if it may be.
export function forkAppImageUpdateRefusal(
	version: string,
	sha256: string,
	options: SignatureOptions = {},
): Promise<string | null> {
	return refusal(async () => {
		const repository = forkReleaseRepository();
		if (repository == null) return null;
		const fileName = forkReleaseAssetName(DESKTOP_ARTIFACT_PRODUCT_NAME, version, 'appimage');
		const signed = await fetchSignedReleaseChecksum(repository, version, fileName, options);
		return signed === sha256.trim().toLowerCase()
			? null
			: `update refused: the published checksum of ${fileName} does not match the signed one`;
	});
}
