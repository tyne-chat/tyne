// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: tests of scripts/fork-web-safety-lint.mjs (tyne-chat/tyne#947).

import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {ReviewedLintCatalog, ReviewedLintEntry} from '../../../../scripts/fork-lint-reviewed.mjs';
import {lintWebSafetySource} from '../../../../scripts/fork-web-safety-lint.mjs';

const TEST_STORES = new Set([
	'@app/features/persona/state/PersonaStore',
	'@app/features/user/state/Users',
	'@app/features/guild/state/GuildMembers',
	'@app/features/accessibility/state/Accessibility',
	'@app/features/app/state/RuntimeConfig',
]);

const lint = (
	source: string,
	file = 'src/Example.tsx',
	lines: 'all' | Set<number> = 'all',
	reviewed?: ReviewedLintCatalog,
): Array<string> => lintWebSafetySource(file, source, lines, {mobxStateModules: TEST_STORES, reviewed});

describe('fork-web-safety-lint', () => {
	it('flags missing-observer when a component reads a MobX store during render without observer()', () => {
		const problems = lint(
			[
				"import {PersonaStore} from '@app/features/persona/state/PersonaStore';",
				"import Users from '@app/features/user/state/Users';",
				"import RuntimeConfig from '@app/features/app/state/RuntimeConfig';",
				'export function BadPanel() {',
				'\tconst name = Users.currentUser?.username;',
				'\treturn <div>{name}{RuntimeConfig.productName}</div>;',
				'}',
				'export function GoodWrapped() {',
				'\treturn <div>{PersonaStore.personas.length}</div>;',
				'}',
				'export const Wrapped = observer(GoodWrapped);',
				'export const OkEventProp = ({children}: {children?: unknown}) => <button type="button" onClick={PersonaStore.reset}>{children}</button>;',
			].join('\n'),
		);
		expect(problems).toEqual([
			'src/Example.tsx:5:15: [missing-observer] component `BadPanel` reads `Users.currentUser` during render without `observer()` (never re-renders on store changes)',
		]);
	});

	it('flags mobx-stale-memo without reactive deps while allowing versioned deps and useCallback', () => {
		const problems = lint(
			[
				"import GuildMembers from '@app/features/guild/state/GuildMembers';",
				"import {observer} from 'mobx-react-lite';",
				"import {useCallback, useMemo} from 'react';",
				'export const MemberCard = observer(({guildId, userId}: {guildId: string; userId: string}) => {',
				'\tconst stale = useMemo(() => GuildMembers.getMember(guildId, userId), [guildId, userId]);',
				'\tconst versioned = useMemo(() => GuildMembers.getMember(guildId, userId), [guildId, userId, GuildMembers.membersVersion]);',
				'\tconst onPress = useCallback(() => GuildMembers.getMember(guildId, userId), [guildId, userId]);',
				'\treturn <button type="button" onClick={() => onPress()}>{stale?.nick ?? versioned?.nick}</button>;',
				'});',
			].join('\n'),
		);
		expect(problems).toEqual([
			'src/Example.tsx:5:30: [mobx-stale-memo] `useMemo` reads `GuildMembers.getMember` without listing `GuildMembers` or a reactive dep in its dependency array (breaks MobX updates once memoized; tyne-chat/tyne#937)',
		]);
	});

	it('flags uncaptured timers that set React state or run intervals', () => {
		const problems = lint(
			[
				"import {useRef, useState} from 'react';",
				'export function FlashModal() {',
				'\tconst [flashing, setFlashing] = useState(false);',
				'\tconst ref = useRef<number | null>(null);',
				'\tconst bad = () => {',
				'\t\twindow.setTimeout(() => setFlashing(false), 300);',
				'\t\tsetInterval(() => {}, 1000);',
				'\t};',
				'\tconst good = () => {',
				'\t\tref.current = window.setTimeout(() => setFlashing(false), 300);',
				'\t};',
				'\treturn <button type="button" onClick={bad}>{String(flashing)}{String(good)}</button>;',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'src/Example.tsx:6:3: [uncaptured-timer] uncaptured `setTimeout` calling React state setter cannot be cleared on unmount (store timer ID in a ref and clear in useEffect cleanup; tyne-chat/tyne#861)',
			'src/Example.tsx:7:3: [uncaptured-timer] uncaptured `setInterval` cannot be cleared on unmount (store timer ID in a ref and clear in useEffect cleanup; tyne-chat/tyne#861)',
		]);
	});

	it('flags effect-missing-cleanup for listeners, intervals, and MobX reactions without cleanup return', () => {
		const problems = lint(
			[
				"import {reaction} from 'mobx';",
				"import {useEffect} from 'react';",
				'export function BadEffects({onTick}: {onTick: () => void}) {',
				'\tuseEffect(() => {',
				"\t\twindow.addEventListener('resize', onTick);",
				'\t\tsetInterval(onTick, 500);',
				'\t\treaction(() => 1, onTick);',
				'\t}, [onTick]);',
				'\tuseEffect(() => {',
				"\t\twindow.addEventListener('resize', onTick, {once: true});",
				'\t\tconst stop = reaction(() => 1, onTick);',
				'\t\treturn () => stop();',
				'\t}, [onTick]);',
				'\tuseEffect(() => reaction(() => 1, onTick), [onTick]);',
				'\treturn null;',
				'}',
			].join('\n'),
		);
		expect(problems).toEqual([
			'src/Example.tsx:5:3: [effect-missing-cleanup] `useEffect` registers `addEventListener()` without returning a cleanup function',
			'src/Example.tsx:6:3: [effect-missing-cleanup] `useEffect` registers `setInterval()` without returning a cleanup function',
			'src/Example.tsx:7:3: [effect-missing-cleanup] `useEffect` registers `reaction()` without returning a cleanup function',
		]);
	});

	it('flags raw-web-storage outside platform/state', () => {
		expect(
			lint(
				[
					'export function readRaw() {',
					"\treturn window.localStorage.getItem('k') ?? sessionStorage.getItem('s');",
					'}',
				].join('\n'),
				'src/features/emoji/state/Foo.ts',
			),
		).toEqual([
			'src/features/emoji/state/Foo.ts:2:16: [raw-web-storage] direct `localStorage` usage fails in production builds where storage is stripped (use AppStorage / makePersistent; tyne-chat/tyne#140)',
			'src/features/emoji/state/Foo.ts:2:45: [raw-web-storage] direct `sessionStorage` usage fails in production builds where storage is stripped (use AppStorage / makePersistent; tyne-chat/tyne#140)',
		]);
		expect(
			lint(
				"export function ok() { return window.localStorage.getItem('k'); }",
				'src/features/platform/state/Preboot.ts',
			),
		).toEqual([]);
	});

	it('flags messages-untracked-read when observer reads Messages without Messages.version', () => {
		const problems = lint(
			[
				"import Messages from '@app/features/messaging/state/MessagingMessages';",
				"import {observer} from 'mobx-react-lite';",
				'export const BadChip = observer(({c, m}: {c: string; m: string}) => {',
				'\tconst msg = Messages.getMessage(c, m);',
				'\treturn <span>{msg?.content}</span>;',
				'});',
				'export const GoodChip = observer(({c, m}: {c: string; m: string}) => {',
				'\tvoid Messages.version;',
				'\tconst msg = Messages.getCachedMessages(c)?.get(m);',
				'\treturn <span>{msg?.content}</span>;',
				'});',
			].join('\n'),
		);
		expect(problems).toEqual([
			'src/Example.tsx:4:14: [messages-untracked-read] `BadChip` calls `Messages.getMessage()` during render without reading `Messages.version` (Messages is not deep-observable)',
		]);
	});

	it('flags zoom-blind-viewport in JS/TS and CSS and respects ignore comments', () => {
		expect(
			lint(
				[
					'export function checkWidth() {',
					"\tconst m = window.matchMedia('(max-width: 600px)');",
					'\t// web-safety-ignore: intentional mobile-only check',
					'\tconst small = window.innerWidth < 640;',
					'\treturn m.matches || small;',
					'}',
				].join('\n'),
				'src/Example.ts',
			),
		).toEqual([
			"src/Example.ts:2:12: [zoom-blind-viewport] `matchMedia('(max-width: 600px)')` without `getAppRemScale()` ignores desktop zoom (tyne-chat/tyne#639)",
		]);
		expect(
			lint(
				[
					'@media (max-width: 480px) { .a { color: red; } }',
					'/* px-ok: iOS zoom guard */',
					'@media (max-width: 480px) { .b { color: blue; } }',
				].join('\n'),
				'src/Example.module.css',
			),
		).toEqual([
			'src/Example.module.css:1:1: [zoom-blind-viewport] CSS @media pixel query `@media (max-width: 480px) { .a { color: red; } }` ignores desktop zoom (use @container in rem or mark with `/* px-ok: <reason> */`; tyne-chat/tyne#639)',
		]);
	});

	it('suppresses reviewed upstream exceptions across line shifts without suppressing unreviewed findings', () => {
		const catalog = ReviewedLintCatalog.fromEntries([
			new ReviewedLintEntry({
				linter: 'web-safety',
				rule: 'mobx-stale-memo',
				file: 'fluxer_app/src/Example.tsx',
				enclosing: 'useReviewedHook',
				symbol: 'PersonaStore.personas',
				target: 'useMemo',
				reason: 'reviewed hook invalidation',
			}),
		]);

		const source = [
			"import {useMemo} from 'react';",
			"import {PersonaStore} from '@app/features/persona/state/PersonaStore';",
			'export function useReviewedHook() {',
			'\tconst items = useMemo(() => PersonaStore.personas, []);',
			'\treturn items;',
			'}',
			'export function useUnreviewedHook() {',
			'\tconst items = useMemo(() => PersonaStore.personas, []);',
			'\treturn items;',
			'}',
		].join('\n');

		// Prepend blank lines to simulate upstream line shifts above both hooks.
		const problems = lint(`\n\n${source}`, 'src/Example.tsx', 'all', catalog);
		expect(problems).toEqual([
			'src/Example.tsx:10:30: [mobx-stale-memo] `useMemo` reads `PersonaStore.personas` without listing `PersonaStore` or a reactive dep in its dependency array (breaks MobX updates once memoized; tyne-chat/tyne#937)',
		]);
		expect(catalog.unmatchedEntries('web-safety')).toEqual([]);

		// Removing the matched code makes the reviewed entry stale.
		const emptyCatalog = ReviewedLintCatalog.fromEntries(catalog.entries);
		expect(lint('export const x = 1;', 'src/Example.tsx', 'all', emptyCatalog)).toEqual([]);
		expect(emptyCatalog.unmatchedEntries('web-safety')).toHaveLength(1);
	});

	it('validates reviewed catalog schema constraints and parses scripts/fork-lint-reviewed.json', () => {
		expect(() =>
			ReviewedLintCatalog.fromJsonString(
				'{"version":1,"entries":[{"linter":"web-safety","rule":"mobx-stale-memo","file":"fluxer_app/src/A.tsx","enclosing":"Foo"}]}',
			),
		).toThrow();
		expect(() =>
			ReviewedLintCatalog.fromJsonString(
				'{"version":1,"entries":[{"linter":"web-safety","file":"fluxer_app/src/A.tsx","enclosing":"Foo","reason":"missing rule"}]}',
			),
		).toThrow();
		expect(() =>
			ReviewedLintCatalog.fromJsonString(
				'{"version":1,"entries":[{"linter":"web-safety","rule":"mobx-stale-memo","file":"/abs/A.tsx","enclosing":"Foo","reason":"leading slash"}]}',
			),
		).toThrow();
		expect(() =>
			ReviewedLintCatalog.fromJsonString(
				'{"version":1,"entries":[{"linter":"web-safety","rule":"mobx-stale-memo","file":"fluxer_app/src/A.tsx","reason":"missing narrowing selector"}]}',
			),
		).toThrow();

		const diskPath = path.resolve(import.meta.dirname, '../../../../scripts/fork-lint-reviewed.json');
		const loaded = ReviewedLintCatalog.fromJsonString(fs.readFileSync(diskPath, 'utf8'), diskPath);
		expect(loaded.entries.length).toBeGreaterThanOrEqual(1);
	});
});
