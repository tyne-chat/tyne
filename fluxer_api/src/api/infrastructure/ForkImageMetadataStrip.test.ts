// SPDX-License-Identifier: AGPL-3.0-or-later

import {forkStripImageMetadata} from '@app/api/infrastructure/ForkImageMetadataStrip';
import sharp from 'sharp';
import {describe, expect, it, vi} from 'vitest';

async function jpegWithMetadata(): Promise<Uint8Array> {
	return new Uint8Array(
		await sharp({create: {width: 64, height: 32, channels: 3, background: '#336699'}})
			.jpeg({quality: 85})
			.withMetadata({orientation: 6, exif: {IFD0: {Copyright: 'where it was taken'}}})
			.toBuffer(),
	);
}

function proxy(answer: () => Promise<Uint8Array | null>) {
	return {stripImageMetadata: vi.fn(answer)};
}

describe('forkStripImageMetadata', () => {
	it("stores the proxy's strip of a JPEG, not a re-encode", async () => {
		const stripped = new Uint8Array([0xff, 0xd8, 1, 2, 3]);
		const mediaService = proxy(async () => stripped);
		const upload = await jpegWithMetadata();
		expect(await forkStripImageMetadata(mediaService, upload, 'jpeg')).toBe(stripped);
		expect(await forkStripImageMetadata(mediaService, upload, 'jpg')).toBe(stripped);
		expect(mediaService.stripImageMetadata).toHaveBeenCalledTimes(2);
		expect(mediaService.stripImageMetadata).toHaveBeenCalledWith(upload);
	});

	it('re-encodes a JPEG the proxy cannot strip, so its metadata is never stored', async () => {
		const upload = await jpegWithMetadata();
		expect((await sharp(upload).metadata()).exif).toBeDefined();
		for (const mediaService of [
			proxy(async () => null),
			proxy(async () => {
				throw new Error('media proxy unavailable');
			}),
		]) {
			const stored = await forkStripImageMetadata(mediaService, upload, 'jpeg');
			expect(stored).not.toBeNull();
			const metadata = await sharp(stored ?? new Uint8Array()).metadata();
			expect(metadata.format).toBe('jpeg');
			expect(metadata.exif).toBeUndefined();
		}
	});

	it("leaves other formats to the proxy's answer, as upstream did", async () => {
		const png = new Uint8Array(
			await sharp({create: {width: 8, height: 8, channels: 4, background: '#fff0'}})
				.png()
				.toBuffer(),
		);
		const stripped = new Uint8Array([0x89, 0x50]);
		expect(
			await forkStripImageMetadata(
				proxy(async () => stripped),
				png,
				'png',
			),
		).toBe(stripped);
		expect(
			await forkStripImageMetadata(
				proxy(async () => null),
				png,
				'png',
			),
		).toBeNull();
		await expect(
			forkStripImageMetadata(
				proxy(async () => {
					throw new Error('media proxy unavailable');
				}),
				png,
				'png',
			),
		).rejects.toThrow('media proxy unavailable');
	});
});
