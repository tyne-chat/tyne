// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: a sticker keeps the uploaded file when it fits the limits, instead of being squared to
// 320×320 and re-encoded (tyne-chat/tyne#658). The media proxy scales stickers for display, keeping
// their shape (tyne-chat/tyne#659), so the stored original costs only storage. A still image over
// the limits is shrunk to STICKER_MAX_SIDE if it is larger, keeping its shape, and sent as a
// lossless PNG when that fits the byte limit; otherwise upstream's fitImageWithin compresses it to a
// lossy WebP that fits. Animated stickers and SVGs are sent as they are, or refused when too large,
// as upstream does.
import {isAnimatedFile} from '@app/features/expressions/utils/AnimatedImageUtils';
import {fitImageWithin, optimizeStickerImage} from '@app/features/expressions/utils/ImageCropUtils';
import {isSvgFile} from '@app/features/expressions/utils/ImageUploadFileUtils';
import {readBlobAsBase64NoPrefix} from '@app/features/platform/utils/BlobDataUrl';

/** The largest side a sticker keeps. The sticker settings text says 2048 too. */
export const STICKER_MAX_SIDE = 2048;

/** The sticker image to send, as the create request takes it. */
export async function prepareStickerImage(file: File, maxBytes: number): Promise<string> {
	if (isSvgFile(file) || (await isAnimatedFile(file))) return optimizeStickerImage(file, maxBytes);
	const fitted = await fitImageWithin(file, STICKER_MAX_SIDE, maxBytes);
	if (fitted === file) return readBlobAsBase64NoPrefix(file);
	const png = await shrunkPng(file, STICKER_MAX_SIDE);
	return readBlobAsBase64NoPrefix(png && png.size <= maxBytes ? png : fitted);
}

/** `file` as a PNG whose longer side is at most `maxSide`, or null if the browser cannot make one. */
async function shrunkPng(file: File, maxSide: number): Promise<Blob | null> {
	const bitmap = await createImageBitmap(file);
	try {
		const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(bitmap.width * scale));
		canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	} finally {
		bitmap.close();
	}
}
