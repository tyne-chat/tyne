// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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
			sso: {enabled: false, enforced: false, display_name: null, redirect_uri: ''},
			registration: {mode: 'open', admin_registration_urls_enabled: true},
			community: {single_community: false, single_community_guild_id: null, direct_messages_disabled: false},
			services: {gif_enabled: true, youtube_enabled: false, bluesky_enabled: false},
			limits: undefined,
			push: {public_vapid_key: null},
			app_public: {
				branding: {
					product_name: 'Fluxer',
					icon_url: null,
					symbol_url: null,
					logo_url: null,
					wordmark_url: null,
					favicon_url: null,
					theme_color: null,
				},
				setup: {configured: true, admin_url: null},
				legal: {terms_url: null, privacy_url: null},
				registration: {collect_date_of_birth: true},
			},
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

vi.mock('@lingui/core/macro', () => ({
	defineMessage: (str: any) => str,
	msg: (str: any) => str,
	plural: (val: any) => val,
}));

vi.mock('@lingui/react/macro', () => ({
	Trans: ({children}: any) => children,
	useLingui: () => ({i18n: {t: (str: any) => str}}),
}));

import {
	resolveShouldAnimateDecision,
	type ShouldAnimateDecisionInput,
	useShouldAnimate,
} from '@app/features/app/hooks/useShouldAnimate';
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('resolveShouldAnimateDecision', () => {
	const baseInput: ShouldAnimateDecisionInput = {
		isAnimated: true,
		allowance: 'ALWAYS',
		reducedMotion: false,
		keptUnderReducedMotion: false,
		isInteracting: false,
		entitlementOk: true,
		saveData: false,
		animatedMediaPlaybackAllowed: true,
	};

	describe('when animatedMediaPlaybackAllowed is false (window unfocused & stayInteractiveWhenUnfocused is false)', () => {
		it('returns false for allowance ALWAYS (e.g. emojis, GIFs)', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'ALWAYS',
					animatedMediaPlaybackAllowed: false,
				}),
			).toBe(false);
		});

		it('returns false for allowance ON_INTERACTION even when interacting (hovered/focused)', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'ON_INTERACTION',
					isInteracting: true,
					animatedMediaPlaybackAllowed: false,
				}),
			).toBe(false);
		});

		it('returns false for allowance ON_INTERACTION when not interacting', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'ON_INTERACTION',
					isInteracting: false,
					animatedMediaPlaybackAllowed: false,
				}),
			).toBe(false);
		});

		it('returns false for allowance NEVER', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'NEVER',
					animatedMediaPlaybackAllowed: false,
				}),
			).toBe(false);
		});
	});

	describe('when animatedMediaPlaybackAllowed is true (window focused or stayInteractiveWhenUnfocused is true)', () => {
		it('returns true for allowance ALWAYS', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'ALWAYS',
					animatedMediaPlaybackAllowed: true,
				}),
			).toBe(true);
		});

		it('returns true for allowance ON_INTERACTION when interacting', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'ON_INTERACTION',
					isInteracting: true,
					animatedMediaPlaybackAllowed: true,
				}),
			).toBe(true);
		});

		it('returns false for allowance ON_INTERACTION when not interacting', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'ON_INTERACTION',
					isInteracting: false,
					animatedMediaPlaybackAllowed: true,
				}),
			).toBe(false);
		});

		it('returns false for allowance NEVER', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					allowance: 'NEVER',
					animatedMediaPlaybackAllowed: true,
				}),
			).toBe(false);
		});
	});

	describe('defaults and standard overrides', () => {
		it('defaults animatedMediaPlaybackAllowed to true if omitted', () => {
			const {animatedMediaPlaybackAllowed, ...withoutPlayback} = baseInput;
			expect(resolveShouldAnimateDecision(withoutPlayback)).toBe(true);
		});

		it('returns false when isAnimated is false regardless of focus', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					isAnimated: false,
					animatedMediaPlaybackAllowed: true,
				}),
			).toBe(false);
		});

		it('returns false when saveData is true', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					saveData: true,
					animatedMediaPlaybackAllowed: true,
				}),
			).toBe(false);
		});

		it('returns false when entitlementOk is false', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					entitlementOk: false,
					animatedMediaPlaybackAllowed: true,
				}),
			).toBe(false);
		});

		it('respects reduced motion when not kept under reduced motion', () => {
			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					reducedMotion: true,
					keptUnderReducedMotion: false,
					isInteracting: false,
				}),
			).toBe(false);

			expect(
				resolveShouldAnimateDecision({
					...baseInput,
					reducedMotion: true,
					keptUnderReducedMotion: false,
					isInteracting: true,
				}),
			).toBe(true);
		});
	});
});

describe('useShouldAnimate hook', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
	});

	function renderHook(props: Parameters<typeof useShouldAnimate>[0]): {getValue: () => boolean} {
		let latestValue = false;
		function TestComponent(currentProps: typeof props) {
			latestValue = useShouldAnimate(currentProps);
			return null;
		}
		act(() => {
			root.render(createElement(TestComponent, props));
		});
		return {
			getValue: () => latestValue,
		};
	}

	it('returns false when animatedMediaPlaybackAllowed is explicitly false', () => {
		const result = renderHook({
			kind: 'emoji',
			animatedMediaPlaybackAllowed: false,
		});
		expect(result.getValue()).toBe(false);
	});

	it('returns true when animatedMediaPlaybackAllowed is explicitly true for emoji', () => {
		const result = renderHook({
			kind: 'emoji',
			animatedMediaPlaybackAllowed: true,
		});
		expect(result.getValue()).toBe(true);
	});

	it('returns false for avatar when not hovering even if playback is allowed', () => {
		const result = renderHook({
			kind: 'avatar',
			isHovering: false,
			animatedMediaPlaybackAllowed: true,
		});
		expect(result.getValue()).toBe(false);
	});

	it('returns true for avatar when hovering and playback is allowed', () => {
		const result = renderHook({
			kind: 'avatar',
			isHovering: true,
			animatedMediaPlaybackAllowed: true,
		});
		expect(result.getValue()).toBe(true);
	});

	it('returns false for avatar when hovering if playback is not allowed', () => {
		const result = renderHook({
			kind: 'avatar',
			isHovering: true,
			animatedMediaPlaybackAllowed: false,
		});
		expect(result.getValue()).toBe(false);
	});

	describe('live focus and unfocused-fully-interactive reactivity', () => {
		it('reacts to window blur and focus events', () => {
			let hasFocus = true;
			const origHasFocus = document.hasFocus;
			document.hasFocus = () => hasFocus;

			try {
				const result = renderHook({kind: 'emoji'});
				expect(result.getValue()).toBe(true);

				// Window blurs
				act(() => {
					hasFocus = false;
					window.dispatchEvent(new Event('blur'));
				});
				expect(result.getValue()).toBe(false);

				// Window regains focus
				act(() => {
					hasFocus = true;
					window.dispatchEvent(new Event('focus'));
				});
				expect(result.getValue()).toBe(true);
			} finally {
				document.hasFocus = origHasFocus;
			}
		});

		it('allows animation when unfocused if unfocused-fully-interactive class is set', async () => {
			const hasFocus = false;
			const origHasFocus = document.hasFocus;
			document.hasFocus = () => hasFocus;

			try {
				const result = renderHook({kind: 'emoji'});
				// Initially blurred with no class: animation paused
				expect(result.getValue()).toBe(false);

				// User enables "Stay fully interactive when unfocused"
				await act(async () => {
					document.documentElement.classList.add('unfocused-fully-interactive');
					window.dispatchEvent(new Event('fluxer-window-hover-controls-change'));
				});
				expect(result.getValue()).toBe(true);

				// User disables "Stay fully interactive when unfocused"
				await act(async () => {
					document.documentElement.classList.remove('unfocused-fully-interactive');
					window.dispatchEvent(new Event('fluxer-window-hover-controls-change'));
				});
				expect(result.getValue()).toBe(false);
			} finally {
				document.documentElement.classList.remove('unfocused-fully-interactive');
				document.hasFocus = origHasFocus;
			}
		});
	});
});
