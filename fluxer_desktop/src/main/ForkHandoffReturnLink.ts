// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: when a sign-in is started in the browser, the app tells the instance the link that
// brings the sign-in back to it. Tyne's is tyne://handoff. An instance checks that link against
// the schemes it knows, and one that runs upstream's code only knows fluxer://, so it refuses the
// whole request (400). Tyne then asks again without a return link: the sign-in still works and
// is finished by typing the code the browser shows, as on a system where no link is registered.

const BAD_REQUEST = 400;

interface HandoffInitiation<Response> {
	readonly response: Response;
	// The return link the instance was given and did not refuse.
	readonly returnUri: string | null;
}

export async function initiateWithReturnLink<Response extends {readonly status: number}>(
	returnUri: string | null,
	send: (body: {return_uri: string} | null) => Promise<Response>,
): Promise<HandoffInitiation<Response>> {
	if (returnUri == null) {
		return {response: await send(null), returnUri: null};
	}
	const response = await send({return_uri: returnUri});
	if (response.status !== BAD_REQUEST) {
		return {response, returnUri};
	}
	return {response: await send(null), returnUri: null};
}
