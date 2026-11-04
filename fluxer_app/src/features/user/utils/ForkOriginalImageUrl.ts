// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {unwrapDesktopLocalResourceURL} from '@app/features/messaging/utils/DesktopLocalResourceTarget';
import {resolveDesktopDisplayResourceURL} from '@app/features/messaging/utils/DesktopResourceUrl';

/** An avatar or banner the media proxy serves: an account's or persona's, or a server profile's. */
const STORED_IMAGE_PATH =
	/^\/(?:(?:avatars|banners)\/\d+|guilds\/\d+\/users\/\d+\/(?:avatars|banners))\/[A-Za-z0-9_]+\.[a-z]+$/;

/**
 * Fork: the address of the stored image behind an avatar or banner address (tyne-chat/tyne#471).
 *
 * The apps show avatars and banners as small WebP copies, and the menus' "Copy URL" and "Open in
 * browser" used to hand out the same copy. With `original=true` the media proxy answers with the
 * stored image itself, in its own format and size (`fork_original_asset.rs`); `.png` only names a
 * format for a proxy that does not know the parameter. Anything else (a preview of an unsaved
 * image, a default avatar, another host) is returned as it is.
 */
export function toOriginalImageUrl(url: string): string;
export function toOriginalImageUrl(url: string | null): string | null;
export function toOriginalImageUrl(url: string | null): string | null {
	if (!url) return url;
	const mediaEndpoint = RuntimeConfig.mediaEndpoint.replace(/\/$/, '');
	if (!mediaEndpoint) return url;
	let target: URL;
	let endpoint: URL;
	try {
		target = new URL(unwrapDesktopLocalResourceURL(url));
		endpoint = new URL(mediaEndpoint);
	} catch {
		return url;
	}
	const endpointPath = endpoint.pathname.replace(/\/$/, '');
	if (target.origin !== endpoint.origin || !target.pathname.startsWith(`${endpointPath}/`)) return url;
	const assetPath = target.pathname.slice(endpointPath.length);
	if (!STORED_IMAGE_PATH.test(assetPath)) return url;
	target.pathname = `${endpointPath}${assetPath.replace(/\.[a-z]+$/, '.png')}`;
	target.search = '';
	target.searchParams.set('original', 'true');
	target.hash = '';
	return resolveDesktopDisplayResourceURL(target.toString());
}
