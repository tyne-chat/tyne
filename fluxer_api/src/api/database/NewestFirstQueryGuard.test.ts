// SPDX-License-Identifier: AGPL-3.0-or-later

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

// Fork: a table declared newest first in Cassandra (CLUSTERING ORDER BY ... DESC) was read newest
// first by any query on it. The Postgres store has no such declaration and answers a query with no
// ORDER BY oldest first. A query that takes only some rows of such a table (a limit, or rows before
// a cursor) without asking for an order then gets the oldest ones: the mentions inbox froze on
// 2026-10-15 this way, and saved messages, pins, the latest data export and admin archive lists
// had the same fault. This test finds any such query, including ones a rebase brings in.

const API_SRC = resolve(__dirname, '../..');
const SCHEMA = resolve(API_SRC, '../../tools/dev/cassandra_target_schema.json');

// Queries that take some rows without an order on purpose, each with why that is safe.
const REVIEWED: Record<string, string> = {
	'connection/ConnectionMembership.ts:UserConnections:where: UserConnections.where.eq':
		'reads every connection; the limit only caps a list far longer than any account has',
	'connection/ConnectionRepository.ts:UserConnections:where: UserConnections.where.eq':
		'reads every connection; the limit only caps a list far longer than any account has',
	"channel/repositories/message/MessageDeletionRepository.ts:Messages:columns: ['message_id']":
		'asks whether a bucket holds any message at all, not which one',
};

function sourceFiles(dir: string): Array<string> {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
		return path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.includes('/tests/') ? [path] : [];
	});
}

function newestFirstTables(): Map<string, string> {
	const tables = new Map<string, string>();
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			node.forEach(visit);
		} else if (node && typeof node === 'object') {
			const record = node as Record<string, unknown>;
			if (
				typeof record.name === 'string' &&
				typeof record.options === 'string' &&
				/CLUSTERING ORDER BY \([^)]*DESC/.test(record.options)
			) {
				tables.set(record.name, record.options);
			}
			Object.values(record).forEach(visit);
		}
	};
	visit(JSON.parse(readFileSync(SCHEMA, 'utf8')));
	return tables;
}

function callText(source: string, start: number): string {
	let depth = 0;
	for (let i = source.indexOf('(', start); i < source.length; i++) {
		if (source[i] === '(') depth++;
		if (source[i] === ')' && --depth === 0) return source.slice(start, i + 1);
	}
	return source.slice(start);
}

describe('queries on tables declared newest first', () => {
	it('ask for an order when they take only some rows', () => {
		const files = sourceFiles(API_SRC);
		const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
		const declared = newestFirstTables();
		const tables = new Map<string, {name: string; primaryKey: Array<string>}>();
		for (const source of sources.values()) {
			for (const match of source.matchAll(
				/export const (\w+)\s*=\s*defineTable<[^>]*>\(\{\s*name:\s*'([^']+)'[\s\S]*?primaryKey:\s*\[([^\]]*)\]/g,
			)) {
				if (declared.has(match[2]!)) {
					tables.set(match[1]!, {name: match[2]!, primaryKey: [...match[3]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!)});
				}
			}
		}
		expect(tables.size).toBeGreaterThan(20);

		const unordered: Array<string> = [];
		for (const [file, source] of sources) {
			for (const [constant, table] of tables) {
				for (const match of source.matchAll(new RegExp(`\\b${constant}\\.(select|selectCql|selectPaged)\\(`, 'g'))) {
					const text = callText(source, match.index!);
					if (text.includes('orderBy')) continue;
					const takesSome = /\blimit\b/.test(text) || /\.where\.lte?\(/.test(text);
					const keyed = table.primaryKey.every((column) => text.includes(`where.eq('${column}')`));
					if (!takesSome || keyed) continue;
					const firstClause = text
						.slice(text.indexOf('{') + 1)
						.trim()
						.split(/[(,]/)[0]!
						.trim();
					const key = `${relative(API_SRC + '/api', file)}:${constant}:${firstClause}`;
					if (key in REVIEWED) continue;
					unordered.push(`${key} (${table.name}, line ${source.slice(0, match.index).split('\n').length})`);
				}
			}
		}
		expect(unordered).toEqual([]);
	});
});
