// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork (tyne-chat/tyne#879): a saved audio file in the Media tab shows its cover art, or else its
 * waveform, in place of upstream's music note (one element in `MemeGridItem.tsx`).
 *
 * - With a cover: the cover fills the tile, with the file name, length and format on top of it.
 * - Without one: upstream's audio card, the waveform where the music note was, the length, name and
 *   format under it.
 *
 * A saved item does not say whether it has either, so the tile asks the media proxy: the cover from
 * the saved file's own URL with `cover=1` (`forkCoverURL`), and only when there is none, the waveform
 * with `waveform=1` (`ForkLinkedWaveform.ts`, once per file, a failure not repeated). A missing cover
 * is remembered until the page reloads, so each file costs at most one cover request and one
 * waveform request, to the media proxy, not the API.
 */

import {forkCoverURL} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioCover';
import {
	decodeForkWaveform,
	resampleForkWaveform,
} from '@app/features/channel/components/embeds/media/fork_audio/ForkAudioWaveformUtils';
import {useForkLinkedWaveform} from '@app/features/channel/components/embeds/media/fork_audio/ForkLinkedWaveform';
import styles from '@app/features/channel/components/MemesPicker.module.css';
import forkStyles from '@app/features/channel/components/pickers/memes/ForkSavedAudioTile.module.css';
import {formatDuration, getFileExtension} from '@app/features/channel/components/pickers/memes/MediaFormat';
import type {FavoriteMeme} from '@app/features/expressions/models/FavoriteMeme';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {getFormattingLocale} from '@app/features/user/utils/LocaleUtils';
import {useMemo, useState} from 'react';

/** The cover is fetched this wide in CSS pixels (a tile is at most about this wide). */
const COVER_SIZE = 256;
const WAVEFORM_BARS = 32;

const missingCovers = new Set<string>();

function fileKey(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return url;
	}
}

/** Whether the saved file at `url` was found to have no cover since the page loaded. */
export function forkSavedAudioCoverMissing(url: string): boolean {
	return missingCovers.has(fileKey(url));
}

/** Remembers that the saved file at `url` has no cover, so it is not asked for again. */
export function forkMarkSavedAudioCoverMissing(url: string): void {
	missingCovers.add(fileKey(url));
}

/** For tests: forgets the covers found missing. */
export function forgetMissingSavedAudioCovers(): void {
	missingCovers.clear();
}

interface ForkSavedAudioTileProps {
	meme: Pick<FavoriteMeme, 'filename' | 'contentType' | 'duration'>;
	/** The saved file's URL, signed; empty until it is, or while the tile should load nothing. */
	memeUrl: string;
}

export function ForkSavedAudioTile({meme, memeUrl}: ForkSavedAudioTileProps) {
	const [coverFailed, setCoverFailed] = useState(false);
	const showCover = Boolean(memeUrl) && !coverFailed && !forkSavedAudioCoverMissing(memeUrl);
	const waveform = useForkLinkedWaveform(memeUrl, Boolean(memeUrl) && !showCover);
	const bars = useMemo(() => resampleForkWaveform(decodeForkWaveform(waveform), WAVEFORM_BARS), [waveform]);
	const coverUrl = useMemo(() => (showCover ? forkCoverURL(memeUrl, COVER_SIZE) : ''), [showCover, memeUrl]);
	const duration = meme.duration ? formatDuration(meme.duration, getFormattingLocale()) : null;
	const format = getFileExtension(meme.filename, meme.contentType);

	if (showCover && coverUrl) {
		return (
			<div className={forkStyles.coverTile} data-flx="channel.pickers.memes.fork-saved-audio-tile.cover-tile">
				<img
					src={coverUrl}
					alt=""
					className={forkStyles.cover}
					draggable={false}
					onError={() => {
						forkMarkSavedAudioCoverMissing(memeUrl);
						setCoverFailed(true);
					}}
					data-flx="channel.pickers.memes.fork-saved-audio-tile.cover"
				/>
				<div className={forkStyles.coverDetails} data-flx="channel.pickers.memes.fork-saved-audio-tile.cover-details">
					<Tooltip text={meme.filename} data-flx="channel.pickers.memes.fork-saved-audio-tile.tooltip">
						<div className={forkStyles.coverName} data-flx="channel.pickers.memes.fork-saved-audio-tile.cover-name">
							{meme.filename}
						</div>
					</Tooltip>
					<div className={forkStyles.coverRow} data-flx="channel.pickers.memes.fork-saved-audio-tile.cover-row">
						{duration && (
							<span
								className={forkStyles.coverDuration}
								data-flx="channel.pickers.memes.fork-saved-audio-tile.duration"
							>
								{duration}
							</span>
						)}
						<span className={forkStyles.coverBadge} data-flx="channel.pickers.memes.fork-saved-audio-tile.badge">
							{format}
						</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={styles.audioCard} data-flx="channel.pickers.memes.fork-saved-audio-tile.audio-card">
			<div
				className={forkStyles.waveform}
				aria-hidden="true"
				data-flx="channel.pickers.memes.fork-saved-audio-tile.waveform"
			>
				{bars.length > 0 ? (
					bars.map((height, index) => (
						<span
							key={index}
							className={forkStyles.bar}
							style={{height: `${Math.round(height * 100)}%`}}
							data-flx="channel.pickers.memes.fork-saved-audio-tile.bar"
						/>
					))
				) : (
					<span className={forkStyles.line} data-flx="channel.pickers.memes.fork-saved-audio-tile.line" />
				)}
			</div>
			<div className={styles.audioMeta} data-flx="channel.pickers.memes.fork-saved-audio-tile.audio-meta">
				{duration && (
					<div className={styles.audioDuration} data-flx="channel.pickers.memes.fork-saved-audio-tile.audio-duration">
						{duration}
					</div>
				)}
				<Tooltip text={meme.filename} data-flx="channel.pickers.memes.fork-saved-audio-tile.tooltip--2">
					<div className={styles.audioFilename} data-flx="channel.pickers.memes.fork-saved-audio-tile.audio-filename">
						{meme.filename}
					</div>
				</Tooltip>
				<div className={styles.audioBadge} data-flx="channel.pickers.memes.fork-saved-audio-tile.audio-badge">
					{format}
				</div>
			</div>
		</div>
	);
}
