// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the media proxy runs no NSFW classifier, read from the setting the media proxy itself reads
 * (tyne-chat/tyne#888).
 *
 * The media proxy classifies only when `FLUXER_NSFW_SERVICE_ENDPOINT` is set. Left empty (after
 * trailing slashes are removed, as `NSFWEndpoint::new` in `fluxer_media_proxy/src/nsfw.rs` does), its
 * `/_metadata` answers `nsfw: false` for every file. A probe made only for that answer
 * (`isExplicitStoredMedia`: forwards, crossposts, favourite media sent as a message) then makes the
 * proxy fetch, hash and decode the stored file for nothing: a forward of 19 camera photos sent 19
 * such probes at once and filled its memory budget (tyne-chat/tyne#886).
 *
 * Off only when the API is given the variable and it is empty. Not given at all, the API keeps
 * probing as upstream does, so a deployment that sets a classifier only on the media proxy loses
 * nothing. Deployments pass the same variable to the media proxy, the API and the worker.
 */
export function forkNsfwClassifierOff(): boolean {
	const endpoint = process.env.FLUXER_NSFW_SERVICE_ENDPOINT;
	return endpoint !== undefined && endpoint.replace(/\/+$/, '') === '';
}
