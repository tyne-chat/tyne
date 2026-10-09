// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: asks the real Windows updater library (Velopack) whether a release of this fork can be
// found, the way an installed app would. The library decides for itself how to read a URL, so
// only running it shows whether a published release is reachable: 2.0.0 to 2.0.2 shipped with
// an update source it could not read, and every check failed with HTTP 404.
//
//   node scripts/fork-verify-update-feed.cjs --repository owner/name --expect 2.0.3 \
//     [--installed 0.0.1] [--velopack path/to/node_modules/velopack] [--attempts 10]
//
// It pretends to be an installed copy at --installed and passes when the library offers
// --expect. Nothing is downloaded. The update source is the one the app uses,
// forkVelopackSourceUrl() in src/main/ShellDownloadFormats.ts (ForkReleaseFeed.test.mjs holds
// the two together).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArguments(argv) {
	const options = {installed: '0.0.1', velopack: 'velopack', attempts: '10'};
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		const value = argv[index + 1];
		if (!name.startsWith('--') || value === undefined) {
			throw new Error(`Expected "--name value" pairs, got "${name}"`);
		}
		options[name.slice(2)] = value;
	}
	for (const required of ['repository', 'expect']) {
		if (!options[required]) throw new Error(`Missing --${required}`);
	}
	if (!/^[\w.-]+\/[\w.-]+$/u.test(options.repository)) {
		throw new Error(`"${options.repository}" is not an owner/name repository`);
	}
	return options;
}

function installedAppAt(root, version) {
	for (const directory of ['current', 'packages']) {
		fs.mkdirSync(path.join(root, directory), {recursive: true});
	}
	const manifest = path.join(root, 'current', 'sq.version');
	fs.writeFileSync(
		manifest,
		`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd"><metadata>
<id>fluxer_desktop_temple</id><title>Fluxer Temple</title><description>Fluxer Temple</description>
<authors>Fluxer Platform AB</authors><version>${version}</version><channel>win</channel>
<mainExe>Fluxer Temple.exe</mainExe><os>win</os><rid>win-x64</rid>
</metadata></package>`,
	);
	fs.writeFileSync(path.join(root, 'Update.exe'), '');
	return {
		RootAppDir: root,
		UpdateExePath: path.join(root, 'Update.exe'),
		PackagesDir: path.join(root, 'packages'),
		ManifestPath: manifest,
		CurrentBinaryDir: path.join(root, 'current'),
		IsPortable: false,
	};
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	const {UpdateManager} = require(options.velopack === 'velopack' ? 'velopack' : path.resolve(options.velopack));
	const source = `https://github.com/${options.repository}`;
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-update-feed-'));
	const locator = installedAppAt(root, options.installed);
	const updateOptions = {AllowVersionDowngrade: false, ExplicitChannel: 'win', MaximumDeltasBeforeFallback: 10};
	const attempts = Number.parseInt(options.attempts, 10);
	let last = 'no attempt was made';
	try {
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				const manager = new UpdateManager(source, updateOptions, locator);
				const update = await manager.checkForUpdatesAsync();
				const offered = update?.TargetFullRelease?.Version ?? null;
				if (offered === options.expect) {
					const asset = update.TargetFullRelease;
					console.log(`An install at ${options.installed} is offered ${offered} from ${source}`);
					console.log(`  package ${asset.FileName}, ${asset.Size} bytes, sha256 ${asset.SHA256}`);
					return;
				}
				last = offered === null ? 'the updater found nothing newer' : `the updater offered ${offered}`;
			} catch (error) {
				last = error instanceof Error ? error.message : String(error);
			}
			console.log(`Attempt ${attempt}/${attempts}: ${last}`);
			// A release takes a moment to show up in the API after it is published.
			await new Promise((resolve) => setTimeout(resolve, 15_000));
		}
	} finally {
		fs.rmSync(root, {recursive: true, force: true});
	}
	console.error(`An install at ${options.installed} is NOT offered ${options.expect} from ${source}: ${last}`);
	console.error(
		'Installed apps cannot update to this release. See forkVelopackSourceUrl() in src/main/ShellDownloadFormats.ts.',
	);
	process.exit(1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
