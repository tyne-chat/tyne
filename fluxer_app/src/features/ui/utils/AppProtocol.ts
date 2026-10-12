// SPDX-License-Identifier: AGPL-3.0-or-later

const APP_PROTOCOL = 'fluxer';
export const APP_PROTOCOL_SCHEME = `${APP_PROTOCOL}:`;
export const APP_PROTOCOL_PREFIX = `${APP_PROTOCOL}://`;

// Fork: a link the browser hands to the operating system has to open the fork's desktop app, Tyne,
// which registers tyne:// and not fluxer://. Links inside messages keep the fluxer: form above.
const DESKTOP_APP_LINK_SCHEME = 'tyne:';

export function buildAppProtocolUrl(path: string): string {
	const cleaned = path.startsWith('/') ? path : `/${path.replace(/^\/+/, '')}`;
	return `${DESKTOP_APP_LINK_SCHEME}${cleaned}`;
}

export function isAppProtocolUrl(url: string): boolean {
	if (url.length <= APP_PROTOCOL_SCHEME.length) return false;
	try {
		return new URL(url).protocol.toLowerCase() === APP_PROTOCOL_SCHEME;
	} catch {
		return url.toLowerCase().startsWith(APP_PROTOCOL_SCHEME);
	}
}
