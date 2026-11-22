// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: an audio file's name on up to two lines whose extension always shows (tyne-chat/tyne#873).
 * The name runs over the full width; when it is too long, its end is cut and `…` put before the
 * extension, which ends the last line. CSS can clamp lines but cannot keep a suffix, so the cut is
 * measured: in a hidden copy of the element, never in the text React renders.
 */

import {useLayoutEffect, useRef, useState} from 'react';

/** The longest start of `name` that, followed by `…`, `fits`; `name` itself when it fits whole. */
export function truncateForkName(name: string, fits: (text: string) => boolean): string {
	if (fits(name)) return name;
	let low = 0;
	let high = name.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (fits(`${name.slice(0, middle)}…`)) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return `${name.slice(0, low)}…`;
}

interface ForkAudioNameProps {
	name: string;
	extension: string;
	className?: string;
	extensionClassName?: string;
	maxLines?: number;
}

export function ForkAudioName({name, extension, className, extensionClassName, maxLines = 2}: ForkAudioNameProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const [width, setWidth] = useState(0);
	const [shown, setShown] = useState(name);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver((entries) => {
			const next = Math.round(entries[0]?.contentRect.width ?? 0);
			setWidth((current) => (current === next ? current : next));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useLayoutEffect(() => {
		const element = ref.current;
		const parent = element?.parentElement;
		if (!element || !parent || width <= 0) {
			setShown(name);
			return;
		}
		const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
		if (!(lineHeight > 0)) {
			setShown(name);
			return;
		}
		const probe = element.cloneNode(true) as HTMLSpanElement;
		probe.removeAttribute('title');
		probe.setAttribute('aria-hidden', 'true');
		probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;inset-inline-start:0;top:0;width:${element.clientWidth}px`;
		parent.appendChild(probe);
		const stem = probe.firstElementChild;
		const limit = lineHeight * maxLines + 1;
		const result = truncateForkName(name, (text) => {
			if (stem) stem.textContent = text;
			return probe.scrollHeight <= limit;
		});
		probe.remove();
		setShown(result);
	}, [name, extension, maxLines, width]);
	return (
		<span
			ref={ref}
			className={className}
			title={`${name}${extension}`}
			data-flx="channel.embeds.media.fork-audio.fork-audio-name.span"
		>
			<span data-flx="channel.embeds.media.fork-audio.fork-audio-name.span--2">{shown}</span>
			<span className={extensionClassName} data-flx="channel.embeds.media.fork-audio.fork-audio-name.span--3">
				{extension}
			</span>
		</span>
	);
}
