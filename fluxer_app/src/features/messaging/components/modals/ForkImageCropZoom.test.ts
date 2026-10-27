// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	forkMaxCropZoom,
	MAX_CROP_PIXEL_SCALE,
	UPSTREAM_MAX_CROP_ZOOM,
} from '@app/features/messaging/components/modals/ForkImageCropZoom';
import {describe, expect, it} from 'vitest';

// The output size the modal would produce at a zoom: the crop box in original pixels, shrunk (never
// grown) to fit maxWidth x maxHeight, as exportStaticImage does.
function outputScaleAt(
	zoom: number,
	naturalWidth: number,
	display: {width: number; height: number},
	crop: {width: number; height: number},
	maxWidth: number,
	maxHeight: number,
): number {
	const nativeWidth = (crop.width * naturalWidth) / (display.width * zoom);
	const nativeHeight = (crop.height * naturalWidth) / (display.width * zoom);
	return Math.min(maxWidth / nativeWidth, maxHeight / nativeHeight);
}

describe('forkMaxCropZoom (tyne-chat/tyne#229)', () => {
	it('lets a large photo zoom until each original pixel is shown at 600% of the avatar', () => {
		// A 12000 x 8000 photo fitted into a 480 x 320 cropper, with a 320 x 320 avatar box.
		const display = {width: 480, height: 320};
		const crop = {width: 320, height: 320};
		const zoom = forkMaxCropZoom(12000, display, crop, 1024, 1024);
		expect(zoom).toBeGreaterThan(15.2);
		expect(outputScaleAt(zoom, 12000, display, crop, 1024, 1024)).toBeCloseTo(MAX_CROP_PIXEL_SCALE);
	});

	it('uses the side that limits the result for a banner box', () => {
		const display = {width: 600, height: 400};
		const crop = {width: 600, height: 240};
		const zoom = forkMaxCropZoom(6000, display, crop, 2400, 960);
		expect(outputScaleAt(zoom, 6000, display, crop, 2400, 960)).toBeCloseTo(MAX_CROP_PIXEL_SCALE);
	});

	it("keeps upstream's 3x for an image too small to need more", () => {
		expect(forkMaxCropZoom(256, {width: 400, height: 400}, {width: 400, height: 400}, 1024, 1024)).toBe(
			UPSTREAM_MAX_CROP_ZOOM,
		);
	});

	it("falls back to upstream's 3x before the image has loaded", () => {
		expect(forkMaxCropZoom(undefined, null, null, 1024, 1024)).toBe(UPSTREAM_MAX_CROP_ZOOM);
		expect(forkMaxCropZoom(0, {width: 400, height: 400}, {width: 400, height: 400}, 1024, 1024)).toBe(
			UPSTREAM_MAX_CROP_ZOOM,
		);
	});
});
