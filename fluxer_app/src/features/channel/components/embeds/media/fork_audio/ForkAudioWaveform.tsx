// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: the audio player's seek bar drawn as the sound's waveform (tyne-chat/tyne#873). The part
 * already played is in the accent colour while the sound plays and grey while it is paused, so the
 * bar also shows whether it is playing. Without a waveform (an older upload, a file too long or in a
 * format the server could not read) it is a plain bar that behaves the same.
 */

import styles from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioPlayer.module.css';
import {
	decodeForkWaveform,
	forkWaveformBarCount,
	isForkWaveformBarPlayed,
	resampleForkWaveform,
} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioWaveformUtils';
import {clsx} from 'clsx';
import type React from 'react';
import {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react';

/** One bar and the gap after it, in rem: 0.125rem each. */
const BAR_PITCH_REM = 0.25;
const KEYBOARD_STEP = 5;

interface ForkAudioWaveformProps {
	waveform?: string | null;
	progress: number;
	playing: boolean;
	label: string;
	valueText: string;
	onSeek: (percentage: number) => void;
	onSeekPreview?: (percentage: number) => void;
	onSeekStart?: () => void;
	onSeekEnd?: () => void;
	className?: string;
}

/** A bar's height as a share of the waveform's height (0.5 is half). */
function barHeightPercent(fraction: number): string {
	return `${Math.round(fraction * 1000) / 10}%`;
}

function rootFontSize(): number {
	if (typeof document === 'undefined') return 16;
	const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
	return size > 0 ? size : 16;
}

function percentageAt(element: HTMLElement, clientX: number): number {
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0) return 0;
	const fraction = (clientX - rect.left) / rect.width;
	const percentage = (document.documentElement.dir === 'rtl' ? 1 - fraction : fraction) * 100;
	return Math.max(0, Math.min(100, percentage));
}

export function ForkAudioWaveform({
	waveform,
	progress,
	playing,
	label,
	valueText,
	onSeek,
	onSeekPreview,
	onSeekStart,
	onSeekEnd,
	className,
}: ForkAudioWaveformProps) {
	const ref = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const [width, setWidth] = useState(0);
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
	const points = useMemo(() => decodeForkWaveform(waveform), [waveform]);
	const bars = useMemo(
		() => resampleForkWaveform(points, forkWaveformBarCount(width, BAR_PITCH_REM * rootFontSize())),
		[points, width],
	);
	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			draggingRef.current = true;
			event.currentTarget.setPointerCapture?.(event.pointerId);
			onSeekStart?.();
			onSeekPreview?.(percentageAt(event.currentTarget, event.clientX));
		},
		[onSeekPreview, onSeekStart],
	);
	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!draggingRef.current) return;
			onSeekPreview?.(percentageAt(event.currentTarget, event.clientX));
		},
		[onSeekPreview],
	);
	const handlePointerUp = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!draggingRef.current) return;
			draggingRef.current = false;
			event.currentTarget.releasePointerCapture?.(event.pointerId);
			onSeek(percentageAt(event.currentTarget, event.clientX));
			onSeekEnd?.();
		},
		[onSeek, onSeekEnd],
	);
	const handlePointerCancel = useCallback(() => {
		if (!draggingRef.current) return;
		draggingRef.current = false;
		onSeekEnd?.();
	}, [onSeekEnd]);
	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
			const backward = document.documentElement.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
			if (event.key === forward) {
				event.preventDefault();
				onSeek(Math.min(100, progress + KEYBOARD_STEP));
			} else if (event.key === backward) {
				event.preventDefault();
				onSeek(Math.max(0, progress - KEYBOARD_STEP));
			} else if (event.key === 'Home') {
				event.preventDefault();
				onSeek(0);
			}
		},
		[onSeek, progress],
	);
	return (
		<div
			ref={ref}
			role="slider"
			tabIndex={0}
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress)}
			aria-valuetext={valueText}
			className={clsx(styles.waveform, className)}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerCancel}
			onKeyDown={handleKeyDown}
			onClick={(event) => event.stopPropagation()}
			data-flx="channel.embeds.media.fork-audio.fork-audio-waveform.waveform.stop-propagation"
		>
			{bars.length > 0 ? (
				bars.map((height, index) => (
					<span
						key={index}
						className={clsx(
							styles.bar,
							isForkWaveformBarPlayed(index, bars.length, progress) &&
								(playing ? styles.barPlayedActive : styles.barPlayedIdle),
						)}
						style={{height: barHeightPercent(height)}}
						data-flx="channel.embeds.media.fork-audio.fork-audio-waveform.bar"
					/>
				))
			) : (
				<span className={styles.line} data-flx="channel.embeds.media.fork-audio.fork-audio-waveform.line">
					<span
						className={clsx(styles.lineFill, playing && styles.lineFillActive)}
						style={{width: `${progress}%`}}
						data-flx="channel.embeds.media.fork-audio.fork-audio-waveform.line-fill"
					/>
				</span>
			)}
		</div>
	);
}
