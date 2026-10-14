// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the built page names Tyne, while the source page keeps upstream's name for upstream's
// app-proxy tests (see scripts/build/rspack/fork-app-name.mjs).

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {FORK_APP_NAME, withForkAppName} from '../../scripts/build/rspack/fork-app-name.mjs';

const source = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('fork app name in the built page', () => {
	it('names Tyne in the title, the home screen title and the description', () => {
		const built: string = withForkAppName(source);
		expect(FORK_APP_NAME).toBe('Tyne');
		expect(built).toContain('<title>Tyne</title>');
		expect(built).toContain('<meta name="apple-mobile-web-app-title" content="Tyne">');
		expect(built).toContain('<meta name="description" content="Tyne is ');
		expect(built).not.toContain('<title>Fluxer</title>');
	});

	it('changes nothing else in the page', () => {
		const built: string = withForkAppName(source);
		expect(built.replaceAll('Tyne', 'Fluxer')).toBe(source);
	});

	it('fails the build when upstream rewrites one of the lines it changes', () => {
		expect(() => withForkAppName(source.replace('<title>Fluxer</title>', '<title>Other</title>'))).toThrow(
			/fork-app-name\.mjs/,
		);
	});

	it('is part of the web build', () => {
		const config = readFileSync(resolve(process.cwd(), 'rspack.config.mjs'), 'utf8');
		expect(config).toContain("import {forkAppNamePlugin} from './scripts/build/rspack/fork-app-name.mjs';");
		expect(config).toContain('forkAppNamePlugin(),');
	});
});
