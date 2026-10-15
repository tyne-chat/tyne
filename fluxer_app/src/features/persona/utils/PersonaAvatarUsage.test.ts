// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream's `<Avatar>` takes ready-made image addresses in `avatarUrl` and
// `hoverAvatarUrl`. A persona's avatar is a media hash, and handing it to those props makes the
// browser request the hash as if it were an address. That went unnoticed in fork code for weeks
// because every value happened to be absolute until the bundled default avatars (relative in a
// production build) were mixed in. Persona avatars go through `<PersonaAvatar>` or
// `personaAvatarUrls`; this test fails if a hash is passed to `<Avatar>` directly.

import {readdirSync, readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

const SOURCE_ROOT = join(__dirname, '..', '..', '..');
const HASH_LIKE = /avatar_hash|avatarHash|subprofile|\.avatar\b(?![A-Za-z])/;

function sourceFiles(dir: string): Array<string> {
	return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
		return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
	});
}

/** The `{…}` expression starting at `open`, which must be a `{`. */
function braced(text: string, open: number): string {
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		if (text[index] === '{') depth++;
		else if (text[index] === '}' && --depth === 0) return text.slice(open + 1, index);
	}
	return text.slice(open + 1);
}

/**
 * A bare name given to `avatarUrl` is followed to its `const` in the same file, so a hash cannot
 * slip through a local variable (the typing indicator did, issue #92). A value built by a function
 * whose name ends in `URL` or `Urls` is an address, whatever it was built from.
 */
function followLocal(text: string, expression: string): string {
	const name = expression.trim();
	if (!/^[A-Za-z_$][\w$]*$/.test(name)) return expression;
	const declaration = new RegExp(`\\bconst ${name}\\s*=([^;]*)`).exec(text);
	if (!declaration) return expression;
	return /(?:URL|Urls)\(/.test(declaration[1]) ? expression : declaration[1];
}

/** Every `avatarUrl={…}` and `hoverAvatarUrl={…}` given to an `<Avatar>` element. */
function avatarAddressProps(text: string): Array<string> {
	const found: Array<string> = [];
	for (const element of text.matchAll(/<Avatar\b/g)) {
		const end = text.indexOf('/>', element.index);
		const tag = text.slice(element.index, end === -1 ? undefined : end);
		for (const prop of tag.matchAll(/\b(?:hoverA|a)vatarUrl=\{/g)) {
			found.push(followLocal(text, braced(tag, (prop.index ?? 0) + prop[0].length - 1)));
		}
	}
	return found;
}

describe('persona avatars', () => {
	it('never hand a hash to <Avatar> as an address', () => {
		const offenders: Array<string> = [];
		for (const file of sourceFiles(SOURCE_ROOT)) {
			for (const expression of avatarAddressProps(readFileSync(file, 'utf8'))) {
				if (HASH_LIKE.test(expression)) offenders.push(`${relative(SOURCE_ROOT, file)}: ${expression.trim()}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('recognises the mistake it is looking for', () => {
		const sample = '<Avatar user={user} avatarUrl={message.subprofile?.avatar ?? undefined} size={16} />';
		expect(avatarAddressProps(sample).filter((expression) => HASH_LIKE.test(expression))).toHaveLength(1);
	});

	it('follows a local variable to what it holds', () => {
		const hash =
			'const avatarUrl = typist?.subprofile?.avatar ?? undefined;\n<Avatar user={user} avatarUrl={avatarUrl} />';
		const address =
			'const avatarUrl = persona?.avatar ? getPersonaAvatarURL({userId, avatar: persona.avatar}) : undefined;\n' +
			'<Avatar user={user} avatarUrl={avatarUrl} />';
		expect(avatarAddressProps(hash).filter((expression) => HASH_LIKE.test(expression))).toHaveLength(1);
		expect(avatarAddressProps(address).filter((expression) => HASH_LIKE.test(expression))).toHaveLength(0);
	});
});
