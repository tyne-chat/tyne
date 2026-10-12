// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

const {initiateWithReturnLink} = await import('./ForkHandoffReturnLink.ts');

const RETURN_URI = 'tyne://handoff';

function instance(statusFor) {
	const bodies = [];
	return {
		bodies,
		send: async (body) => {
			bodies.push(body);
			return {status: statusFor(body), payload: {return_method: body == null ? 'code' : 'deep_link'}};
		},
	};
}

describe('starting a browser sign-in with the return link of this app', () => {
	test('an instance that knows the link scheme is asked once and keeps the link', async () => {
		const {bodies, send} = instance(() => 200);
		const {response, returnUri} = await initiateWithReturnLink(RETURN_URI, send);
		assert.deepEqual(bodies, [{return_uri: RETURN_URI}]);
		assert.equal(returnUri, RETURN_URI);
		assert.equal(response.payload.return_method, 'deep_link');
	});

	test('an instance that refuses the link is asked again without one, and the sign-in goes by code', async () => {
		const {bodies, send} = instance((body) => (body == null ? 200 : 400));
		const {response, returnUri} = await initiateWithReturnLink(RETURN_URI, send);
		assert.deepEqual(bodies, [{return_uri: RETURN_URI}, null]);
		assert.equal(returnUri, null);
		assert.equal(response.status, 200);
		assert.equal(response.payload.return_method, 'code');
	});

	test('any other failure is reported as it is, without a second request', async () => {
		for (const status of [401, 429, 500, 503]) {
			const {bodies, send} = instance(() => status);
			const {response, returnUri} = await initiateWithReturnLink(RETURN_URI, send);
			assert.equal(bodies.length, 1, `status ${status}`);
			assert.equal(response.status, status);
			assert.equal(returnUri, RETURN_URI);
		}
	});

	test('an instance that refuses the request either way is not asked a third time', async () => {
		const {bodies, send} = instance(() => 400);
		const {response, returnUri} = await initiateWithReturnLink(RETURN_URI, send);
		assert.equal(bodies.length, 2);
		assert.equal(response.status, 400);
		assert.equal(returnUri, null);
	});

	test('with no link registered the request carries none', async () => {
		const {bodies, send} = instance(() => 200);
		const {returnUri} = await initiateWithReturnLink(null, send);
		assert.deepEqual(bodies, [null]);
		assert.equal(returnUri, null);
	});
});
