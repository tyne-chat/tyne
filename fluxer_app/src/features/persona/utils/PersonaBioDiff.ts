// SPDX-License-Identifier: AGPL-3.0-or-later

// The words two bios do not share, for the import review to mark (tyne-chat/tyne#574): a word-by-word
// longest common subsequence, so a bio with one sentence added shows only that sentence marked.

export interface BioPart {
	text: string;
	/** Not in the other bio. */
	changed: boolean;
}

/** Above this many words and spaces on a side the table gets large; the bios are then not marked. */
const MAX_TOKENS = 3000;

function tokens(text: string): Array<string> {
	return text.match(/\s+|[^\s]+/g) ?? [];
}

function merge(parts: Array<BioPart>): Array<BioPart> {
	// Spaces between two changed words belong to the change, so a changed phrase is one mark.
	for (let i = 1; i < parts.length - 1; i++) {
		const part = parts[i]!;
		if (!part.changed && !part.text.trim() && parts[i - 1]!.changed && parts[i + 1]!.changed) part.changed = true;
	}
	const merged: Array<BioPart> = [];
	for (const part of parts) {
		const last = merged[merged.length - 1];
		if (last && last.changed === part.changed) last.text += part.text;
		else merged.push({...part});
	}
	return merged;
}

/** Each bio in parts, the words the other does not have marked; null when the bios are too long to compare. */
export function diffBios(file: string, tyne: string): {file: Array<BioPart>; tyne: Array<BioPart>} | null {
	const a = tokens(file);
	const b = tokens(tyne);
	if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;
	const width = b.length + 1;
	const table = new Uint16Array((a.length + 1) * width);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i * width + j] =
				a[i] === b[j]
					? table[(i + 1) * width + j + 1]! + 1
					: Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
		}
	}
	const fileParts: Array<BioPart> = [];
	const tyneParts: Array<BioPart> = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			fileParts.push({text: a[i]!, changed: false});
			tyneParts.push({text: b[j]!, changed: false});
			i++;
			j++;
		} else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
			fileParts.push({text: a[i]!, changed: Boolean(a[i]!.trim())});
			i++;
		} else {
			tyneParts.push({text: b[j]!, changed: Boolean(b[j]!.trim())});
			j++;
		}
	}
	for (; i < a.length; i++) fileParts.push({text: a[i]!, changed: Boolean(a[i]!.trim())});
	for (; j < b.length; j++) tyneParts.push({text: b[j]!, changed: Boolean(b[j]!.trim())});
	return {file: merge(fileParts), tyne: merge(tyneParts)};
}
