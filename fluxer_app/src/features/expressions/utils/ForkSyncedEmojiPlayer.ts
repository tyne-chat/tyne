// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: draws animated custom emoji on the clocks of ForkSyncedEmojiClock.ts (tyne-chat/tyne#612).
// Upstream's <img> stays where it is, with its `src`, alt text, classes and events, so everything
// that is not pixels (copying, menus, tooltips, styles, layout) is upstream's. While an emoji is kept
// in step, the <img> is invisible and a <canvas> put right after it in the page lies exactly over it;
// the player draws the frame the clock gives on every such canvas in the same animation frame. A
// whole frame always goes to the same rectangle, so nothing that stands still in the emoji moves
// between frames.
//
// The canvas is out of the flow (`position: absolute`), so it takes no room and changes no layout,
// wherever upstream shows an emoji. It has no `left` or `top`: it starts where it would have been in
// the flow, next to its <img>, and moves with it when the page around them is laid out again. The
// margins that bring it from there onto the <img> are measured, and checked again on every frame
// drawn.
//
// An emoji nobody can see (a status emoji that only shows while its row is hovered, a spoiler not
// yet revealed, an image upstream hides) is left to upstream: nothing is drawn for it and it holds no
// clock, until a look a few times a second finds it visible.

import {
	ForkSyncedEmojiClocks,
	forkEmojiFrameAt,
	forkEmojiMsToNextFrame,
} from '@app/features/expressions/utils/ForkSyncedEmojiClock';
import type {ForkEmojiFrames} from '@app/features/expressions/utils/ForkSyncedEmojiFrames';

// Set on upstream's <img> while its canvas shows the emoji; a rule in an adopted stylesheet makes
// such an <img> invisible. Not an inline style, and with a value that is new on every page load:
// upstream's reload cover (BootDomFrame) is a copy of the page's elements, shown over the next page
// load, and a copied <img> has to stay visible there, next to its copied, empty canvas.
export const FORK_EMOJI_SYNCED_ATTRIBUTE = 'data-fork-emoji-synced';
export const FORK_EMOJI_CANVAS_ATTRIBUTE = 'data-fork-emoji-canvas';
// Set on an image's parent where the canvas would otherwise not scroll with the image (see
// forkEmojiCanvasStaysWithImage): the same stylesheet makes that parent `position: relative`.
export const FORK_EMOJI_ANCHOR_ATTRIBUTE = 'data-fork-emoji-anchor';
const SYNCED_IN_THIS_PAGE_LOAD = Math.random().toString(36).slice(2);
// A timer wakes the player this long before the next frame is due; the animation frame after it
// draws. Until then nothing runs, however fast the screen refreshes.
const WAKE_BEFORE_FRAME_MS = 12;
// While emoji are shown, the player looks at least this often whether every canvas still lies on its
// image, whether it can be seen and whether the screen's pixel ratio changed, however long the
// frames last.
const LOOK_AGAIN_AFTER_MS = 250;
// A canvas this far (in CSS pixels) from where it belongs is put back.
const PLACEMENT_TOLERANCE = 0.05;
// A canvas that a move did not bring onto its image this many times in a row is in a layout this
// code does not understand: the image is given back to upstream.
const MOVES_BEFORE_GIVING_UP = 4;
// What the canvas is, whatever its classes say: inline-level before it is taken out of the flow, so
// that it starts on the image's line, at its end; no box of its own beyond its pixels; out of reach
// of the pointer and of text selection. It wears the image's classes (see `dress`), so upstream's
// rules for the image's look reach it too; these pin down what those rules must not change.
const CANVAS_STYLE = [
	'display:inline-block',
	'position:absolute',
	'inset:auto',
	'float:none',
	'box-sizing:content-box',
	'width:0',
	'height:0',
	'min-width:0',
	'min-height:0',
	'max-width:none',
	'max-height:none',
	'margin:0',
	'padding:0',
	'border:0',
	'object-fit:fill',
	'object-position:50% 50%',
	'transition-property:opacity,filter,transform',
	'pointer-events:none',
	'user-select:none',
].join(';');

type Fit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

// The image's content box as the page lays it out, in CSS pixels.
interface ImageBox {
	readonly width: number;
	readonly height: number;
	// Where it starts inside the image's border box, and how wide and high that one is.
	readonly insetLeft: number;
	readonly insetTop: number;
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly fit: Fit;
	readonly radius: string;
}

// How far the canvas is from the image's content box.
interface Off {
	readonly left: number;
	readonly top: number;
}

export interface ForkShownEmojiListeners {
	// How large the emoji is really drawn, to ask for frames of that size.
	onDevicePixels?(devicePixels: number): void;
	// The canvas could not be kept on the image; the caller hides it and leaves the image alone.
	onLost?(): void;
}

interface PlayerInstance {
	readonly img: HTMLImageElement;
	readonly canvas: HTMLCanvasElement;
	readonly context: CanvasRenderingContext2D;
	readonly frames: ForkEmojiFrames;
	readonly listeners: ForkShownEmojiListeners;
	readonly anchor: Element | null;
	// The frame on the canvas, or -1 when it has to be drawn again.
	frame: number;
	// Whether the canvas has shown a frame, and upstream's <img> is hidden for it.
	synced: boolean;
	// Whether anyone could see the emoji. Only then is it drawn, and only then does it hold its clock.
	visible: boolean;
	// The image's box as last measured, which the canvas has the size of; null until the first time.
	box: ImageBox | null;
	marginLeft: number;
	marginTop: number;
	// Moves in a row that did not bring the canvas onto the image.
	misses: number;
}

export interface ForkSyncedEmojiPlayerEnvironment {
	now(): number;
	requestFrame(callback: (now: number) => void): number;
	cancelFrame(handle: number): void;
	setTimer(callback: () => void, ms: number): unknown;
	clearTimer(handle: unknown): void;
	observeSize(callback: ResizeObserverCallback): Pick<ResizeObserver, 'observe' | 'unobserve'>;
	devicePixelRatio(): number;
	// Makes the images marked as synced invisible, and the parents marked as anchors positioned;
	// false when the page cannot do that.
	hideSyncedImages(): boolean;
}

let syncedImagesHidden = false;

const BROWSER_ENVIRONMENT: ForkSyncedEmojiPlayerEnvironment = {
	now: () => performance.now(),
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (handle) => cancelAnimationFrame(handle),
	setTimer: (callback, ms) => setTimeout(callback, ms),
	clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	observeSize: (callback) => new ResizeObserver(callback),
	devicePixelRatio: () => window.devicePixelRatio || 1,
	hideSyncedImages: () => {
		if (syncedImagesHidden) return true;
		try {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(
				`img[${FORK_EMOJI_SYNCED_ATTRIBUTE}="${SYNCED_IN_THIS_PAGE_LOAD}"] { opacity: 0 !important; }` +
					`[${FORK_EMOJI_ANCHOR_ATTRIBUTE}="${SYNCED_IN_THIS_PAGE_LOAD}"] { position: relative; }`,
			);
			document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
			syncedImagesHidden = true;
		} catch {}
		return syncedImagesHidden;
	},
};

function devicePixelsAgree(devicePixels: ResizeObserverSize, width: number, height: number): boolean {
	return Math.abs(devicePixels.inlineSize - width) <= 1 && Math.abs(devicePixels.blockSize - height) <= 1;
}

function cssPixels(value: string | undefined, fallback = 0): number {
	const parsed = Number.parseFloat(value ?? '');
	return Number.isFinite(parsed) ? parsed : fallback;
}

function isSet(value: string | undefined, unset: string): boolean {
	return typeof value === 'string' && value !== '' && value !== unset;
}

function isInPlace(off: Off): boolean {
	return Math.abs(off.left) <= PLACEMENT_TOLERANCE && Math.abs(off.top) <= PLACEMENT_TOLERANCE;
}

function establishesContainingBlock(style: CSSStyleDeclaration): boolean {
	return (
		isSet(style.position, 'static') ||
		isSet(style.transform, 'none') ||
		isSet(style.perspective, 'none') ||
		isSet(style.filter, 'none') ||
		/layout|paint|strict|content/.test(style.contain ?? '') ||
		/size/.test(style.containerType ?? '') ||
		/transform|perspective|filter/.test(style.willChange ?? '')
	);
}

const staysWithImage = new WeakMap<Element, boolean>();

// Whether a canvas put next to `img` scrolls and is cut off with it. An out-of-flow box belongs to
// the nearest ancestor that is positioned (or transformed, or contained); if a box that scrolls or
// clips its content comes before that one, the canvas would stay behind when the image scrolls away.
export function forkEmojiCanvasStaysWithImage(img: HTMLImageElement): boolean {
	const parent = img.parentElement;
	if (!parent) return false;
	const known = staysWithImage.get(parent);
	if (known !== undefined) return known;
	let stays = true;
	for (let element: Element | null = parent; element && element !== document.documentElement; ) {
		const style = getComputedStyle(element);
		// An element with `display: contents` has no box: it neither holds the canvas nor clips it.
		if (style.display !== 'contents') {
			if (establishesContainingBlock(style)) break;
			if (isSet(style.overflowX, 'visible') || isSet(style.overflowY, 'visible')) {
				stays = false;
				break;
			}
		}
		element = element.parentElement;
	}
	staysWithImage.set(parent, stays);
	return stays;
}

// The nearest ancestor of `img` that has a box, to become what the canvas belongs to.
function boxAround(img: HTMLImageElement): Element | null {
	let element = img.parentElement;
	while (element && getComputedStyle(element).display === 'contents') {
		element = element.parentElement;
	}
	return element;
}

export interface ForkShownEmoji {
	readonly canvas: HTMLCanvasElement;
	// Takes over the image's classes again, after upstream changed them.
	restyle(): void;
	hide(): void;
}

// Upstream fades, dims and greys emoji through the image's classes (a status emoji that only shows
// while its row is hovered, a reaction pill that is off). The image is invisible while its canvas
// shows, so the canvas wears the same classes and the same rules style it, transitions included.
function dress(img: HTMLImageElement, canvas: HTMLCanvasElement): void {
	if (canvas.className !== img.className) canvas.className = img.className;
	canvas.style.opacity = img.style.opacity;
	canvas.style.filter = img.style.filter;
}

export class ForkSyncedEmojiPlayer {
	private readonly instances = new Map<Element, PlayerInstance>();
	private readonly byCanvas = new Map<Element, PlayerInstance>();
	private readonly clocks = new ForkSyncedEmojiClocks();
	// How many canvases each anchor holds.
	private readonly anchors = new WeakMap<Element, number>();
	private sizes: Pick<ResizeObserver, 'observe' | 'unobserve'> | null = null;
	private frameHandle: number | null = null;
	private timerHandle: unknown = null;
	private lookedAt = Number.NEGATIVE_INFINITY;
	private pixelRatio: number | null = null;

	constructor(private readonly environment: ForkSyncedEmojiPlayerEnvironment = BROWSER_ENVIRONMENT) {}

	// Shows `frames` in place of `img`, on a canvas put right after it, until `hide` is called; null
	// where that cannot be done, and the <img> is left alone. An emoji that can be seen holds its
	// clock for as long as it is shown, so that one replacing another in the same moment does not
	// restart it; only emoji near the viewport are shown.
	show(img: HTMLImageElement, frames: ForkEmojiFrames, listeners: ForkShownEmojiListeners = {}): ForkShownEmoji | null {
		if (
			img.ownerDocument !== document ||
			!img.parentNode ||
			frames.frames.length === 0 ||
			this.instances.has(img) ||
			!this.environment.hideSyncedImages()
		) {
			return null;
		}
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) return null;
		canvas.width = 0;
		canvas.height = 0;
		canvas.setAttribute(FORK_EMOJI_CANVAS_ATTRIBUTE, '');
		canvas.setAttribute('aria-hidden', 'true');
		canvas.style.cssText = CANVAS_STYLE;
		dress(img, canvas);
		// Where the canvas would not scroll with the image, the box around the image becomes what it
		// belongs to.
		const anchor = forkEmojiCanvasStaysWithImage(img) ? null : boxAround(img);
		if (anchor) {
			anchor.setAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE, SYNCED_IN_THIS_PAGE_LOAD);
			this.anchors.set(anchor, (this.anchors.get(anchor) ?? 0) + 1);
		}
		img.after(canvas);
		const instance: PlayerInstance = {
			img,
			canvas,
			context,
			frames,
			listeners,
			anchor,
			frame: -1,
			synced: false,
			visible: true,
			box: null,
			marginLeft: 0,
			marginTop: 0,
			misses: 0,
		};
		this.instances.set(img, instance);
		this.byCanvas.set(canvas, instance);
		this.clocks.show(frames.timeline.loopKey);
		// The first sizes arrive before the page is next painted: the canvas is placed and drawn then,
		// together with every other emoji that appeared in the same moment.
		this.sizes ??= this.environment.observeSize(this.handleSizes);
		this.sizes.observe(img);
		try {
			this.sizes.observe(canvas, {box: 'device-pixel-content-box'});
		} catch {
			this.sizes.observe(canvas);
		}
		this.wake();
		return {
			canvas,
			restyle: () => dress(img, canvas),
			hide: () => this.hide(instance),
		};
	}

	private hide(instance: PlayerInstance): void {
		const {img, canvas, anchor} = instance;
		if (this.instances.get(img) !== instance) return;
		this.instances.delete(img);
		this.byCanvas.delete(canvas);
		this.sizes?.unobserve(img);
		this.sizes?.unobserve(canvas);
		if (instance.visible) this.clocks.hide(instance.frames.timeline.loopKey);
		img.removeAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE);
		canvas.remove();
		if (anchor) {
			const held = (this.anchors.get(anchor) ?? 1) - 1;
			if (held > 0) {
				this.anchors.set(anchor, held);
			} else {
				this.anchors.delete(anchor);
				anchor.removeAttribute(FORK_EMOJI_ANCHOR_ATTRIBUTE);
			}
		}
		this.wake();
	}

	private readonly handleSizes = (entries: Array<ResizeObserverEntry>): void => {
		const now = this.environment.now();
		const moved: Array<PlayerInstance> = [];
		for (const entry of entries) {
			const instance = this.instances.get(entry.target);
			if (instance) moved.push(instance);
		}
		this.placeAll(moved);
		for (const entry of entries) {
			const instance = this.byCanvas.get(entry.target);
			if (!instance) continue;
			this.resize(instance, entry.devicePixelContentBoxSize?.[0] ?? null);
			this.see(instance);
			this.draw(instance, now);
			instance.listeners.onDevicePixels?.(Math.max(instance.canvas.width, instance.canvas.height));
		}
	};

	// Gives each canvas the size of its image and moves it onto the image. Everything is measured for
	// all of them before anything is changed, so that the page is laid out once per step and not once
	// per emoji: sizes first (where a canvas starts out can depend on its size), then places, then a
	// second look at the canvases that moved, to see that they arrived.
	private placeAll(instances: ReadonlyArray<PlayerInstance>): void {
		const boxes = instances.map((instance) => this.measureBox(instance));
		const sized: Array<PlayerInstance> = [];
		instances.forEach((instance, index) => {
			const box = boxes[index];
			if (!box) return;
			this.size(instance, box);
			sized.push(instance);
		});
		const offs = sized.map((instance) => this.measureOff(instance));
		const moved = sized.filter((instance, index) => {
			const off = offs[index];
			return off !== null && this.move(instance, off);
		});
		if (moved.length === 0) return;
		const offsAfter = moved.map((instance) => this.measureOff(instance));
		const lost: Array<PlayerInstance> = [];
		moved.forEach((instance, index) => {
			const off = offsAfter[index];
			if (!off || isInPlace(off)) return;
			instance.misses += 1;
			if (instance.misses >= MOVES_BEFORE_GIVING_UP) {
				lost.push(instance);
			} else {
				this.move(instance, off);
			}
		});
		for (const instance of lost) {
			if (instance.listeners.onLost) {
				instance.listeners.onLost();
			} else {
				this.hide(instance);
			}
		}
	}

	// The image's content box; null while the image has none. Measured, not styled: the image keeps
	// upstream's classes, and with them a size, margins and an alignment that nothing here knows about.
	private measureBox(instance: PlayerInstance): ImageBox | null {
		const {img} = instance;
		const style = getComputedStyle(img);
		const insetLeft = cssPixels(style.borderLeftWidth) + cssPixels(style.paddingLeft);
		const insetTop = cssPixels(style.borderTopWidth) + cssPixels(style.paddingTop);
		const insetX = insetLeft + cssPixels(style.borderRightWidth) + cssPixels(style.paddingRight);
		const insetY = insetTop + cssPixels(style.borderBottomWidth) + cssPixels(style.paddingBottom);
		const borderBox = style.boxSizing === 'border-box';
		const outerWidth = cssPixels(style.width, img.clientWidth) + (borderBox ? 0 : insetX);
		const outerHeight = cssPixels(style.height, img.clientHeight) + (borderBox ? 0 : insetY);
		if (!(outerWidth > 0 && outerHeight > 0)) return null;
		return {
			width: Math.max(0, outerWidth - insetX),
			height: Math.max(0, outerHeight - insetY),
			insetLeft,
			insetTop,
			outerWidth,
			outerHeight,
			fit: (style.objectFit || 'fill') as Fit,
			radius: style.borderRadius || '',
		};
	}

	private size(instance: PlayerInstance, box: ImageBox): void {
		const {canvas} = instance;
		if (instance.box && instance.box.fit !== box.fit) {
			instance.frame = -1;
		}
		instance.box = box;
		canvas.style.width = `${box.width}px`;
		canvas.style.height = `${box.height}px`;
		canvas.style.borderRadius = box.radius;
	}

	// How far the canvas is from its image's content box, in CSS pixels; null while that cannot be told.
	private measureOff(instance: PlayerInstance): Off | null {
		const {box} = instance;
		if (!box) return null;
		const imgBox = instance.img.getBoundingClientRect();
		const canvasBox = instance.canvas.getBoundingClientRect();
		// An ancestor that is being scaled (a reaction popping in) scales both boxes alike.
		const scaleX = imgBox.width / box.outerWidth;
		const scaleY = imgBox.height / box.outerHeight;
		if (!(scaleX > 0 && scaleY > 0)) return null;
		return {
			left: (imgBox.left - canvasBox.left) / scaleX + box.insetLeft,
			top: (imgBox.top - canvasBox.top) / scaleY + box.insetTop,
		};
	}

	// Moves the canvas by what it is off; false if it is where it belongs. The margin on the far side
	// is the opposite of the one on the near side. That moves the canvas by exactly the margin
	// wherever it starts out: where text runs right to left it starts out from its right edge, and the
	// right margin is the one that counts; where the parent centres its content it is centred with
	// its margins, and two that cancel out leave that centre where it was.
	private move(instance: PlayerInstance, off: Off): boolean {
		if (isInPlace(off)) return false;
		const {canvas} = instance;
		instance.marginLeft += off.left;
		instance.marginTop += off.top;
		canvas.style.marginLeft = `${instance.marginLeft}px`;
		canvas.style.marginRight = `${-instance.marginLeft}px`;
		canvas.style.marginTop = `${instance.marginTop}px`;
		canvas.style.marginBottom = `${-instance.marginTop}px`;
		return true;
	}

	// Gives the canvas one pixel of its own for every device pixel it covers.
	private resize(instance: PlayerInstance, devicePixels: ResizeObserverSize | null): void {
		const {canvas, context} = instance;
		const ratio = this.environment.devicePixelRatio();
		const scaledWidth = cssPixels(canvas.style.width) * ratio;
		const scaledHeight = cssPixels(canvas.style.height) * ratio;
		// The observer's count is exact where the box does not end on a whole pixel. Under device
		// emulation (DevTools, headless tests) Chromium gives it in CSS pixels, so it is taken only when
		// it agrees with the page's pixel ratio, by the box's own size or (inside a CSS `zoom`) by the
		// size it has on screen.
		const exact =
			devicePixels !== null &&
			(devicePixelsAgree(devicePixels, scaledWidth, scaledHeight) ||
				devicePixelsAgree(
					devicePixels,
					canvas.getBoundingClientRect().width * ratio,
					canvas.getBoundingClientRect().height * ratio,
				))
				? devicePixels
				: null;
		const width = Math.round(exact?.inlineSize ?? scaledWidth);
		const height = Math.round(exact?.blockSize ?? scaledHeight);
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
			instance.frame = -1;
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
	}

	// Finds out whether the emoji can be seen: not while it, or anything around it, is fully
	// transparent, hidden or not rendered. One that cannot is given back to upstream as it is (its
	// <img> shows whatever upstream makes of it) and lets go of its clock.
	private see(instance: PlayerInstance): void {
		const {canvas, img} = instance;
		const visible =
			typeof canvas.checkVisibility === 'function'
				? canvas.checkVisibility({opacityProperty: true, visibilityProperty: true})
				: true;
		if (visible === instance.visible) return;
		instance.visible = visible;
		const {loopKey} = instance.frames.timeline;
		if (visible) {
			this.clocks.show(loopKey);
			return;
		}
		this.clocks.hide(loopKey);
		instance.frame = -1;
		if (instance.synced) {
			instance.synced = false;
			img.removeAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE);
			instance.context.clearRect(0, 0, canvas.width, canvas.height);
		}
	}

	// What can change without anything telling: whether each emoji can be seen, and the screen's pixel
	// ratio where no observer reports device pixels.
	private look(): void {
		for (const instance of this.instances.values()) {
			this.see(instance);
		}
		const ratio = this.environment.devicePixelRatio();
		if (this.pixelRatio !== null && this.pixelRatio !== ratio) {
			for (const instance of this.instances.values()) {
				this.resize(instance, null);
			}
		}
		this.pixelRatio = ratio;
	}

	private draw(instance: PlayerInstance, now: number): void {
		const {canvas, context, img, box} = instance;
		if (!instance.visible || !box || canvas.width === 0 || canvas.height === 0) return;
		const {timeline, frames} = instance.frames;
		const frame = forkEmojiFrameAt(timeline, this.clocks.elapsedAt(timeline.loopKey, now));
		if (frame === instance.frame) return;
		const bitmap = frames[Math.min(frame, frames.length - 1)];
		if (bitmap.width === 0 || bitmap.height === 0) return;
		// The whole frame, centred, at the size upstream's `object-fit` gives the image.
		const fill = [canvas.width / bitmap.width, canvas.height / bitmap.height];
		const natural = img.naturalWidth > 0 ? img.naturalWidth / bitmap.width : 1;
		const unscaled = (natural * canvas.width) / (box.width || canvas.width);
		let scaleX = fill[0];
		let scaleY = fill[1];
		if (box.fit === 'contain') scaleX = scaleY = Math.min(...fill);
		else if (box.fit === 'cover') scaleX = scaleY = Math.max(...fill);
		else if (box.fit === 'none') scaleX = scaleY = unscaled;
		else if (box.fit === 'scale-down') scaleX = scaleY = Math.min(unscaled, ...fill);
		const width = Math.max(1, Math.round(bitmap.width * scaleX));
		const height = Math.max(1, Math.round(bitmap.height * scaleY));
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(
			bitmap,
			Math.round((canvas.width - width) / 2),
			Math.round((canvas.height - height) / 2),
			width,
			height,
		);
		instance.frame = frame;
		if (!instance.synced) {
			instance.synced = true;
			img.setAttribute(FORK_EMOJI_SYNCED_ATTRIBUTE, SYNCED_IN_THIS_PAGE_LOAD);
		}
	}

	// Runs a tick at the next animation frame: an emoji was shown or hidden.
	private wake(): void {
		if (this.timerHandle !== null) {
			this.environment.clearTimer(this.timerHandle);
			this.timerHandle = null;
		}
		if (this.frameHandle === null) {
			this.frameHandle = this.environment.requestFrame(this.tick);
		}
	}

	private readonly tick = (now: number): void => {
		this.frameHandle = null;
		if (now - this.lookedAt >= LOOK_AGAIN_AFTER_MS) {
			this.lookedAt = now;
			this.look();
		}
		// The page may have been laid out again without any image changing size (text before an emoji
		// wrapped, a neighbour grew): canvases that no longer lie on their image are put back first.
		const astray: Array<PlayerInstance> = [];
		for (const instance of this.instances.values()) {
			if (!instance.visible) continue;
			const off = this.measureOff(instance);
			if (!off) continue;
			if (isInPlace(off)) {
				instance.misses = 0;
			} else {
				astray.push(instance);
			}
		}
		this.placeAll(astray);
		let nextFrameInMs = Number.POSITIVE_INFINITY;
		for (const instance of this.instances.values()) {
			if (!instance.visible) continue;
			this.draw(instance, now);
			const {timeline} = instance.frames;
			const frameInMs = forkEmojiMsToNextFrame(timeline, this.clocks.elapsedAt(timeline.loopKey, now));
			if (frameInMs < nextFrameInMs) nextFrameInMs = frameInMs;
		}
		this.clocks.endOfFrame();
		if (this.instances.size === 0) return;
		if (nextFrameInMs <= WAKE_BEFORE_FRAME_MS) {
			this.frameHandle = this.environment.requestFrame(this.tick);
			return;
		}
		this.timerHandle = this.environment.setTimer(
			() => {
				this.timerHandle = null;
				this.frameHandle ??= this.environment.requestFrame(this.tick);
			},
			Math.min(nextFrameInMs - WAKE_BEFORE_FRAME_MS, LOOK_AGAIN_AFTER_MS),
		);
	};
}

export const forkSyncedEmojiPlayer = new ForkSyncedEmojiPlayer();
