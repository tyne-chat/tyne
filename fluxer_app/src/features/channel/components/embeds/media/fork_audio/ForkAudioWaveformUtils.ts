// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fork: the audio player's waveform data (tyne-chat/tyne#873). The server computes an audio
 * attachment's waveform as the app computes a voice message's: up to 256 bytes, base64, each the
 * loudness of one slice of the sound from 0 to 255.
 */

/** The shortest bar, as a fraction of the full height, so silence still shows as a line. */
export const FORK_WAVEFORM_MIN_BAR = 0.08;

/** The waveform's points from 0 to 1; none for a missing or unreadable waveform. */
export function decodeForkWaveform(waveform: string | null | undefined): Array<number> {
	if (!waveform) return [];
	try {
		const decoded = atob(waveform);
		const values: Array<number> = [];
		for (let i = 0; i < decoded.length; i++) {
			values.push(decoded.charCodeAt(i) / 255);
		}
		return values;
	} catch {
		return [];
	}
}

/**
 * `values` drawn as `count` bars: each bar is the average of the points it covers (a point split
 * between two bars counts for both, by the share each covers), and never shorter than
 * `FORK_WAVEFORM_MIN_BAR`.
 */
export function resampleForkWaveform(values: ReadonlyArray<number>, count: number): Array<number> {
	if (count <= 0 || values.length === 0) return [];
	const bars: Array<number> = [];
	for (let bar = 0; bar < count; bar++) {
		const start = (bar * values.length) / count;
		const end = ((bar + 1) * values.length) / count;
		let sum = 0;
		let weight = 0;
		for (let point = Math.floor(start); point < Math.ceil(end) && point < values.length; point++) {
			const share = Math.min(end, point + 1) - Math.max(start, point);
			if (share <= 0) continue;
			sum += (values[point] ?? 0) * share;
			weight += share;
		}
		const value = weight > 0 ? sum / weight : 0;
		bars.push(Math.min(1, Math.max(FORK_WAVEFORM_MIN_BAR, value)));
	}
	return bars;
}

/** How many bars fit in `width` when each bar and its gap take `pitch`, within the limits. */
export function forkWaveformBarCount(width: number, pitch: number, min = 12, max = 120): number {
	if (!(width > 0) || !(pitch > 0)) return min;
	return Math.max(min, Math.min(max, Math.floor(width / pitch)));
}

/** Whether bar `index` of `count` is in the part already played, at `progress` percent. */
export function isForkWaveformBarPlayed(index: number, count: number, progress: number): boolean {
	return ((index + 0.5) / count) * 100 <= progress;
}
