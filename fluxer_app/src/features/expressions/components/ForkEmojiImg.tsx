// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: upstream's emoji <img>, with an animated custom emoji kept in step with the others that share
// its loop length (tyne-chat/tyne#612, utils/ForkSyncedEmojiPlayback.ts). It renders the same <img>
// with the same props, so styles, events and accessibility stay upstream's; only the image it shows
// is the emoji's strip of frames, moved to the clock's frame. Anything else, or a browser without
// ImageDecoder, gets upstream's <img> unchanged.

import {
	forkEmojiNearViewport,
	forkEmojiStrips,
	forkSyncedEmojiPlayer,
	forkSyncedEmojiSupported,
	isForkSyncableEmojiUrl,
} from '@app/features/expressions/utils/ForkSyncedEmojiPlayback';
import type React from 'react';
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';

type ForkEmojiImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {alt: string; ref?: React.Ref<HTMLImageElement>};

export function ForkEmojiImg({ref, src, alt, style, ...props}: ForkEmojiImgProps): React.ReactElement {
	const syncable = useMemo(() => src != null && forkSyncedEmojiSupported() && isForkSyncableEmojiUrl(src), [src]);
	const getState = useCallback(() => (syncable && src != null ? forkEmojiStrips.peek(src) : null), [syncable, src]);
	const state = useSyncExternalStore(forkEmojiStrips.subscribe, getState, getState);
	const imgRef = useRef<HTMLImageElement | null>(null);
	const [nearViewport, setNearViewport] = useState(false);
	useLayoutEffect(() => {
		const img = imgRef.current;
		if (!syncable || !img) return;
		return forkEmojiNearViewport.observe(img, setNearViewport);
	}, [syncable]);
	useEffect(
		() => (syncable && nearViewport && src != null ? forkEmojiStrips.acquire(src) : undefined),
		[syncable, nearViewport, src],
	);
	const strip = state?.status === 'ready' ? state.strip : null;
	// Until its frames are ready the emoji stays hidden, so it does not play out of step first.
	const pending = syncable && strip === null && state?.status !== 'failed';
	useLayoutEffect(() => {
		const img = imgRef.current;
		if (!strip || !img) return;
		return forkSyncedEmojiPlayer.attach(img, strip);
	}, [strip]);
	const setRef = useCallback(
		(node: HTMLImageElement | null) => {
			imgRef.current = node;
			if (typeof ref === 'function') {
				ref(node);
			} else if (ref) {
				ref.current = node;
			}
		},
		[ref],
	);
	const shownStyle = useMemo<React.CSSProperties | undefined>(() => {
		if (strip) return {...style, objectFit: 'cover'};
		if (pending) return {...style, opacity: 0};
		return style;
	}, [strip, pending, style]);
	return (
		<img
			data-flx="expressions.fork-emoji-img.img"
			{...props}
			ref={setRef}
			src={strip?.url ?? src}
			alt={alt}
			style={shownStyle}
		/>
	);
}
