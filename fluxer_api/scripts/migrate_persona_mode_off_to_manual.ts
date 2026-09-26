// SPDX-License-Identifier: AGPL-3.0-or-later

// @ts-expect-error pg types are not installed in fluxer_api
import pg from 'pg';

async function main(): Promise<void> {
	const isDryRun = process.argv.includes('--dry-run');
	console.log(`Starting active_persona_mode 'off' -> 'manual' migration${isDryRun ? ' [DRY RUN]' : ''}...`);

	const connectionString =
		process.env.DATABASE_URL ||
		process.env.POSTGRES_URL ||
		`postgres://${process.env.POSTGRES_USER || 'fluxer'}:${process.env.POSTGRES_PASSWORD || 'fluxer'}@${
			process.env.POSTGRES_HOST || 'postgres'
		}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'fluxer'}`;

	console.log(`[*] Connecting to PostgreSQL (${connectionString.replace(/:[^:@]+@/, ':***@')})...`);
	const client = new pg.Client({connectionString});
	await client.connect();

	try {
		const kvTable = process.env.FLUXER_KV_TABLE || 'fluxer_kv';
		console.log(`[*] Using KV table: "${kvTable}"`);

		// 1. Query records needing migration
		const selectRes = await client.query<{
			partition_key: string;
			row_data: any;
		}>(`
			SELECT partition_key, row_data
			FROM "${kvTable}"
			WHERE table_name = 'user_persona_settings'
			  AND (row_data->>'active_persona_mode' = 'off' OR row_data->>'active_persona_mode' IS NULL);
		`);

		console.log(
			`[*] Found ${selectRes.rows.length} user_persona_settings rows with active_persona_mode 'off' or null.`,
		);

		if (selectRes.rows.length === 0) {
			console.log('[*] No migration needed. All records already have active_persona_mode set to manual or last.');
			return;
		}

		for (const row of selectRes.rows) {
			const partitionKey = row.partition_key;
			console.log(
				`[*] Migrating user ${partitionKey} to active_persona_mode: 'manual', active_persona_id: null, is_latched: false...`,
			);
		}

		if (!isDryRun) {
			const updateRes = await client.query(`
				UPDATE "${kvTable}"
				SET row_data = jsonb_set(
					jsonb_set(
						jsonb_set(
							jsonb_set(row_data, '{active_persona_mode}', '"manual"'),
							'{active_persona_id}', 'null'
						),
						'{is_latched}', 'false'
					),
					'{version}', to_jsonb(COALESCE((row_data->>'version')::int, 0) + 1)
				),
				updated_at = NOW()
				WHERE table_name = 'user_persona_settings'
				  AND (row_data->>'active_persona_mode' = 'off' OR row_data->>'active_persona_mode' IS NULL);
			`);

			console.log(`[+] Successfully updated ${updateRes.rowCount} rows in "${kvTable}".`);
		} else {
			console.log(`[DRY RUN] Would have updated ${selectRes.rows.length} rows.`);
		}
	} finally {
		await client.end();
	}

	console.log('[+] Migration complete.');
}

main().catch((err) => {
	console.error('[-] Migration failed:', err);
	process.exit(1);
});
