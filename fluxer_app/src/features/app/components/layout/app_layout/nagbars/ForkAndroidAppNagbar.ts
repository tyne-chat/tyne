// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether upstream's nagbar for Fluxer's Android app on Google Play (upstream's #3917) may show. Never
 * on Tyne: it opens Fluxer's listing, and Tyne has its own Android app, which it already tells people
 * how to get (tyne-chat/tyne#546).
 */
export function forkAllowsFluxerAndroidAppNagbar(): boolean {
	return false;
}
