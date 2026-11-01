import type {Locator, Page} from '@playwright/test';

// Starts a long press on `target` and holds it until `until` has done its waiting. Cancelled rather
// than ended: lifting the finger would tap whichever menu item opened under it.
export async function longPress(page: Page, target: Locator, until: () => Promise<void>): Promise<void> {
	const box = await target.boundingBox();
	if (box === null) {
		throw new Error('Nothing to press');
	}
	const touch = await page.context().newCDPSession(page);
	const point = {x: box.x + Math.min(12, box.width / 2), y: box.y + box.height / 2};
	await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
	await until();
	await touch.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
}
