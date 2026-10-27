// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: how far the crop modal zooms in (tyne-chat/tyne#229). Upstream stops at 3x the fitted
// image whatever its resolution, which is not enough to pick a face out of a large photo. Here
// the limit follows the image: zooming may go on until the result shows each of the original's
// pixels six times as large as the size being set (600%), where 100% is one
// original pixel per pixel of the result. The modal never scales its result up, so past 100% the
// saved image is smaller than the maximum size and the app scales it when showing it. Upstream's
// 3x stays as the floor, so a small image zooms as far as before.

export const UPSTREAM_MAX_CROP_ZOOM = 3;
export const MAX_CROP_PIXEL_SCALE = 6;

interface Size {
	width: number;
	height: number;
}

export function forkMaxCropZoom(
	naturalWidth: number | undefined,
	displayDimensions: Size | null,
	cropDimensions: Size | null,
	maxWidth: number,
	maxHeight: number,
): number {
	if (
		!naturalWidth ||
		!displayDimensions ||
		!cropDimensions ||
		displayDimensions.width <= 0 ||
		maxWidth <= 0 ||
		maxHeight <= 0
	) {
		return UPSTREAM_MAX_CROP_ZOOM;
	}
	// Original pixels per on-screen pixel at zoom 1. At zoom z the crop box spans
	// cropDimensions * nativePerDisplay / z original pixels; the result is that, shrunk to fit
	// maxWidth x maxHeight. Solve for the zoom at which the result is MAX_CROP_PIXEL_SCALE times
	// smaller than the box it fits in.
	const nativePerDisplay = naturalWidth / displayDimensions.width;
	const fitRatio = Math.max(cropDimensions.width / maxWidth, cropDimensions.height / maxHeight);
	const zoom = MAX_CROP_PIXEL_SCALE * nativePerDisplay * fitRatio;
	return Number.isFinite(zoom) ? Math.max(UPSTREAM_MAX_CROP_ZOOM, zoom) : UPSTREAM_MAX_CROP_ZOOM;
}
