// SPDX-License-Identifier: AGPL-3.0-or-later

let shiftPasteActive = false;
let shiftPasteTimeout: ReturnType<typeof setTimeout> | null = null;

export function markShiftPasteActive(): void {
	shiftPasteActive = true;
	if (shiftPasteTimeout !== null) {
		clearTimeout(shiftPasteTimeout);
	}
	shiftPasteTimeout = setTimeout(() => {
		shiftPasteActive = false;
		shiftPasteTimeout = null;
	}, 500);
}

export function isShiftPasteActive(): boolean {
	return shiftPasteActive;
}

export function clearShiftPaste(): void {
	shiftPasteActive = false;
	if (shiftPasteTimeout !== null) {
		clearTimeout(shiftPasteTimeout);
		shiftPasteTimeout = null;
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener(
		'keydown',
		(event) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				event.shiftKey &&
				(event.key === 'v' || event.key === 'V' || event.code === 'KeyV')
			) {
				markShiftPasteActive();
			} else if (
				(event.ctrlKey || event.metaKey) &&
				!event.shiftKey &&
				(event.key === 'v' || event.key === 'V' || event.code === 'KeyV')
			) {
				clearShiftPaste();
			}
		},
		true,
	);
}
