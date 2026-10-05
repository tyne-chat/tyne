// SPDX-License-Identifier: AGPL-3.0-or-later

// Maintains the fork-only Lingui catalogue in src/features/i18n/fork_locales.
//
//   node scripts/fork-i18n.mjs sync [--seed-from <dir>]
//       Extract every string from source, keep the ones upstream's en-US catalogue does not have,
//       and rewrite the fork catalogues: new strings get an empty msgstr, strings no longer in
//       source (or since adopted by upstream) are removed. --seed-from fills empty translations
//       from <dir>/<locale>/messages.po.
//   node scripts/fork-i18n.mjs check [--upstream <git ref>]
//       Fail when a source string resolves in neither catalogue, the fork catalogue is out of sync,
//       a translation is empty, an untranslated English copy, or has mismatched placeholders.
//       With --upstream, also fail when the upstream catalogues differ from the merge base.

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import forkConfig from '../lingui.fork.config.js';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM_DIR = path.join(APP_DIR, 'src/features/i18n/locales');
const FORK_DIR = path.join(APP_DIR, 'src/features/i18n/fork_locales');
const REVIEWED_UNCHANGED_PATH = path.join(FORK_DIR, 'reviewed-unchanged.json');
const LOCALES = forkConfig.locales;
const SOURCE_LOCALE = forkConfig.sourceLocale;
const ENGLISH_LOCALES = new Set(['en-US', 'en-GB']);
const HEADER_LICENSE = '# SPDX-License-Identifier: AGPL-3.0-or-later';

function unquote(quoted) {
	return JSON.parse(quoted);
}

function quote(value) {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}

function entryKey(entry) {
	return `${entry.msgctxt ?? ''}\u0004${entry.msgid}`;
}

function parsePo(text) {
	const entries = new Map();
	for (const block of text.split(/\n\s*\n/)) {
		const entry = {comments: [], msgctxt: null, msgid: null, msgstr: ''};
		let field = null;
		for (const line of block.split('\n')) {
			if (line.startsWith('#.')) {
				entry.comments.push(line);
			} else if (line.startsWith('#') || line.trim() === '') {
			} else if (line.startsWith('"')) {
				entry[field] += unquote(line);
			} else {
				const match = /^(msgctxt|msgid|msgstr) (".*")$/.exec(line);
				if (!match) {
					throw new Error(`Unparsed .po line: ${line}`);
				}
				field = match[1];
				entry[field] = unquote(match[2]);
			}
		}
		if (entry.msgid) {
			entries.set(entryKey(entry), entry);
		}
	}
	return entries;
}

function readPo(filePath) {
	return fs.existsSync(filePath) ? parsePo(fs.readFileSync(filePath, 'utf8')) : new Map();
}

function serialisePo(locale, entries) {
	const blocks = [
		[
			HEADER_LICENSE,
			'msgid ""',
			'msgstr ""',
			`"Language: ${locale}\\n"`,
			'"MIME-Version: 1.0\\n"',
			'"Content-Type: text/plain; charset=utf-8\\n"',
			'"Content-Transfer-Encoding: 8bit\\n"',
		].join('\n'),
	];
	const sortKey = (entry) => `${entry.msgid}\u0004${entry.msgctxt ?? ''}`;
	const sorted = [...entries.values()].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
	for (const entry of sorted) {
		const lines = [...entry.comments];
		if (entry.msgctxt !== null) {
			lines.push(`msgctxt ${quote(entry.msgctxt)}`);
		}
		lines.push(`msgid ${quote(entry.msgid)}`, `msgstr ${quote(entry.msgstr)}`);
		blocks.push(lines.join('\n'));
	}
	return `${blocks.join('\n\n')}\n`;
}

function forkPoPath(locale) {
	return path.join(FORK_DIR, locale, 'messages.po');
}

function extractSourceStrings() {
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-i18n-'));
	const configPath = path.join(workDir, 'lingui.config.mjs');
	const catalog = forkConfig.catalogs[0];
	const config = {
		rootDir: APP_DIR,
		locales: [SOURCE_LOCALE],
		sourceLocale: SOURCE_LOCALE,
		catalogs: [{...catalog, path: path.join(workDir, '{locale}/messages')}],
	};
	fs.writeFileSync(configPath, `export default ${JSON.stringify(config)};\n`);
	try {
		execFileSync(path.join(APP_DIR, 'node_modules/.bin/lingui'), ['extract', '--clean', '--config', configPath], {
			cwd: APP_DIR,
			stdio: ['ignore', 'ignore', 'inherit'],
		});
		return readPo(path.join(workDir, SOURCE_LOCALE, 'messages.po'));
	} finally {
		fs.rmSync(workDir, {recursive: true, force: true});
	}
}

function forkOnlyStrings() {
	const extracted = extractSourceStrings();
	const upstream = readPo(path.join(UPSTREAM_DIR, SOURCE_LOCALE, 'messages.po'));
	const forkOnly = new Map();
	for (const [key, entry] of extracted) {
		if (!upstream.has(key)) {
			forkOnly.set(key, entry);
		}
	}
	return forkOnly;
}

function sync(seedDir) {
	const forkOnly = forkOnlyStrings();
	let untranslated = 0;
	for (const locale of LOCALES) {
		const existing = readPo(forkPoPath(locale));
		const seed = seedDir ? readPo(path.join(seedDir, locale, 'messages.po')) : new Map();
		const entries = new Map();
		for (const [key, source] of forkOnly) {
			let msgstr = locale === SOURCE_LOCALE ? source.msgid : (existing.get(key)?.msgstr ?? '');
			if (!msgstr) {
				msgstr = seed.get(key)?.msgstr ?? '';
			}
			if (!msgstr) {
				untranslated += 1;
			}
			entries.set(key, {...source, msgstr});
		}
		fs.mkdirSync(path.dirname(forkPoPath(locale)), {recursive: true});
		fs.writeFileSync(forkPoPath(locale), serialisePo(locale, entries));
	}
	console.log(
		`fork-i18n: ${forkOnly.size} fork-only strings in ${LOCALES.length} locales, ${untranslated} untranslated.`,
	);
}

// Returns the sorted argument names and tags of an ICU message, descending into plural and select branches.
function messageShape(message) {
	const names = new Set();
	const visit = (text) => {
		let depth = 0;
		let start = -1;
		for (let index = 0; index < text.length; index++) {
			const char = text[index];
			if (char === "'" && text[index + 1] === '{') {
				const close = text.indexOf("'", index + 2);
				index = close === -1 ? text.length : close;
			} else if (char === '{') {
				if (depth === 0) {
					start = index + 1;
				}
				depth += 1;
			} else if (char === '}' && depth > 0) {
				depth -= 1;
				if (depth === 0) {
					visitArgument(text.slice(start, index));
				}
			}
		}
	};
	const visitArgument = (body) => {
		const [name, type] = body.split(',', 2).map((part) => part.trim());
		names.add(name);
		if (type === 'plural' || type === 'select' || type === 'selectordinal') {
			let depth = 0;
			let start = -1;
			for (let index = 0; index < body.length; index++) {
				if (body[index] === '{') {
					if (depth === 0) {
						start = index + 1;
					}
					depth += 1;
				} else if (body[index] === '}') {
					depth -= 1;
					if (depth === 0) {
						visit(body.slice(start, index));
					}
				}
			}
		}
	};
	visit(message);
	const tags = (message.match(/<\/?\d+\/?>/g) ?? []).sort();
	return JSON.stringify([[...names].sort(), tags]);
}

function check(upstreamRef) {
	const problems = [];
	const report = (locale, entry, text) => problems.push(`[${locale}] ${JSON.stringify(entry.msgid)}: ${text}`);
	const forkOnly = forkOnlyStrings();
	const reviewedUnchanged = new Set(JSON.parse(fs.readFileSync(REVIEWED_UNCHANGED_PATH, 'utf8')).msgids);
	for (const locale of LOCALES) {
		const catalogue = readPo(forkPoPath(locale));
		const upstream = readPo(path.join(UPSTREAM_DIR, locale, 'messages.po'));
		for (const [key, source] of forkOnly) {
			const entry = catalogue.get(key);
			if (!entry) {
				report(
					locale,
					source,
					'used in source but in neither catalogue; run `node scripts/fork-i18n.mjs sync` and translate it',
				);
			} else if (!entry.msgstr) {
				report(locale, source, 'translation is empty');
			} else if (messageShape(entry.msgstr) !== messageShape(source.msgid)) {
				report(locale, source, `placeholders differ in translation ${JSON.stringify(entry.msgstr)}`);
			} else if (
				!ENGLISH_LOCALES.has(locale) &&
				entry.msgstr === source.msgid &&
				/\p{L}{2}/u.test(source.msgid.replace(/\{[^}]*\}/g, '')) &&
				!reviewedUnchanged.has(source.msgid)
			) {
				report(
					locale,
					source,
					'translation is an English copy; translate it or list the msgid in fork_locales/reviewed-unchanged.json',
				);
			}
		}
		for (const [key, entry] of catalogue) {
			if (!forkOnly.has(key)) {
				const reason = upstream.has(key) ? 'now provided by upstream' : 'no longer used in source';
				report(locale, entry, `${reason}; run \`node scripts/fork-i18n.mjs sync\``);
			}
		}
		if (
			fs.existsSync(forkPoPath(locale)) &&
			fs.readFileSync(forkPoPath(locale), 'utf8') !== serialisePo(locale, catalogue)
		) {
			problems.push(`[${locale}] messages.po is not in canonical form; run \`node scripts/fork-i18n.mjs sync\``);
		}
	}
	if (upstreamRef) {
		const git = (...args) => execFileSync('git', args, {cwd: APP_DIR, encoding: 'utf8'}).trim();
		const base = git('merge-base', 'HEAD', upstreamRef);
		const changed = git('diff', '--name-only', base, '--', path.join(UPSTREAM_DIR, '*/messages.po'));
		for (const file of changed.split('\n').filter(Boolean)) {
			problems.push(`${file} differs from upstream (${base.slice(0, 9)}); fork strings belong in fork_locales`);
		}
	}
	if (problems.length > 0) {
		const shown = problems.slice(0, 200);
		console.error(shown.join('\n'));
		console.error(
			`fork-i18n: ${problems.length} problem(s)${problems.length > shown.length ? ' (first 200 shown)' : ''}.`,
		);
		process.exit(1);
	}
	console.log(`fork-i18n: ${forkOnly.size} fork-only strings resolve and are translated in ${LOCALES.length} locales.`);
}

function optionValue(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

const command = process.argv[2];
if (command === 'sync') {
	sync(optionValue('--seed-from'));
} else if (command === 'check') {
	check(optionValue('--upstream'));
} else {
	console.error('Usage: node scripts/fork-i18n.mjs <sync [--seed-from <dir>] | check [--upstream <git ref>]>');
	process.exit(2);
}
