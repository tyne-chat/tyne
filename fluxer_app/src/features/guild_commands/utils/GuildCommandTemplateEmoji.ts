// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import {isExistingCustomEmojiMarkdown} from '@app/features/messaging/utils/markdown/TypedEmojiMatch';
import {findUrlSpans, isInsideSpan, type TextSpan} from '@app/features/messaging/utils/markdown/UrlSpanUtils';
import {resolveTypedEmojiShortcodes} from '@app/features/messaging/utils/TypedEmojiShortcodeUtils';
import type {I18n} from '@lingui/core';

// Fork: custom emoji in a command's template (docs/design/server-commands.md, "Phase 1 on the web,
// as built"). The server posts a template as written, so a custom emoji is stored as in a message,
// `<:name:id>`. The settings field shows it as `:name:`, and saving turns `:name:` back the way the
// composer does when sending. Standard emoji need nothing: the renderer shows `:smile:` as is.

const CUSTOM_EMOJI_MARKDOWN = /<a?:([a-zA-Z0-9_+~-]{2,}):\d+>/g;
const SHORTCODE = /:([a-zA-Z0-9_+~-]{2,}):/g;

/** The template as the settings field shows it: custom emoji as `:name:`. */
export function templateForEditing(template: string): string {
	return template.replace(CUSTOM_EMOJI_MARKDOWN, (_match, name: string) => `:${name}:`);
}

/** The custom emoji a stored template uses, by name. */
export function templateEmojiByName(template: string): Map<string, string> {
	const byName = new Map<string, string>();
	for (const match of template.matchAll(CUSTOM_EMOJI_MARKDOWN)) {
		if (!byName.has(match[1]!)) byName.set(match[1]!, match[0]);
	}
	return byName;
}

/**
 * The field's text as stored. A name the stored template already used keeps that emoji, so saving
 * does not drop one the editor cannot look up (another community's); other names resolve as in a
 * message sent in `channel`.
 */
export function templateForSaving(params: {
	text: string;
	stored: ReadonlyMap<string, string>;
	channel: Channel | null;
	guildId: string;
	i18n: I18n;
}): string {
	const {text, stored, channel, guildId, i18n} = params;
	let urlSpans: Array<TextSpan> | null = null;
	const kept =
		stored.size === 0
			? text
			: text.replace(SHORTCODE, (match, name: string, index: number) => {
					const markdown = stored.get(name);
					if (!markdown || isExistingCustomEmojiMarkdown(text, index)) return match;
					urlSpans ??= findUrlSpans(text, true);
					return isInsideSpan(urlSpans, index) ? match : markdown;
				});
	return resolveTypedEmojiShortcodes({content: kept, channel, guildIdFallback: guildId, i18n});
}
