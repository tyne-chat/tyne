import {expect, test} from '@playwright/test';
import {FluxerApiClient} from '../../api-helpers/client.js';

test.describe('Persona Asset Management & Batch Avatar Import', () => {
	const baseURL = process.env.E2E_BASE_URL || 'http://localhost:9188';

	test('single avatar importer rejects private IP and localhost targets via SSRF validation', async () => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const email = `import_user_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `imp_${timestamp}`;
		const auth = await client.register({
			username,
			email,
			password,
			global_name: 'Importer Tester',
		});

		// Test that private IP literal is rejected with 400
		const res = await fetch(`${baseURL}/api/v1/users/@me/personas/import-avatar`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${auth.token}`,
			},
			body: JSON.stringify({url: 'http://127.0.0.1:8080/exploit.png'}),
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.message).toBe('Could not import an avatar from this URL');
	});

	test('batch avatar importer enforces SSRF protection and streams NDJSON progress', async () => {
		const timestamp = Date.now().toString().slice(-6);
		const client = new FluxerApiClient(baseURL);

		const email = `ssrf_user_${timestamp}@test.local`;
		const password = 'TestPassword123!';
		const username = `ssrf_${timestamp}`;
		await client.register({
			username,
			email,
			password,
			global_name: 'SSRF Tester',
		});

		// Attempt to batch import from local/private IPs (SSRF targets)
		const dangerousUrls = [
			'http://127.0.0.1:8080/internal-secret.png',
			'http://localhost/admin.png',
			'http://169.254.169.254/latest/meta-data/',
		];

		const streamResponseText = await client.importPersonaBatchAvatars(dangerousUrls);
		const lines = streamResponseText.trim().split('\n').filter(Boolean);
		expect(lines.length).toBeGreaterThanOrEqual(2);

		// Parse NDJSON lines
		const events = lines.map((line) => JSON.parse(line));
		const startEvent = events.find((e) => e.type === 'start');
		expect(startEvent).toBeTruthy();
		expect(startEvent.total).toBe(dangerousUrls.length);

		// Verify each SSRF URL triggered a safe validation error without server crash
		const progressEvents = events.filter((e) => e.type === 'progress');
		expect(progressEvents.length).toBe(dangerousUrls.length);
		for (const prog of progressEvents) {
			expect(prog.error).toBeTruthy();
			expect(prog.avatar_url).toBeFalsy();
		}
	});
});
