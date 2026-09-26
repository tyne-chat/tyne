// SPDX-License-Identifier: AGPL-3.0-or-later

// @ts-expect-error pg types are not installed in fluxer_api
import pg from 'pg';

async function main(): Promise<void> {
	const isDryRun = process.argv.includes('--dry-run');
	console.log(`Starting system_name removal and display_tag_text migration${isDryRun ? ' [DRY RUN]' : ''}...`);

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

		// 1. Find all users who have persona system_name set
		const usersWithSystemNames = await client.query<{
			partition_key: string;
			system_name: string;
		}>(`
			SELECT 
				partition_key,
				(array_agg(row_data->>'system_name') FILTER (WHERE row_data->>'system_name' IS NOT NULL AND length(trim(row_data->>'system_name')) > 0))[1] as system_name
			FROM "${kvTable}"
			WHERE table_name = 'personas'
			  AND row_data->>'system_name' IS NOT NULL
			  AND length(trim(row_data->>'system_name')) > 0
			GROUP BY partition_key;
		`);

		console.log(`[*] Found ${usersWithSystemNames.rows.length} users with persona system_name set.`);

		for (const row of usersWithSystemNames.rows) {
			const partitionKey = row.partition_key;
			const systemName = row.system_name;

			// Check user_persona_settings
			const settingsRes = await client.query<{row_data: any}>(
				`
				SELECT row_data
				FROM "${kvTable}"
				WHERE table_name = 'user_persona_settings'
				  AND partition_key = $1;
			`,
				[partitionKey],
			);

			if (settingsRes.rows.length > 0) {
				const currentSettings = settingsRes.rows[0].row_data;
				const currentTagText = currentSettings?.display_tag_text;
				if (!currentTagText || currentTagText.trim().length === 0) {
					console.log(
						`[*] Migrating system_name "${systemName}" to user_persona_settings.display_tag_text for user ${partitionKey}...`,
					);
					if (!isDryRun) {
						await client.query(
							`
							UPDATE "${kvTable}"
							SET row_data = jsonb_set(row_data, '{display_tag_text}', to_jsonb($1::text)),
							    updated_at = NOW()
							WHERE table_name = 'user_persona_settings'
							  AND partition_key = $2;
						`,
							[systemName.trim(), partitionKey],
						);
					}
				} else {
					console.log(
						`[*] User ${partitionKey} already has custom display_tag_text: "${currentTagText}". Preserving existing.`,
					);
				}
			} else {
				console.log(
					`[*] Creating user_persona_settings with display_tag_text "${systemName}" for user ${partitionKey}...`,
				);
				if (!isDryRun) {
					const nowIso = new Date().toISOString();
					const newSettingsRow = {
						user_id: JSON.parse(partitionKey),
						version: 1,
						is_latched: false,
						display_tag_text: systemName.trim(),
						display_tag_icon: null,
						active_persona_id: null,
						active_persona_mode: 'off',
						updated_at: {
							__fluxer_type: 'date',
							value: nowIso,
						},
					};
					await client.query(
						`
						INSERT INTO "${kvTable}" (table_name, partition_key, row_key, row_data, updated_at)
						VALUES ('user_persona_settings', $1, $1, $2::jsonb, NOW());
					`,
						[partitionKey, JSON.stringify(newSettingsRow)],
					);
				}
			}
		}

		// 2. Count personas having system_name key
		const personaCountRes = await client.query<{count: string}>(`
			SELECT COUNT(*)::text as count
			FROM "${kvTable}"
			WHERE table_name = 'personas'
			  AND row_data ? 'system_name';
		`);
		const personaCount = parseInt(personaCountRes.rows[0]?.count ?? '0', 10);
		console.log(`[*] Found ${personaCount} personas containing 'system_name' key.`);

		if (personaCount > 0 && !isDryRun) {
			console.log(`[*] Stripping 'system_name' from all personas in "${kvTable}"...`);
			const updateRes = await client.query(`
				UPDATE "${kvTable}"
				SET row_data = row_data - 'system_name',
				    updated_at = NOW()
				WHERE table_name = 'personas'
				  AND row_data ? 'system_name';
			`);
			console.log(`[+] Stripped 'system_name' from ${updateRes.rowCount} persona rows.`);
		}

		// 3. Clean any lingering system_name from messages
		if (!isDryRun) {
			await client.query(`
				UPDATE "${kvTable}"
				SET row_data = row_data - 'system_name',
				    updated_at = NOW()
				WHERE table_name = 'messages'
				  AND row_data ? 'system_name';
			`);
		}

		console.log(`[+] Database migration completed successfully!`);
	} finally {
		await client.end();
	}
}

main().catch((err) => {
	console.error('[!] Migration failed:', err);
	process.exit(1);
});
