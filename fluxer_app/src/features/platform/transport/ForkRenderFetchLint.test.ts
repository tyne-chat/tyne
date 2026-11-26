// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests of scripts/fork-render-fetch-lint.mjs (tyne-chat/tyne#945).

import {describe, expect, it} from 'vitest';
import {lintRenderFetchSource} from '../../../../scripts/fork-render-fetch-lint.mjs';

const lint = (source: string, lines: 'all' | Set<number> = 'all'): Array<string> =>
	lintRenderFetchSource('src/Example.tsx', source, lines);

describe('fork-render-fetch-lint', () => {
	it('flags direct HTTP and store fetch calls in component render bodies and custom hooks', () => {
		const problems = lint(
			[
				'export const ExampleRow = observer(function ExampleRow({userId}: {userId: string}) {',
				"\tvoid http.get('/users/@me');",
				'\tvoid PersonaCommands.fetchPersonaProfile(userId, "p1");',
				'\treturn <div />;',
				'});',
				'export function useBadProfile(userId: string) {',
				'\tvoid fetchPersonas();',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'src/Example.tsx:2:7: [render-fetch] network call `http.get()` inside React render/hook body (move into useEffect with deps or an event handler; tyne-chat/tyne#114)',
			'src/Example.tsx:3:7: [render-fetch] network call `PersonaCommands.fetchPersonaProfile()` inside React render/hook body (move into useEffect with deps or an event handler; tyne-chat/tyne#114)',
			'src/Example.tsx:7:7: [render-fetch] network call `fetchPersonas()` inside React render/hook body (move into useEffect with deps or an event handler; tyne-chat/tyne#114)',
		]);
	});

	it('flags network calls inside useEffect without a dependency array', () => {
		const problems = lint(
			[
				'export function ExampleModal({id}: {id: string}) {',
				'\tuseEffect(() => {',
				'\t\tvoid PersonaStore.fetchPersona("u1", id);',
				'\t});',
				'\treturn null;',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'src/Example.tsx:3:8: [effect-no-deps-fetch] network call `PersonaStore.fetchPersona()` inside useEffect without a dependency array (runs after every render; tyne-chat/tyne#114)',
		]);
	});

	it('allows fetches inside useEffect with deps and inside event handlers', () => {
		expect(
			lint(
				[
					'export const GoodModal = observer(({id}: {id: string}) => {',
					'\tuseEffect(() => {',
					'\t\tvoid PersonaStore.fetchPersona("u1", id);',
					'\t}, [id]);',
					'\tconst onSave = async () => {',
					"\t\tawait http.post('/users/@me/personas', {});",
					'\t};',
					'\treturn <button type="button" onClick={onSave} />;',
					'});',
				].join('\n'),
			),
		).toEqual([]);
	});

	it('respects render-fetch-ignore with a non-empty reason and line filters', () => {
		expect(
			lint(
				[
					'export function A() {',
					'\t// render-fetch-ignore: deduplicated external cache probe',
					"\tvoid http.get('/a');",
					'\t// render-fetch-ignore:',
					"\tvoid http.get('/b');",
					'\treturn null;',
					'}',
				].join('\n'),
				new Set([3, 5]),
			),
		).toEqual([
			'src/Example.tsx:5:7: [render-fetch] network call `http.get()` inside React render/hook body (move into useEffect with deps or an event handler; tyne-chat/tyne#114)',
		]);
	});
});
