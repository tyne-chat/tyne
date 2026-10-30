// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import Emoji from '@app/features/emoji/state/Emoji';
import type {Completion, CompletionContext, CompletionResult, CompletionSource} from '@codemirror/autocomplete';

// Fork: `:` in the command script editor suggests emoji, from the search the message box uses. A pick
// inserts `:name:`, which saving turns into the emoji (`GuildCommandTemplateEmoji.ts`).

const MAX_SUGGESTIONS = 20;
/** A `:` that starts a word, so Liquid's own (`append: "x"`, `'%H:%M'`) do not open the list. */
const TYPED_SHORTCODE = /(?:^|[^\p{L}\p{N}_:]):([\p{L}\p{N}_+~-]{2,})$/u;

export interface GuildCommandEmojiCompletion extends Completion {
	emojiUrl?: string;
	emojiText?: string;
}

export function guildCommandEmojiCompletions(channel: Channel | null): CompletionSource {
	return (context: CompletionContext): CompletionResult | null => {
		const line = context.state.doc.lineAt(context.pos);
		const typed = TYPED_SHORTCODE.exec(line.text.slice(0, context.pos - line.from));
		if (!typed) return null;
		const options = Emoji.search(channel, typed[1]!, MAX_SUGGESTIONS).map(
			(emoji): GuildCommandEmojiCompletion => ({
				label: `:${emoji.uniqueName}:`,
				emojiUrl: emoji.url ?? undefined,
				emojiText: 'surrogates' in emoji ? emoji.surrogates : undefined,
			}),
		);
		if (options.length === 0) return null;
		// The search also matches other names of an emoji, which the label would not show.
		return {from: context.pos - typed[1]!.length - 1, options, filter: false};
	};
}

/** The picture in a suggestion's row. */
export function renderGuildCommandEmoji(completion: GuildCommandEmojiCompletion): Node | null {
	if (completion.emojiUrl) {
		const image = document.createElement('img');
		image.src = completion.emojiUrl;
		image.alt = '';
		image.width = 18;
		image.height = 18;
		image.style.display = 'inline-block';
		image.style.marginInlineEnd = '0.375rem';
		image.style.verticalAlign = 'text-bottom';
		return image;
	}
	if (completion.emojiText) {
		const text = document.createElement('span');
		text.textContent = completion.emojiText;
		text.style.marginInlineEnd = '0.375rem';
		return text;
	}
	return null;
}
