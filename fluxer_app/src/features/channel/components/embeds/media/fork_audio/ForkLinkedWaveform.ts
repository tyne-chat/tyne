// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: the waveform of a link to an audio attachment (tyne-chat/tyne#873). An attachment carries
 * its waveform; a pasted link to one becomes an embed, which has no waveform field, so the server
 * flags the embed's audio `HAS_WAVEFORM` and the media proxy serves the stored waveform, raw bytes,
 * from the link's own URL with `waveform=1`.
 *
 * Requests: one per linked attachment per page load, shared by every player showing it (links to
 * the same file differ only in their signature, so the key is the URL without its query). A request
 * that fails is not made again until the page reloads. They go to the media proxy, not the API, so
 * they do not count towards the API's per-user rate limit.
 */

import {resolveDesktopCrossOriginMediaURL} from '@app/features/messaging/utils/DesktopResourceUrl';
import {
	FORK_ATTACHMENT_WAVEFORM_PARAMETER,
	ForkMessageAttachmentFlags,
} from '@fluxer/constants/src/ForkAttachmentConstants';
import {useEffect, useState} from 'react';

/** A waveform is at most 256 bytes; anything much larger is not one. */
const MAX_WAVEFORM_BYTES = 4096;

const waveforms = new Map<string, Promise<string | null>>();

export function forkMediaHasLinkedWaveform(flags: number | undefined): boolean {
	return ((flags ?? 0) & ForkMessageAttachmentFlags.HAS_WAVEFORM) !== 0;
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** The waveform of the attachment a link points at, as base64 like an attachment's, or null. */
export function loadForkLinkedWaveform(attachmentUrl: string, fetcher: typeof fetch = fetch): Promise<string | null> {
	let url: URL;
	try {
		url = new URL(attachmentUrl);
	} catch {
		return Promise.resolve(null);
	}
	const key = `${url.origin}${url.pathname}`;
	const known = waveforms.get(key);
	if (known) return known;
	url.searchParams.set(FORK_ATTACHMENT_WAVEFORM_PARAMETER, '1');
	const request = fetcher(resolveDesktopCrossOriginMediaURL(url.toString()) ?? url.toString())
		.then(async (response) => {
			if (!response.ok) return null;
			const bytes = new Uint8Array(await response.arrayBuffer());
			return bytes.length === 0 || bytes.length > MAX_WAVEFORM_BYTES ? null : toBase64(bytes);
		})
		.catch(() => null);
	waveforms.set(key, request);
	return request;
}

/** The linked attachment's waveform once loaded, when `enabled`; undefined until then or without. */
export function useForkLinkedWaveform(attachmentUrl: string, enabled: boolean): string | undefined {
	const [waveform, setWaveform] = useState<string | undefined>(undefined);
	useEffect(() => {
		setWaveform(undefined);
		if (!enabled) return undefined;
		let current = true;
		void loadForkLinkedWaveform(attachmentUrl).then((value) => {
			if (current) setWaveform(value ?? undefined);
		});
		return () => {
			current = false;
		};
	}, [attachmentUrl, enabled]);
	return waveform;
}

/** For tests: forgets every waveform loaded or failed. */
export function forgetForkLinkedWaveforms(): void {
	waveforms.clear();
}
