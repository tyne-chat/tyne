// SPDX-License-Identifier: AGPL-3.0-or-later
// Fork: the names of the files a Discord import stores (tyne-chat/tyne#608). Discord let a file be uploaded with a
// name far longer than Tyne's 255 characters (FilenameType, which refuses a longer one), and the storage takes no
// key whose file name is longer than 255 bytes (SeaweedFS: KeyTooLongError, found importing a 360-byte name on the
// scratch copy on 2026-11-28). Such a name keeps its start and its extension, cut to fit.

/** At most this many bytes of UTF-8: Tyne's limit in characters, and the storage's in bytes. */
export const MAX_FILENAME_BYTES = 255;

/** An extension longer than this is part of the name, not an extension. */
const MAX_EXTENSION = 16;

export function fitFilename(name: string, maxBytes = MAX_FILENAME_BYTES): string {
	const size = (s: string) => Buffer.byteLength(s, 'utf8');
	if (size(name) <= maxBytes) return name;
	const dot = name.lastIndexOf('.');
	const extension = dot > 0 && name.length - dot <= MAX_EXTENSION ? name.slice(dot) : '';
	// Whole characters only, so a cut never leaves half of one.
	const stem = Array.from(name.slice(0, name.length - extension.length));
	let bytes = size(extension);
	let keep = 0;
	while (keep < stem.length && bytes + size(stem[keep]) <= maxBytes) bytes += size(stem[keep++]);
	return stem.slice(0, keep).join('') + extension;
}
