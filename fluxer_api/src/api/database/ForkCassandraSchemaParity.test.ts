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

interface Declared {
	name: string;
	columns: ReadonlyArray<string>;
	primaryKey: ReadonlyArray<string>;
	partitionKey: ReadonlyArray<string>;
}

function isTable(value: unknown): value is Declared {
	const table = value as Partial<Declared> | null;
	return (
		typeof table === 'object' &&
		table !== null &&
		typeof table.name === 'string' &&
		Array.isArray(table.columns) &&
		Array.isArray(table.primaryKey) &&
		Array.isArray(table.partitionKey)
	);
}

// The tables are checked as their own definitions declare them, not as the table registry holds
// them by name: the `api` project shares one module registry between the files a worker runs, and
// upstream's tests register stand-in tables under real names there. Until upstream's #4291,
// CdcWriteCapture.test.ts registered a `messages` keyed (channel_id, message_id), and in a run where
// it came first, the registry handed this file that key (tyne-chat/tyne#902). The signal bar's two
// tables are not exported, so they are read from the registry; only the fork uses their names.
function registered(name: string): Declared {
	const meta = getTableMetadata(name);
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

const forkTables: Array<Declared> = [
	...Object.values(ForkTables).filter(isTable),
	...SIGNAL_BAR_TABLES.map(registered),
];
const forkTableNames = forkTables.map((table) => table.name);

describe('the fork in the Cassandra target schema', () => {
	it('finds the fork tables to check', () => {
		// The twelve of ForkTables.ts on 2026-11-21, and the signal bar's two.
		expect(forkTableNames).toContain('personas');
		expect(forkTableNames).toContain('guild_commands');
		expect(forkTableNames.length).toBeGreaterThanOrEqual(14);
	});

	it.each(forkTables)('has the fork table $name with its columns and key', (table) => {
		const schema = inSchema(table.name);
		expect(new Set(schema.columns.map((column) => column.name))).toEqual(new Set(table.columns));
		const key = keyOf(schema.primary_key);
		expect(key.whole).toEqual([...table.primaryKey]);
		expect(key.partition).toEqual([...table.partitionKey]);
	});

	it.each([Messages, MessageReactions])("has the fork's columns and key on $name", (table) => {
		const schema = inSchema(table.name);
		const columns = new Set(schema.columns.map((column) => column.name));
		for (const column of table.columns) expect(columns, column).toContain(column);
		expect(keyOf(schema.primary_key).whole).toEqual([...table.primaryKey]);
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
