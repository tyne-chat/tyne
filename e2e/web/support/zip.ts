import {inflateRawSync} from 'node:zlib';

/**
 * Reads the files of a zip into memory: stored and deflated entries, no ZIP64. Sizes and offsets
 * come from the central directory, which is complete even when the writer used data descriptors.
 */
export function readZip(zip: Uint8Array): Map<string, Buffer> {
	const buffer = Buffer.from(zip);
	let end = -1;
	for (let i = buffer.length - 22; i >= 0; i--) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error('Not a zip: no end of central directory');
	const count = buffer.readUInt16LE(end + 10);
	let offset = buffer.readUInt32LE(end + 16);
	const files = new Map<string, Buffer>();
	for (let i = 0; i < count; i++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Broken central directory');
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
		const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
		const data = buffer.subarray(start, start + compressedSize);
		if (method === 0) files.set(name, Buffer.from(data));
		else if (method === 8) files.set(name, inflateRawSync(data));
		else throw new Error(`Unsupported compression method ${method} for ${name}`);
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return files;
}
