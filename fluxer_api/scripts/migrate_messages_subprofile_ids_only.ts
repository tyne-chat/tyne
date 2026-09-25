// SPDX-License-Identifier: AGPL-3.0-or-later

import pg from 'pg';

async function main(): Promise<void> {
	const isDryRun = process.argv.includes('--dry-run');
	console.log(`Starting message subprofile ID migration${isDryRun ? ' [DRY RUN]' : ''}...`);

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

		// Count messages needing migration
		const countResult = await client.query<{count: string}>(`
			SELECT COUNT(*)::text as count
			FROM "${kvTable}"
			WHERE table_name = 'messages'
			  AND row_data->'subprofile' IS NOT NULL
			  AND row_data->'subprofile' != 'null'::jsonb;
		`);

		const totalToMigrate = parseInt(countResult.rows[0]?.count ?? '0', 10);
		console.log(`[*] Found ${totalToMigrate} messages containing legacy subprofile data.`);

		if (totalToMigrate === 0 || isDryRun) {
			console.log(isDryRun ? '[*] Dry run finished. No rows updated.' : '[*] All messages are already migrated.');
			return;
		}

		const batchSize = 500;
		let migratedCount = 0;
		const startTime = Date.now();

		while (migratedCount < totalToMigrate) {
			const updateResult = await client.query(
				`
				WITH target_rows AS (
					SELECT ctid
					FROM "${kvTable}"
					WHERE table_name = 'messages'
					  AND row_data->'subprofile' IS NOT NULL
					  AND row_data->'subprofile' != 'null'::jsonb
					LIMIT $1
				)
				UPDATE "${kvTable}"
				SET row_data = CASE
					WHEN row_data->'subprofile'->>'id' IS NOT NULL THEN
						(row_data - 'subprofile') || jsonb_build_object('persona_id', row_data->'subprofile'->>'id')
					ELSE
						row_data - 'subprofile'
				END
				WHERE ctid IN (SELECT ctid FROM target_rows);
			`,
				[batchSize],
			);

			const rowCount = updateResult.rowCount ?? 0;
			if (rowCount === 0) {
				break;
			}

			migratedCount += rowCount;
			const progress = ((migratedCount / totalToMigrate) * 100).toFixed(1);
			console.log(`[*] Migrated ${migratedCount}/${totalToMigrate} messages (${progress}%)...`);
		}

		// Also clean up any lingering 'subprofile': null keys
		await client.query(`
			UPDATE "${kvTable}"
			SET row_data = row_data - 'subprofile'
			WHERE table_name = 'messages'
			  AND row_data->'subprofile' = 'null'::jsonb;
		`);

		const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(`[*] Migration completed successfully in ${elapsed}s. Total messages migrated: ${migratedCount}.`);
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
