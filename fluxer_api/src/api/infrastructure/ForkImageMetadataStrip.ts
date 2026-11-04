// SPDX-License-Identifier: AGPL-3.0-or-later

import type {IMediaService} from '@app/api/infrastructure/IMediaService';
import {Logger} from '@app/api/Logger';
import sharp from 'sharp';

/**
 * Fork: strips an uploaded image's metadata through the media proxy's `/_strip`, JPEGs included
 * (tyne-chat/tyne#476).
 *
 * Upstream re-encoded every JPEG with sharp at quality 100 instead. That doubled the file, cut 4:4:4
 * chroma to 4:2:0, and dropped the EXIF orientation without turning the pixels. The proxy drops a
 * JPEG's metadata segments without touching the image data. Only a JPEG that is not upright is
 * re-encoded, once, upright, so no client has to honour an orientation tag.
 *
 * When the proxy cannot strip a JPEG, upstream's re-encode is the fallback, so a JPEG is never
 * stored with its metadata. For other formats the result is the proxy's, as upstream had it: `null`
 * when it fails, which the callers log before keeping the upload as it is.
 */
export async function forkStripImageMetadata(
	mediaService: Pick<IMediaService, 'stripImageMetadata'>,
	image: Uint8Array,
	format: string | null | undefined,
): Promise<Uint8Array | null> {
	const isJpeg = format === 'jpg' || format === 'jpeg';
	try {
		const stripped = await mediaService.stripImageMetadata(image);
		if (stripped || !isJpeg) return stripped;
	} catch (error) {
		if (!isJpeg) throw error;
		Logger.warn({error}, 'Media proxy failed to strip a JPEG, re-encoding it instead');
		return await sharp(image).jpeg({quality: 100}).toBuffer();
	}
	Logger.warn({}, 'Media proxy could not strip a JPEG, re-encoding it instead');
	return await sharp(image).jpeg({quality: 100}).toBuffer();
}
