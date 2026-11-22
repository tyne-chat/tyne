// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: the audio attachment player with the file's cover art and its waveform (tyne-chat/tyne#873).
 * It takes the place of upstream's `InlineAudioPlayer` in `EmbedAudio`, with the same props and the
 * same playback hooks, so favourites, download, the context menu and deleting stay upstream's.
 *
 * - Left: the round play button and the file name (two lines, the extension never cut off); below,
 *   the waveform as the seek bar and the time; then volume, speed, favourite and download.
 * - Right: the cover, when the server kept one (`ForkMessageAttachmentFlags.HAS_COVER`). Clicking it
 *   opens the cover large in the media viewer. A cover that fails to load is dropped, not retried.
 * - The whole title row plays and pauses; the play button stays the one keyboard and screen-reader
 *   control. Dragging across the name still selects it, and a mouse click on the name's text waits
 *   a quarter second, so that a double click selects a word instead of starting the sound.
 * - In a narrow card (a phone, a narrow window) the cover shrinks to the height of the title and the
 *   waveform, and the time moves to the bottom row: `ForkAudioPlayer.module.css`'s container query.
 */

import {
	findForkAudioMedia,
	forkAttachmentHasCover,
	forkCoverURL,
	forkLinkedFileName,
} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioCover';
import {ForkAudioName} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioName';
import styles from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioPlayer.module.css';
import {ForkAudioWaveform} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioWaveform';
import {
	forkMediaHasLinkedWaveform,
	useForkLinkedWaveform,
} from '@app/features/channel/components/embeds/media/fork_audio/ForkLinkedWaveform';
import {
	ADD_TO_FAVORITES_DESCRIPTOR,
	DOWNLOAD_DESCRIPTOR,
	PAUSE_DESCRIPTOR,
	PLAY_DESCRIPTOR,
	REMOVE_FROM_FAVORITES_DESCRIPTOR,
} from '@app/features/i18n/utils/CommonMessageDescriptors';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {resolveDesktopCrossOriginMediaURL} from '@app/features/messaging/utils/DesktopResourceUrl';
import {remFromPx} from '@app/features/theme/layout/RemFromPx';
import * as MediaViewerCommands from '@app/features/ui/commands/MediaViewerCommands';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {MediaPlaybackRate} from '@app/features/voice/components/media_player/components/MediaPlaybackRate';
import {MediaVolumeControl} from '@app/features/voice/components/media_player/components/MediaVolumeControl';
import {useMediaPlayer} from '@app/features/voice/components/media_player/hooks/useMediaPlayer';
import {useMediaProgress} from '@app/features/voice/components/media_player/hooks/useMediaProgress';
import {useMediaVolume} from '@app/features/voice/components/media_player/hooks/useMediaVolume';
import {useMetadataPreload} from '@app/features/voice/components/media_player/hooks/useMetadataPreload';
import {AUDIO_PLAYBACK_RATES} from '@app/features/voice/components/media_player/utils/MediaConstants';
import {detachMediaElementSource} from '@app/features/voice/components/media_player/utils/MediaSeekUtils';
import {formatDuration} from '@fluxer/date_utils/src/DateDuration';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {DownloadSimpleIcon, PauseIcon, PlayIcon, StarIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import type React from 'react';
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';

const AUDIO_PLAYER_DESCRIPTOR = msg({
	message: 'Audio player',
	comment: 'Aria label for the inline audio attachment player container.',
});
const AUDIO_PROGRESS_DESCRIPTOR = msg({
	message: 'Audio progress',
	comment: 'Aria label on the playback progress slider in the inline audio attachment player.',
});
const VIEW_COVER_DESCRIPTOR = msg({
	message: 'View cover',
	comment:
		'Accessible label and tooltip of the cover art shown in an audio attachment player; activating it opens the cover large.',
});

/** The cover's largest size in the card, in rem; the thumbnail is fetched at this width. */
const COVER_DISPLAY_REM = 9.25;
/** How long a mouse click on the name waits, so that a double click can select a word instead. */
const NAME_CLICK_DELAY_MS = 250;

interface ForkAudioPlayerProps {
	message?: Message;
	messageId?: string;
	channelId?: string;
	attachmentId?: string;
	/** For a link to an audio file: its embed, whose flags say what of the linked file can be shown. */
	embedIndex?: number;
	snapshotIndex?: number;
	/** The attachment's URL as stored (its signed proxy URL), from which the cover's URL is built. */
	attachmentUrl: string;
	src: string;
	title?: string;
	fileSize?: number;
	duration?: number;
	isMobile?: boolean;
	isFavorited?: boolean;
	canFavorite?: boolean;
	onFavoriteClick?: (e: React.MouseEvent) => void;
	onDownloadClick?: (e: React.MouseEvent) => void;
	onContextMenu?: (e: React.MouseEvent) => void;
	className?: string;
}

function splitFilename(filename: string): {name: string; extension: string} {
	const lastDot = filename.lastIndexOf('.');
	if (lastDot <= 0) return {name: filename, extension: ''};
	return {name: filename.substring(0, lastDot), extension: filename.substring(lastDot)};
}

export function ForkAudioPlayer({
	message,
	messageId,
	channelId,
	attachmentId,
	embedIndex,
	snapshotIndex,
	attachmentUrl,
	src,
	title = 'Audio',
	duration: initialDuration,
	isMobile = false,
	isFavorited = false,
	canFavorite = false,
	onFavoriteClick,
	onDownloadClick,
	onContextMenu,
	className,
}: ForkAudioPlayerProps) {
	const {i18n} = useLingui();
	const [hasStarted, setHasStarted] = useState(false);
	const [coverFailed, setCoverFailed] = useState(false);
	const pendingPlayRef = useRef(false);
	const pendingSeekRef = useRef<number | null>(null);
	const nameClickTimerRef = useRef<number | null>(null);
	const pointerTypeRef = useRef('mouse');
	const {mediaRef, state, play, toggle, setPlaybackRate} = useMediaPlayer({mediaKind: 'audio'});
	const {currentTime, duration, progress, previewSeekToPercentage, seekToPercentage, startSeeking, endSeeking} =
		useMediaProgress({mediaRef, initialDuration});
	const {volume, isMuted, setVolume, toggleMute} = useMediaVolume({mediaRef});
	const {escalateToMetadata, sourceAttribute, preloadAttribute} = useMetadataPreload(src, hasStarted);
	const media = findForkAudioMedia(message, attachmentId, embedIndex, snapshotIndex);
	const linkedWaveform = useForkLinkedWaveform(
		attachmentUrl,
		media?.waveform == null && forkMediaHasLinkedWaveform(media?.flags),
	);
	const showCover = forkAttachmentHasCover(media) && !coverFailed;
	const coverThumbnail = useMemo(
		() => (showCover ? forkCoverURL(attachmentUrl, COVER_DISPLAY_REM * 16) : ''),
		[showCover, attachmentUrl],
	);
	const displayDuration = duration > 0 ? duration : (initialDuration ?? 0);
	const timeLabel = `${formatDuration(Math.floor(currentTime))} / ${formatDuration(Math.ceil(displayDuration))}`;
	const isLoading = hasStarted && state.isBuffering;
	const linkedFileName =
		attachmentId === undefined && embedIndex !== undefined ? forkLinkedFileName(attachmentUrl) : null;
	const {name: fileName, extension: fileExtension} = splitFilename(linkedFileName ?? title);

	useLayoutEffect(() => {
		const media = mediaRef.current;
		return () => {
			detachMediaElementSource(media ?? mediaRef.current);
		};
	}, [mediaRef, isMobile]);
	useEffect(
		() => () => {
			if (nameClickTimerRef.current !== null) window.clearTimeout(nameClickTimerRef.current);
		},
		[],
	);
	useEffect(() => {
		if (!hasStarted || sourceAttribute === undefined || !pendingPlayRef.current) return undefined;
		const timer = setTimeout(() => {
			if (!pendingPlayRef.current) return;
			pendingPlayRef.current = false;
			const media = mediaRef.current;
			const seek = pendingSeekRef.current;
			pendingSeekRef.current = null;
			if (seek !== null && media) {
				if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
					seekToPercentage(seek);
				} else {
					media.addEventListener('loadedmetadata', () => seekToPercentage(seek), {once: true});
				}
			}
			play();
		}, 0);
		return () => clearTimeout(timer);
	}, [hasStarted, mediaRef, play, seekToPercentage, sourceAttribute]);

	const togglePlayback = useCallback(() => {
		if (!hasStarted) {
			pendingPlayRef.current = true;
			setHasStarted(true);
			return;
		}
		pendingPlayRef.current = false;
		toggle();
	}, [hasStarted, toggle]);
	const handlePlayButtonClick = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			togglePlayback();
		},
		[togglePlayback],
	);
	const handleTitleRowPointerDown = useCallback((event: React.PointerEvent) => {
		pointerTypeRef.current = event.pointerType;
	}, []);
	const handleTitleRowClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (event.defaultPrevented || event.button !== 0) return;
			const selection = window.getSelection?.();
			if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
			const onName = (event.target as HTMLElement).closest(`.${styles.name}`) !== null;
			if (onName && pointerTypeRef.current === 'mouse') {
				if (nameClickTimerRef.current !== null) {
					window.clearTimeout(nameClickTimerRef.current);
					nameClickTimerRef.current = null;
				}
				if (event.detail > 1) return;
				nameClickTimerRef.current = window.setTimeout(() => {
					nameClickTimerRef.current = null;
					togglePlayback();
				}, NAME_CLICK_DELAY_MS);
				return;
			}
			togglePlayback();
		},
		[togglePlayback],
	);
	const handleSeek = useCallback(
		(percentage: number) => {
			if (!hasStarted) {
				pendingSeekRef.current = percentage;
				pendingPlayRef.current = true;
				setHasStarted(true);
				return;
			}
			seekToPercentage(percentage);
		},
		[hasStarted, seekToPercentage],
	);
	const handleSeekPreview = useCallback(
		(percentage: number) => {
			if (hasStarted) previewSeekToPercentage(percentage);
		},
		[hasStarted, previewSeekToPercentage],
	);
	const handleCoverClick = useCallback(
		async (event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			const original = forkCoverURL(attachmentUrl);
			if (!original) return;
			const image = new Image();
			image.src = original;
			try {
				await image.decode();
			} catch {
				return;
			}
			MediaViewerCommands.openMediaViewer(
				[
					{
						src: original,
						originalSrc: original,
						naturalWidth: image.naturalWidth,
						naturalHeight: image.naturalHeight,
						type: 'image',
						filename: title,
					},
				],
				0,
				{channelId, messageId, message},
			);
		},
		[attachmentUrl, channelId, message, messageId, title],
	);

	return (
		<div
			className={clsx(styles.container, className)}
			onContextMenu={onContextMenu}
			role="group"
			aria-label={i18n._(AUDIO_PLAYER_DESCRIPTOR)}
			onPointerEnter={escalateToMetadata}
			data-flx="channel.embeds.media.fork-audio.fork-audio-player.container.context-menu"
		>
			<audio
				ref={mediaRef as React.RefObject<HTMLAudioElement>}
				src={resolveDesktopCrossOriginMediaURL(sourceAttribute)}
				preload={preloadAttribute}
				data-flx="channel.embeds.media.fork-audio.fork-audio-player.audio"
			>
				<track kind="captions" data-flx="channel.embeds.media.fork-audio.fork-audio-player.track" />
			</audio>
			<div
				className={clsx(styles.layout, !showCover && styles.layoutNoCover)}
				data-flx="channel.embeds.media.fork-audio.fork-audio-player.layout"
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: a bigger mouse and touch target for the play button inside it, which keyboards and screen readers use. */}
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: as above; the play button inside takes the keys. */}
				<div
					className={styles.titleRow}
					onPointerDown={handleTitleRowPointerDown}
					onClick={handleTitleRowClick}
					data-flx="channel.embeds.media.fork-audio.fork-audio-player.title-row"
				>
					<FocusRing offset={-2} data-flx="channel.embeds.media.fork-audio.fork-audio-player.focus-ring">
						<button
							type="button"
							onClick={handlePlayButtonClick}
							className={styles.playButton}
							aria-label={state.isPlaying ? i18n._(PAUSE_DESCRIPTOR) : i18n._(PLAY_DESCRIPTOR)}
							data-flx="channel.embeds.media.fork-audio.fork-audio-player.play-button"
						>
							{isLoading && (
								<span
									className={styles.loadingSpinner}
									data-flx="channel.embeds.media.fork-audio.fork-audio-player.loading-spinner"
								/>
							)}
							{state.isPlaying ? (
								<PauseIcon
									size={remFromPx(20)}
									weight="fill"
									data-flx="channel.embeds.media.fork-audio.fork-audio-player.pause-icon"
								/>
							) : (
								<PlayIcon
									size={remFromPx(20)}
									weight="fill"
									data-flx="channel.embeds.media.fork-audio.fork-audio-player.play-icon"
								/>
							)}
						</button>
					</FocusRing>
					<ForkAudioName
						name={fileName}
						extension={fileExtension}
						className={styles.name}
						extensionClassName={styles.extension}
						data-flx="channel.embeds.media.fork-audio.fork-audio-player.name"
					/>
				</div>
				<div className={styles.waveRow} data-flx="channel.embeds.media.fork-audio.fork-audio-player.wave-row">
					<ForkAudioWaveform
						waveform={media?.waveform ?? linkedWaveform}
						progress={progress}
						playing={state.isPlaying}
						label={i18n._(AUDIO_PROGRESS_DESCRIPTOR)}
						valueText={timeLabel}
						onSeek={handleSeek}
						onSeekPreview={handleSeekPreview}
						onSeekStart={startSeeking}
						onSeekEnd={endSeeking}
						data-flx="channel.embeds.media.fork-audio.fork-audio-player.fork-audio-waveform"
					/>
					<span
						className={clsx(styles.time, styles.timeWide)}
						data-flx="channel.embeds.media.fork-audio.fork-audio-player.time"
					>
						{timeLabel}
					</span>
				</div>
				{showCover && (
					<Tooltip
						text={i18n._(VIEW_COVER_DESCRIPTOR)}
						position="top"
						openOnMountHover={false}
						data-flx="channel.embeds.media.fork-audio.fork-audio-player.tooltip"
					>
						<FocusRing offset={-2} data-flx="channel.embeds.media.fork-audio.fork-audio-player.focus-ring--2">
							<button
								type="button"
								className={styles.cover}
								onClick={handleCoverClick}
								aria-label={i18n._(VIEW_COVER_DESCRIPTOR)}
								data-flx="channel.embeds.media.fork-audio.fork-audio-player.cover.button"
							>
								<img
									src={coverThumbnail}
									alt=""
									className={styles.coverImage}
									loading="lazy"
									decoding="async"
									draggable={false}
									onError={() => setCoverFailed(true)}
									data-flx="channel.embeds.media.fork-audio.fork-audio-player.cover-image"
								/>
							</button>
						</FocusRing>
					</Tooltip>
				)}
				<div className={styles.controls} data-flx="channel.embeds.media.fork-audio.fork-audio-player.controls">
					<span
						className={clsx(styles.time, styles.timeNarrow)}
						data-flx="channel.embeds.media.fork-audio.fork-audio-player.time--2"
					>
						{timeLabel}
					</span>
					<div className={styles.volume} data-flx="channel.embeds.media.fork-audio.fork-audio-player.volume">
						<MediaVolumeControl
							volume={volume}
							isMuted={isMuted}
							onVolumeChange={setVolume}
							onToggleMute={toggleMute}
							iconSize={18}
							expandable
							compact
							data-flx="channel.embeds.media.fork-audio.fork-audio-player.media-volume-control"
						/>
					</div>
					<div className={styles.controlsEnd} data-flx="channel.embeds.media.fork-audio.fork-audio-player.controls-end">
						<MediaPlaybackRate
							rate={state.playbackRate}
							onRateChange={setPlaybackRate}
							rates={AUDIO_PLAYBACK_RATES}
							size="small"
							data-flx="channel.embeds.media.fork-audio.fork-audio-player.media-playback-rate"
						/>
						{canFavorite && onFavoriteClick && (
							<Tooltip
								text={isFavorited ? i18n._(REMOVE_FROM_FAVORITES_DESCRIPTOR) : i18n._(ADD_TO_FAVORITES_DESCRIPTOR)}
								position="top"
								openOnMountHover={false}
								data-flx="channel.embeds.media.fork-audio.fork-audio-player.tooltip--2"
							>
								<FocusRing offset={-2} data-flx="channel.embeds.media.fork-audio.fork-audio-player.focus-ring--3">
									<button
										type="button"
										onClick={(e) => onFavoriteClick(e)}
										className={styles.actionButton}
										aria-label={
											isFavorited ? i18n._(REMOVE_FROM_FAVORITES_DESCRIPTOR) : i18n._(ADD_TO_FAVORITES_DESCRIPTOR)
										}
										data-flx="channel.embeds.media.fork-audio.fork-audio-player.action-button.favorite-click"
									>
										<StarIcon
											size={remFromPx(18)}
											weight={isFavorited ? 'fill' : 'regular'}
											data-flx="channel.embeds.media.fork-audio.fork-audio-player.star-icon"
										/>
									</button>
								</FocusRing>
							</Tooltip>
						)}
						{onDownloadClick && (
							<Tooltip
								text={i18n._(DOWNLOAD_DESCRIPTOR)}
								position="top"
								openOnMountHover={false}
								data-flx="channel.embeds.media.fork-audio.fork-audio-player.tooltip--3"
							>
								<FocusRing offset={-2} data-flx="channel.embeds.media.fork-audio.fork-audio-player.focus-ring--4">
									<button
										type="button"
										onClick={(e) => onDownloadClick(e)}
										className={styles.actionButton}
										aria-label={i18n._(DOWNLOAD_DESCRIPTOR)}
										data-flx="channel.embeds.media.fork-audio.fork-audio-player.action-button.download-click"
									>
										<DownloadSimpleIcon
											size={remFromPx(18)}
											weight="bold"
											data-flx="channel.embeds.media.fork-audio.fork-audio-player.download-simple-icon"
										/>
									</button>
								</FocusRing>
							</Tooltip>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
