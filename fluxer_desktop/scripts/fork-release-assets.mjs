// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: turns one platform's packaged build into the files a GitHub release of this fork carries
// (see the note at the end of src/main/ShellDownloadFormats.ts). Asset names and URLs come from
// that module, so what is published here is exactly what the in-app updater asks for.
//
//   node scripts/fork-release-assets.mjs --platform win32|darwin|linux --arch x64|arm64 \
//     --version 1.4.0 [--input dist-electron] [--output release_assets] [--repository owner/name]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The stable channel's DESKTOP_ARTIFACT_PRODUCT_NAME under the fork identity (src/common/DesktopIdentity.ts).
const PRODUCT_NAME = 'Tyne';
const DEFAULT_REPOSITORY = 'tyne-chat/tyne';

const INSTALLER_EXTENSIONS = {
	darwin: {dmg: '.dmg', zip: '.zip'},
	linux: {appimage: '.AppImage', deb: '.deb', rpm: '.rpm', tar_gz: '.tar.gz'},
};
const VELOPACK_FEED_PATTERNS = [/^releases\..+\.json$/u, /^assets\..+\.json$/u, /^RELEASES(-.+)?$/u, /-full\.nupkg$/u];

class ReleaseAssetError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ReleaseAssetError';
	}
}

function parseArguments(argv) {
	const options = {input: 'dist-electron', output: 'release_assets', repository: null};
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		const value = argv[index + 1];
		if (!name.startsWith('--') || value === undefined) {
			throw new ReleaseAssetError(`Expected "--name value" pairs, got "${name}"`);
		}
		options[name.slice(2)] = value;
	}
	for (const required of ['platform', 'arch', 'version']) {
		if (!options[required]) {
			throw new ReleaseAssetError(`Missing --${required}`);
		}
	}
	if (!['win32', 'darwin', 'linux'].includes(options.platform)) {
		throw new ReleaseAssetError(`Unsupported --platform ${options.platform}`);
	}
	if (!['x64', 'arm64'].includes(options.arch)) {
		throw new ReleaseAssetError(`Unsupported --arch ${options.arch}`);
	}
	return options;
}

function loadReleaseFeed({platform, arch, repository}) {
	const esbuild = require('esbuild');
	const sourcePath = path.join(ROOT_DIR, 'src/main/ShellDownloadFormats.ts');
	const {code} = esbuild.transformSync(fs.readFileSync(sourcePath, 'utf8'), {
		loader: 'ts',
		format: 'cjs',
		platform: 'node',
		target: 'node20',
	});
	const module = {exports: {}};
	const context = vm.createContext({
		require: (specifier) => {
			if (specifier === '@electron/common/BuildChannel') return {BUILD_CHANNEL: 'stable'};
			throw new ReleaseAssetError(
				`ShellDownloadFormats.ts gained an import this script does not provide: ${specifier}`,
			);
		},
		module,
		exports: module.exports,
		process: {platform, arch, env: {FLUXER_FORK_RELEASES: repository}},
		encodeURIComponent,
	});
	vm.runInContext(code, context, {filename: sourcePath});
	if (module.exports.forkReleaseRepository() !== repository) {
		throw new ReleaseAssetError(`"${repository}" is not an owner/name repository`);
	}
	return module.exports;
}

function listFiles(directory) {
	if (!fs.existsSync(directory)) {
		return [];
	}
	return fs
		.readdirSync(directory, {withFileTypes: true})
		.filter((entry) => entry.isFile())
		.map((entry) => path.join(directory, entry.name));
}

function findOne(files, matches, description) {
	const found = files.filter((file) => matches(path.basename(file)));
	if (found.length !== 1) {
		const names = found.map((file) => path.basename(file)).join(', ') || 'none';
		throw new ReleaseAssetError(`Expected exactly one ${description}, found ${found.length} (${names})`);
	}
	return found[0];
}

function sha256Of(file) {
	return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function collectInstallers({platform, arch, input}) {
	if (platform === 'win32') {
		const velopackDir = path.join(input, `velopack-windows-${arch}`);
		const files = listFiles(velopackDir);
		const setup = findOne(files, (name) => name.endsWith('-Setup.exe'), `Velopack Setup.exe in ${velopackDir}`);
		const feed = files.filter((file) => VELOPACK_FEED_PATTERNS.some((pattern) => pattern.test(path.basename(file))));
		if (!feed.some((file) => path.basename(file).endsWith('-full.nupkg'))) {
			throw new ReleaseAssetError(`No Velopack full package in ${velopackDir}`);
		}
		return {installers: {setup}, verbatim: feed};
	}
	const files = listFiles(input);
	const installers = {};
	for (const [format, extension] of Object.entries(INSTALLER_EXTENSIONS[platform])) {
		installers[format] = findOne(files, (name) => name.endsWith(extension), `${extension} file in ${input}`);
	}
	return {installers, verbatim: []};
}

function main() {
	const options = parseArguments(process.argv.slice(2));
	const repository = options.repository ?? process.env.FLUXER_FORK_RELEASES ?? DEFAULT_REPOSITORY;
	const feed = loadReleaseFeed({platform: options.platform, arch: options.arch, repository});
	const input = path.resolve(ROOT_DIR, options.input);
	const output = path.resolve(ROOT_DIR, options.output);
	fs.mkdirSync(output, {recursive: true});

	const {installers, verbatim} = collectInstallers({platform: options.platform, arch: options.arch, input});
	const files = {};
	const published = [];
	for (const [format, source] of Object.entries(installers)) {
		const name = feed.forkReleaseAssetName(PRODUCT_NAME, options.version, format, options.arch);
		fs.copyFileSync(source, path.join(output, name));
		files[format] = {
			url: feed.forkVersionDownloadUrl(PRODUCT_NAME, options.version, format, options.arch),
			sha256: sha256Of(source),
		};
		published.push(name);
	}
	for (const source of verbatim) {
		fs.copyFileSync(source, path.join(output, path.basename(source)));
		published.push(path.basename(source));
	}
	const latestName = path.basename(new URL(feed.forkLatestInfoUrl(options.platform, options.arch)).pathname);
	fs.writeFileSync(
		path.join(output, latestName),
		`${JSON.stringify({version: options.version, pub_date: new Date().toISOString(), files}, null, '\t')}\n`,
	);
	published.push(latestName);
	console.log(`Release assets for ${options.platform}/${options.arch} ${options.version} in ${output}:`);
	for (const name of published.sort()) {
		console.log(`  ${name}`);
	}
}

try {
	main();
} catch (error) {
	if (error instanceof ReleaseAssetError) {
		console.error(error.message);
		process.exit(1);
	}
	throw error;
}
