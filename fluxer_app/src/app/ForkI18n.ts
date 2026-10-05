// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Messages} from '@lingui/core';

type LocaleLoader = () => Promise<{
	messages: Messages;
}>;

// Fork-only strings are compiled from src/features/i18n/fork_locales (see scripts/fork-i18n.mjs)
// and layered over the upstream catalogue of the same locale.
const forkLoaders: Record<string, LocaleLoader> = {
	ar: () => import('@app/features/i18n/fork_locales/ar/messages.mjs'),
	bg: () => import('@app/features/i18n/fork_locales/bg/messages.mjs'),
	cs: () => import('@app/features/i18n/fork_locales/cs/messages.mjs'),
	da: () => import('@app/features/i18n/fork_locales/da/messages.mjs'),
	de: () => import('@app/features/i18n/fork_locales/de/messages.mjs'),
	el: () => import('@app/features/i18n/fork_locales/el/messages.mjs'),
	'en-GB': () => import('@app/features/i18n/fork_locales/en-GB/messages.mjs'),
	'en-US': () => import('@app/features/i18n/fork_locales/en-US/messages.mjs'),
	'es-ES': () => import('@app/features/i18n/fork_locales/es-ES/messages.mjs'),
	'es-419': () => import('@app/features/i18n/fork_locales/es-419/messages.mjs'),
	fi: () => import('@app/features/i18n/fork_locales/fi/messages.mjs'),
	fr: () => import('@app/features/i18n/fork_locales/fr/messages.mjs'),
	he: () => import('@app/features/i18n/fork_locales/he/messages.mjs'),
	hi: () => import('@app/features/i18n/fork_locales/hi/messages.mjs'),
	hr: () => import('@app/features/i18n/fork_locales/hr/messages.mjs'),
	hu: () => import('@app/features/i18n/fork_locales/hu/messages.mjs'),
	id: () => import('@app/features/i18n/fork_locales/id/messages.mjs'),
	it: () => import('@app/features/i18n/fork_locales/it/messages.mjs'),
	ja: () => import('@app/features/i18n/fork_locales/ja/messages.mjs'),
	ko: () => import('@app/features/i18n/fork_locales/ko/messages.mjs'),
	lt: () => import('@app/features/i18n/fork_locales/lt/messages.mjs'),
	nl: () => import('@app/features/i18n/fork_locales/nl/messages.mjs'),
	no: () => import('@app/features/i18n/fork_locales/no/messages.mjs'),
	pl: () => import('@app/features/i18n/fork_locales/pl/messages.mjs'),
	'pt-BR': () => import('@app/features/i18n/fork_locales/pt-BR/messages.mjs'),
	ro: () => import('@app/features/i18n/fork_locales/ro/messages.mjs'),
	ru: () => import('@app/features/i18n/fork_locales/ru/messages.mjs'),
	'sv-SE': () => import('@app/features/i18n/fork_locales/sv-SE/messages.mjs'),
	th: () => import('@app/features/i18n/fork_locales/th/messages.mjs'),
	tr: () => import('@app/features/i18n/fork_locales/tr/messages.mjs'),
	uk: () => import('@app/features/i18n/fork_locales/uk/messages.mjs'),
	vi: () => import('@app/features/i18n/fork_locales/vi/messages.mjs'),
	'zh-CN': () => import('@app/features/i18n/fork_locales/zh-CN/messages.mjs'),
	'zh-TW': () => import('@app/features/i18n/fork_locales/zh-TW/messages.mjs'),
};

export function withForkMessages(localeCode: string, loadUpstream: LocaleLoader): LocaleLoader {
	return async () => {
		const [upstream, fork] = await Promise.all([loadUpstream(), forkLoaders[localeCode]()]);
		return {messages: {...upstream.messages, ...fork.messages}};
	};
}
