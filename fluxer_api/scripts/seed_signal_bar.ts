// SPDX-License-Identifier: AGPL-3.0-or-later

// Development helper: makes the community that owns the named emoji the signal bar home
// community and fills the bar with those emoji. Restart the API afterwards so its
// instance config cache reloads.
//
//   pnpm tsx scripts/seed_signal_bar.ts [--dry-run] [Name ...]

import {randomBytes} from 'node:crypto';
// @ts-expect-error pg types are not installed in fluxer_api
import pg from 'pg';

const DEFAULT_NAMES = ['Processing', 'Done', 'ThinkingCircle', 'Typing', 'Reading'];
const CONFIG_TABLE = 'instance_configuration';

interface EmojiRow {
	name: string;
	animated: boolean | null;
	emoji_id: {value: string};
	guild_id: {value: string};
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const isDryRun = args.includes('--dry-run');
	const requested = args.filter((arg) => !arg.startsWith('--'));
	const names = requested.length > 0 ? requested : DEFAULT_NAMES;
	const connectionString =
		process.env.DATABASE_URL ||
		process.env.POSTGRES_URL ||
		`postgres://${process.env.POSTGRES_USER || 'fluxer'}:${process.env.POSTGRES_PASSWORD || 'fluxer'}@${
			process.env.POSTGRES_HOST || 'postgres'
		}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'fluxer'}`;
	const kvTable = process.env.FLUXER_KV_TABLE || 'fluxer_kv';
	const client = new pg.Client({connectionString});
	await client.connect();
	try {
		const emojiRes = await client.query<{row_data: EmojiRow}>(
			`SELECT row_data FROM "${kvTable}" WHERE table_name = 'guild_emojis' AND row_data->>'name' = ANY($1)`,
			[names],
		);
		const byGuild = new Map<string, Map<string, EmojiRow>>();
		for (const {row_data: emoji} of emojiRes.rows) {
			const guildEmoji = byGuild.get(emoji.guild_id.value) ?? new Map<string, EmojiRow>();
			guildEmoji.set(emoji.name, emoji);
			byGuild.set(emoji.guild_id.value, guildEmoji);
		}
		const home = Array.from(byGuild.entries()).find(([, emoji]) => names.every((name) => emoji.has(name)));
		if (!home) {
			throw new Error(`No community has all of these emoji: ${names.join(', ')}`);
		}
		const [guildId, emojiByName] = home;
		const readConfig = async (key: string): Promise<string | null> => {
			const res = await client.query<{value: string | null}>(
				`SELECT row_data->>'value' AS value FROM "${kvTable}" WHERE table_name = $1 AND row_data->>'key' = $2`,
				[CONFIG_TABLE, key],
			);
			return res.rows[0]?.value ?? null;
		};
		const writeConfig = async (key: string, value: string): Promise<void> => {
			const encodedKey = JSON.stringify(key);
			const rowData = {key, value, updated_at: {value: new Date().toISOString(), __fluxer_type: 'date'}};
			await client.query(
				`INSERT INTO "${kvTable}" (table_name, partition_key, row_key, row_data, updated_at)
				 VALUES ($1, $2, $2, $3::jsonb, NOW())
				 ON CONFLICT (table_name, row_key)
				 DO UPDATE SET row_data = EXCLUDED.row_data, updated_at = NOW()`,
				[CONFIG_TABLE, encodedKey, JSON.stringify(rowData)],
			);
		};
		const policy = JSON.parse((await readConfig('instance_policy_config')) ?? '{}') as Record<string, unknown>;
		const previous = JSON.parse((await readConfig('signal_bar')) ?? '{"version":0}') as {version?: number};
		const bar = {
			version: (previous.version ?? 0) + 1,
			signals: names.map((name) => {
				const emoji = emojiByName.get(name)!;
				return {
					id: randomBytes(6).toString('hex'),
					emoji_id: emoji.emoji_id.value,
					emoji_name: emoji.name,
					animated: emoji.animated ?? false,
					label: null,
				};
			}),
		};
		console.log(`[*] Home community: ${guildId}`);
		console.log(
			`[*] Signals: ${bar.signals.map((signal) => `:${signal.emoji_name}:`).join(' ')} (version ${bar.version})`,
		);
		if (isDryRun) {
			console.log('[*] Dry run, nothing written.');
			return;
		}
		await writeConfig('instance_policy_config', JSON.stringify({...policy, signal_bar_guild_id: guildId}));
		await writeConfig('signal_bar', JSON.stringify(bar));
		console.log('[*] Written. Restart the API so the instance config cache reloads.');
	} finally {
		await client.end();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
