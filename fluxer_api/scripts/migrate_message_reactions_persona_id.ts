// SPDX-License-Identifier: AGPL-3.0-or-later

// @ts-expect-error pg types are not installed in fluxer_api
import pg from 'pg';

async function main(): Promise<void> {
	const isDryRun = process.argv.includes('--dry-run');
	console.log(`Starting message reactions persona_id migration${isDryRun ? ' [DRY RUN]' : ''}...`);

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

		// Count message reactions needing migration
		const countResult = await client.query<{count: string}>(`
			SELECT COUNT(*)::text as count
			FROM "${kvTable}"
			WHERE table_name = 'message_reactions'
			  AND NOT (row_data ? 'persona_id');
		`);

		const totalToMigrate = parseInt(countResult.rows[0]?.count ?? '0', 10);
		console.log(`[*] Found ${totalToMigrate} legacy message reactions missing persona_id.`);

		if (totalToMigrate === 0 || isDryRun) {
			console.log(
				isDryRun
					? '[*] Dry run finished. No rows updated.'
					: '[*] All message reactions are already migrated to 7-part primary keys.',
			);
			return;
		}

		const startTime = Date.now();

		await client.query('BEGIN');
		const updateResult = await client.query(`
			UPDATE "${kvTable}"
			SET row_key = row_key || E'\\x1F{"__fluxer_type":"bigint","value":"0"}',
			    row_data = row_data || jsonb_build_object('persona_id', jsonb_build_object('__fluxer_type', 'bigint', 'value', '0')),
			    updated_at = now()
			WHERE table_name = 'message_reactions'
			  AND NOT (row_data ? 'persona_id');
		`);
		await client.query('COMMIT');

		const rowCount = updateResult.rowCount ?? 0;
		const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(`[*] Migration completed successfully in ${elapsed}s. Total reactions migrated: ${rowCount}.`);
	} catch (err) {
		await client.query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
