// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {describe, expect, it, vi} from 'vitest';

vi.hoisted(() => {
	const HARNESS_ENDPOINT = 'https://primary.test/api';
	const host = globalThis as unknown as {window?: Record<string, unknown>};
	if (typeof host.window === 'undefined') {
		host.window = host as unknown as Record<string, unknown>;
	}
	host.window.__FLUXER_BOOTSTRAP__ = {
		config: {
			releaseChannel: 'stable',
			bootstrapApiEndpoint: HARNESS_ENDPOINT,
			bootstrapApiPublicEndpoint: HARNESS_ENDPOINT,
		},
		instance: {
			api_code_version: Number.MAX_SAFE_INTEGER,
			endpoints: {
				api: HARNESS_ENDPOINT,
				api_client: HARNESS_ENDPOINT,
				api_public: HARNESS_ENDPOINT,
				gateway: 'wss://gateway.primary.test',
				media: 'https://media.primary.test',
				static_cdn: 'https://cdn.primary.test',
				marketing: 'https://primary.test',
				admin: 'https://admin.primary.test',
				invite: 'https://primary.test/invite',
				gift: 'https://primary.test/gift',
				webapp: 'https://app.primary.test',
				upload_relay: 'https://upload.primary.test',
			},
			captcha: {provider: 'none', hcaptcha_site_key: null, turnstile_site_key: null},
			features: {
				voice_enabled: false,
				stripe_enabled: false,
				self_hosted: false,
				presigned_attachment_uploads: false,
				emails_enabled: false,
			},
			gif: {provider: 'klipy', display_name: 'Klipy', attribution_required: false},
		},
		geoip: {
			countryCode: null,
			regionCode: null,
			latitude: null,
			longitude: null,
			ageRestrictedGeos: [],
			ageBlockedGeos: [],
		},
	};
});

vi.mock('@app/features/app/state/RuntimeConfig', () => ({
	default: {
		localInstanceDomain: 'local',
		isSelfHosted: () => false,
		inviteUrlBase: 'https://invite.test',
	},
}));
vi.mock('@app/features/lexical/composer/nodes/ComposerTimestampPill', () => ({
	ComposerTimestampPill: () => null,
}));
vi.mock('@lingui/core/macro', () => {
	const descriptor = (value: unknown): unknown => (typeof value === 'string' ? {message: value} : value);
	return {msg: descriptor, t: descriptor, plural: () => '', select: () => '', selectOrdinal: () => ''};
});
vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: {children?: unknown}) => children,
	useLingui: () => ({
		i18n: {
			_: (descriptor: {message?: string}) => descriptor?.message ?? '',
			locale: 'en-US',
		},
	}),
}));

import {
	$hydrateComposerFromDraft,
	$projectComposer,
	isValidComposerSegment,
} from '@app/features/lexical/composer/ComposerSerialization';
import {registerComposerTimestampTransform} from '@app/features/lexical/composer/ComposerTimestampTransform';
import {$replaceComposerRange} from '@app/features/lexical/composer/composerOffsets';
import {
	$createComposerTimestampNode,
	$isComposerTimestampNode,
	ComposerTimestampNode,
} from '@app/features/lexical/composer/nodes/ComposerTimestampNode';
import {
	getTimestampWire,
	normalizeTimestampFormat,
	parseTimestampWire,
	TIMESTAMP_COMBO_REGEX,
	TIMESTAMP_SINGLE_REGEX,
} from '@app/features/lexical/composer/nodes/ComposerTimestampUtils';
import type {MentionSegment} from '@app/features/messaging/utils/TextareaSegmentManager';
import {$getRoot, $isElementNode, createEditor} from 'lexical';

describe('ComposerTimestampUtils', () => {
	it('normalizes style letters and aliases correctly', () => {
		expect(normalizeTimestampFormat('combo')).toBe('combo');
		expect(normalizeTimestampFormat('f')).toBe('shortDateTime');
		expect(normalizeTimestampFormat('default')).toBe('shortDateTime');
		expect(normalizeTimestampFormat('R')).toBe('relative');
		expect(normalizeTimestampFormat('relative')).toBe('relative');
		expect(normalizeTimestampFormat('d')).toBe('shortDate');
		expect(normalizeTimestampFormat('D')).toBe('longDate');
		expect(normalizeTimestampFormat('t')).toBe('shortTime');
		expect(normalizeTimestampFormat('T')).toBe('longTime');
		expect(normalizeTimestampFormat('F')).toBe('longDateTime');
		expect(normalizeTimestampFormat('unknown')).toBe('shortDateTime');
	});

	it('formats wire representation correctly', () => {
		expect(getTimestampWire(1700000000, 'combo')).toBe('<t:1700000000:f> (<t:1700000000:R>)');
		expect(getTimestampWire(1700000000, 'shortDateTime')).toBe('<t:1700000000:f>');
		expect(getTimestampWire(1700000000, 'relative')).toBe('<t:1700000000:R>');
		expect(getTimestampWire(1700000000, 'shortDate')).toBe('<t:1700000000:d>');
	});

	it('parses wire representation correctly', () => {
		expect(parseTimestampWire('<t:1700000000:f> (<t:1700000000:R>)')).toEqual({
			epoch: 1700000000,
			format: 'combo',
		});
		expect(parseTimestampWire('<t:1700000000:R>')).toEqual({
			epoch: 1700000000,
			format: 'relative',
		});
		expect(parseTimestampWire('<t:1700000000>')).toEqual({
			epoch: 1700000000,
			format: 'shortDateTime',
		});
		expect(parseTimestampWire('invalid')).toBeNull();
	});

	it('matches combo regex strictly on matching epochs', () => {
		const comboMatch = '<t:1700000000:f> (<t:1700000000:R>)'.match(TIMESTAMP_COMBO_REGEX);
		expect(comboMatch).not.toBeNull();
		expect(comboMatch?.[1]).toBe('1700000000');

		// Mismatched epochs should not match combo regex
		const mismatched = '<t:1700000000:f> (<t:1800000000:R>)'.match(TIMESTAMP_COMBO_REGEX);
		expect(mismatched).toBeNull();
	});

	it('matches single timestamp regex', () => {
		const singleMatch = '<t:1700000000:d>'.match(TIMESTAMP_SINGLE_REGEX);
		expect(singleMatch).not.toBeNull();
		expect(singleMatch?.[1]).toBe('1700000000');
		expect(singleMatch?.[2]).toBe('d');
	});
});

describe('ComposerTimestampNode', () => {
	it('creates timestamp node with correct getters and properties', () => {
		const editor = createEditor({
			namespace: 'timestamp-test',
			nodes: [ComposerTimestampNode],
		});

		editor.update(() => {
			const node = $createComposerTimestampNode(1700000000, 'combo');
			expect($isComposerTimestampNode(node)).toBe(true);
			expect(node.getEpoch()).toBe(1700000000);
			expect(node.getFormat()).toBe('combo');
			expect(node.getWireText()).toBe('<t:1700000000:f> (<t:1700000000:R>)');
			expect(node.isInline()).toBe(true);

			node.setEpoch(1710000000);
			node.setFormat('relative');
			expect(node.getEpoch()).toBe(1710000000);
			expect(node.getFormat()).toBe('relative');
			expect(node.getWireText()).toBe('<t:1710000000:R>');
		});
	});

	it('projects timestamp to wire and creates valid segment', () => {
		const editor = createEditor({
			namespace: 'timestamp-project-test',
			nodes: [ComposerTimestampNode],
			onError: (err) => {
				throw err;
			},
		});

		editor.update(() => {
			$replaceComposerRange(
				0,
				0,
				{
					kind: 'timestamp',
					epoch: 1700000000,
					format: 'combo',
				},
				{leading: false, trailing: true},
			);

			const projection = $projectComposer();
			expect(projection.wire).toBe('<t:1700000000:f> (<t:1700000000:R>) ');
			expect(projection.segments).toHaveLength(1);

			const seg = projection.segments[0]!;
			expect(seg.type).toBe('special');
			expect(seg.id).toBe('timestamp:1700000000:combo');
			expect(seg.actualText).toBe('<t:1700000000:f> (<t:1700000000:R>)');
			expect(isValidComposerSegment(projection.display, seg)).toBe(true);
		});
	});

	it('hydrates timestamp from draft correctly', () => {
		const editor = createEditor({
			namespace: 'timestamp-hydrate-test',
			nodes: [ComposerTimestampNode],
			onError: (err) => {
				throw err;
			},
		});

		const displayText = 'Nov 14, 2023 10:13 PM (in 2 years)';
		const segment: MentionSegment = {
			type: 'special',
			id: 'timestamp:1700000000:combo',
			displayText,
			actualText: '<t:1700000000:f> (<t:1700000000:R>)',
			start: 0,
			end: displayText.length,
		};

		editor.update(() => {
			$hydrateComposerFromDraft(displayText, [segment]);
			const projection = $projectComposer();
			expect(projection.wire).toBe('<t:1700000000:f> (<t:1700000000:R>)');
		});
	});

	it('transforms raw single timestamp text into ComposerTimestampNode', () => {
		const editor = createEditor({
			namespace: 'timestamp-transform-test',
			nodes: [ComposerTimestampNode],
			onError: (err) => {
				throw err;
			},
		});

		const unregister = registerComposerTimestampTransform(editor);

		editor.update(
			() => {
				$hydrateComposerFromDraft('Meeting at <t:1700000000:t> please', []);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const paragraph = root.getFirstChild();
			if (!$isElementNode(paragraph)) {
				throw new Error('Expected paragraph');
			}
			const children = paragraph.getChildren();

			expect(children).toHaveLength(3);
			expect(children[0]?.getTextContent()).toBe('Meeting at ');
			expect($isComposerTimestampNode(children[1])).toBe(true);
			const timestampNode = children[1] as ComposerTimestampNode;
			expect(timestampNode.getEpoch()).toBe(1700000000);
			expect(timestampNode.getFormat()).toBe('shortTime');
			expect(children[2]?.getTextContent()).toBe(' please');
		});

		unregister();
	});

	it('transforms combo timestamp text into a SINGLE ComposerTimestampNode', () => {
		const editor = createEditor({
			namespace: 'combo-timestamp-transform-test',
			nodes: [ComposerTimestampNode],
			onError: (err) => {
				throw err;
			},
		});

		const unregister = registerComposerTimestampTransform(editor);

		editor.update(
			() => {
				$hydrateComposerFromDraft('Event: <t:1700000000:f> (<t:1700000000:R>) ready', []);
			},
			{discrete: true},
		);

		editor.getEditorState().read(() => {
			const root = $getRoot();
			const paragraph = root.getFirstChild();
			if (!$isElementNode(paragraph)) {
				throw new Error('Expected paragraph');
			}
			const children = paragraph.getChildren();

			expect(children).toHaveLength(3);
			expect(children[0]?.getTextContent()).toBe('Event: ');
			expect($isComposerTimestampNode(children[1])).toBe(true);
			const timestampNode = children[1] as ComposerTimestampNode;
			expect(timestampNode.getEpoch()).toBe(1700000000);
			expect(timestampNode.getFormat()).toBe('combo');
			expect(timestampNode.getWireText()).toBe('<t:1700000000:f> (<t:1700000000:R>)');
			expect(children[2]?.getTextContent()).toBe(' ready');
		});

		unregister();
	});
});
