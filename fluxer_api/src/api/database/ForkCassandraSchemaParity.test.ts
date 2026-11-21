// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Cassandra and Scylla create their tables from tools/dev/cassandra_target_schema.json
// (CassandraSchemaStartup.ts), and fluxer_messages reads them there. Tyne runs Postgres, whose store
// keeps rows as JSON and needs no schema, so nothing noticed when the fork's tables and columns were
// missing from that file: until tyne-chat/tyne#329 eleven fork tables were, and fluxer_messages'
// Scylla queries failed on `persona_id`. This checks the fork's tables, and its columns on upstream's
// `messages` and `message_reactions`, against the file.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getTableMetadata} from '@app/api/database/CassandraMetaRegistry';
import * as ForkTables from '@app/api/ForkTables';
import '@app/api/signal_bar/SignalBarSettingsRepository';
import {MessageReactions, Messages} from '@app/api/Tables';
import {describe, expect, it} from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/dev/cassandra_target_schema.json'), 'utf8')) as {
	user_types: Array<{name: string}>;
	tables: Array<{name: string; columns: Array<{name: string; type: string}>; primary_key: string}>;
};

// The signal bar declares its two tables in SignalBarSettingsRepository.ts, the one exception to
// ForkTables.ts (fluxer_api/AGENTS.md).
const SIGNAL_BAR_TABLES = ['guild_signal_bar_settings', 'dm_signal_bar_settings'];

function declared(name: string) {
	const meta = getTableMetadata(name) as
		| {columns: ReadonlyArray<string>; primaryKey: ReadonlyArray<string>; partitionKey: ReadonlyArray<string>}
		| undefined;
	if (!meta) throw new Error(`${name} is not declared`);
	return meta;
}

function inSchema(name: string) {
	const table = SCHEMA.tables.find((entry) => entry.name === name);
	if (!table) throw new Error(`${name} is missing from tools/dev/cassandra_target_schema.json`);
	return table;
}

/** "((a, b), c, d)" → partition [a, b] and the whole key [a, b, c, d]. */
function keyOf(primaryKey: string): {partition: Array<string>; whole: Array<string>} {
	const inner = primaryKey.trim().slice(1, -1).trim();
	const split = (list: string) =>
		list
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean);
	if (inner.startsWith('(')) {
		const close = inner.indexOf(')');
		const partition = split(inner.slice(1, close));
		return {partition, whole: [...partition, ...split(inner.slice(close + 1))]};
	}
	const whole = split(inner);
	return {partition: whole.slice(0, 1), whole};
}

const forkTableNames = [
	...Object.values(ForkTables).flatMap((value) => {
		const name = (value as {name?: unknown}).name;
		return typeof name === 'string' ? [name] : [];
	}),
	...SIGNAL_BAR_TABLES,
];

describe('the fork in the Cassandra target schema', () => {
	it('finds the fork tables to check', () => {
		// The twelve of ForkTables.ts on 2026-11-21, and the signal bar's two.
		expect(forkTableNames).toContain('personas');
		expect(forkTableNames).toContain('guild_commands');
		expect(forkTableNames.length).toBeGreaterThanOrEqual(14);
	});

	it.each(forkTableNames)('has the fork table %s with its columns and key', (name) => {
		const table = declared(name);
		const schema = inSchema(name);
		expect(new Set(schema.columns.map((column) => column.name))).toEqual(new Set(table.columns));
		const key = keyOf(schema.primary_key);
		expect(key.whole).toEqual([...table.primaryKey]);
		expect(key.partition).toEqual([...table.partitionKey]);
	});

	it.each([Messages, MessageReactions])("has the fork's columns and key on $name", (table) => {
		const meta = declared(table.name);
		const schema = inSchema(table.name);
		const columns = new Set(schema.columns.map((column) => column.name));
		for (const column of meta.columns) expect(columns, column).toContain(column);
		expect(keyOf(schema.primary_key).whole).toEqual([...meta.primaryKey]);
	});

	it('keeps the persona columns typed as upstream types ids', () => {
		const type = (table: string, column: string) =>
			inSchema(table).columns.find((entry) => entry.name === column)?.type;
		expect(type('messages', 'persona_id')).toBe('bigint');
		expect(type('messages', 'mention_personas')).toBe('set<bigint>');
		expect(type('message_reactions', 'persona_id')).toBe('bigint');
	});

	it('no longer has the retired subprofile copy', () => {
		expect(inSchema('messages').columns.map((column) => column.name)).not.toContain('subprofile');
		expect(SCHEMA.user_types.map((type) => type.name)).not.toContain('message_subprofile');
	});
});
