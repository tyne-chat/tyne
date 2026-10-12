// SPDX-License-Identifier: AGPL-3.0-or-later

export const NATIVE_TITLEBAR_CONTROL_ATTR = 'data-window-control';

export type NativeTitlebarControlName = 'minimize' | 'maximize' | 'close';
export type NativeTitlebarLayout = 'macos' | 'controls';

export const NATIVE_TITLEBAR_CLASS = {
	root: 'fluxer-native-titlebar',
	left: 'fluxer-native-titlebar__left',
	wordmark: 'fluxer-native-titlebar__wordmark',
	spacer: 'fluxer-native-titlebar__spacer',
	controls: 'fluxer-native-titlebar__controls',
	control: 'fluxer-native-titlebar__control',
	controlClose: 'fluxer-native-titlebar__control--close',
} as const;

// Fork: the wordmark is Tyne's. Its box and outline are written by tyne-tools
// scripts/install_icon_kit.py; edit them there.
export const NATIVE_TITLEBAR_WORDMARK_VIEWBOX = '0 0 771 338';

export const NATIVE_TITLEBAR_WORDMARK_PATHS: ReadonlyArray<string> = [
	'M118.19 49.91V258H70.92V49.91H0V8H189.11V49.91ZM327.72 71.04H370.7L295.49 291.31Q291.91 301.34 287.43 308.68Q282.95 316.02 276.86 320.68Q270.77 325.34 262.18 327.48Q253.58 329.63 242.12 329.63H214.54V293.1H248.21L256.81 266.95L189.83 71.04H235.32L267.91 169.89L280.09 217.17H282.23L295.13 169.89ZM400.79 258V71.04H446.63V102.2H448.42Q454.15 87.15 466.51 76.95Q478.87 66.74 500.72 66.74Q529.73 66.74 545.13 85.72Q560.53 104.7 560.53 139.81V258H514.68V144.46Q514.68 124.4 507.52 114.38Q500.36 104.35 483.88 104.35Q476.72 104.35 470.09 106.32Q463.47 108.29 458.27 112.05Q453.08 115.81 449.86 121.36Q446.63 126.91 446.63 134.43V258ZM686.96 262.3Q666.19 262.3 649.89 255.31Q633.6 248.33 622.31 235.61Q611.03 222.9 604.94 204.81Q598.85 186.72 598.85 164.16Q598.85 141.95 604.76 124.05Q610.67 106.14 621.78 93.42Q632.88 80.71 649 73.72Q665.11 66.74 685.53 66.74Q707.38 66.74 723.5 74.26Q739.61 81.78 750 94.68Q760.39 107.57 765.58 124.58Q770.77 141.6 770.77 160.94V175.98H646.49V180.64Q646.49 201.05 657.95 213.41Q669.41 225.77 691.98 225.77Q709.17 225.77 720.09 218.6Q731.02 211.44 739.61 200.34L764.33 227.91Q752.87 244.03 732.99 253.16Q713.11 262.3 686.96 262.3ZM686.25 101.12Q667.98 101.12 657.23 113.3Q646.49 125.48 646.49 144.82V147.68H723.14V144.46Q723.14 125.12 713.65 113.12Q704.15 101.12 686.25 101.12Z',
];

export const NATIVE_TITLEBAR_CONTROL_ICON_PATH = {
	minimize: 'M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z',
	maximize:
		'M208,28H48A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V48A20,20,0,0,0,208,28Zm-4,176H52V52H204Z',
	restore:
		'M180,64H40A12,12,0,0,0,28,76V216a12,12,0,0,0,12,12H180a12,12,0,0,0,12-12V76A12,12,0,0,0,180,64ZM168,204H52V88H168ZM228,40V180a12,12,0,0,1-24,0V52H76a12,12,0,0,1,0-24H216A12,12,0,0,1,228,40Z',
	close:
		'M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z',
} as const;

export type NativeTitlebarControlIconName = keyof typeof NATIVE_TITLEBAR_CONTROL_ICON_PATH;

export function nativeTitlebarControlIconSvg(icon: NativeTitlebarControlIconName): string {
	return (
		'<svg viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
		`<path d="${NATIVE_TITLEBAR_CONTROL_ICON_PATH[icon]}"/></svg>`
	);
}

export function nativeTitlebarWordmarkSvg(className: string = NATIVE_TITLEBAR_CLASS.wordmark): string {
	const paths = NATIVE_TITLEBAR_WORDMARK_PATHS.map((d) => `<path fill="currentColor" d="${d}"/>`).join('');
	return (
		`<svg class="${className}" role="img" aria-label="Tyne" xmlns="http://www.w3.org/2000/svg" ` +
		`fill="none" viewBox="${NATIVE_TITLEBAR_WORDMARK_VIEWBOX}">${paths}</svg>`
	);
}

interface StartupControlLabels {
	readonly minimize: string;
	readonly maximize: string;
	readonly close: string;
}

const DEFAULT_STARTUP_CONTROL_LABELS: StartupControlLabels = {
	minimize: 'Minimize window',
	maximize: 'Maximize window',
	close: 'Close window',
};

function controlButtonHtml(
	name: NativeTitlebarControlName,
	icon: NativeTitlebarControlIconName,
	label: string,
	extraClass?: string,
): string {
	const className = extraClass ? `${NATIVE_TITLEBAR_CLASS.control} ${extraClass}` : NATIVE_TITLEBAR_CLASS.control;
	return (
		`<button type="button" tabindex="-1" class="${className}" ${NATIVE_TITLEBAR_CONTROL_ATTR}="${name}" ` +
		`aria-label="${label}">${nativeTitlebarControlIconSvg(icon)}</button>`
	);
}

export function nativeTitlebarControlsHtml(labels: StartupControlLabels = DEFAULT_STARTUP_CONTROL_LABELS): string {
	return (
		`<div class="${NATIVE_TITLEBAR_CLASS.controls}">` +
		controlButtonHtml('minimize', 'minimize', labels.minimize) +
		controlButtonHtml('maximize', 'maximize', labels.maximize) +
		controlButtonHtml('close', 'close', labels.close, NATIVE_TITLEBAR_CLASS.controlClose) +
		'</div>'
	);
}

export function buildNativeTitlebarStartupHtml(layout: NativeTitlebarLayout): string {
	const brand = `<div class="${NATIVE_TITLEBAR_CLASS.left}">${nativeTitlebarWordmarkSvg()}</div>`;
	const spacer = `<div class="${NATIVE_TITLEBAR_CLASS.spacer}"></div>`;
	if (layout === 'macos') {
		return `${spacer}${brand}`;
	}
	return `${brand}${spacer}${nativeTitlebarControlsHtml()}`;
}
