// SPDX-License-Identifier: AGPL-3.0-or-later

import {describe, expect, it, vi} from 'vitest';

// The composer's resolver, reduced to one custom emoji the editor can use: `:wave:`.
vi.mock('@app/features/messaging/utils/TypedEmojiShortcodeUtils', () => ({
	resolveTypedEmojiShortcodes: ({content}: {content: string}) => content.replace(/(?<!<a?):wave:/g, '<:wave:5>'),
}));

import {
	templateEmojiByName,
	templateForEditing,
	templateForSaving,
} from '@app/features/guild_commands/utils/GuildCommandTemplateEmoji';
import type {I18n} from '@lingui/core';

const i18n = {} as I18n;

function save(text: string, storedTemplate = ''): string {
	return templateForSaving({text, stored: templateEmojiByName(storedTemplate), channel: null, guildId: 'g', i18n});
}

describe('custom emoji in command templates', () => {
	it('shows stored custom emoji by name in the field', () => {
		expect(templateForEditing('{{ person }} <:tuck:1> <a:spin:2> :smile:')).toBe('{{ person }} :tuck: :spin: :smile:');
	});

	it('keeps the stored emoji of a name on save, even one the editor cannot look up', () => {
		const stored = '<:tuck:1> {{ input }} <a:spin:2>';
		expect(save(templateForEditing(stored), stored)).toBe(stored);
		expect(save(':spin: then :tuck:', stored)).toBe('<a:spin:2> then <:tuck:1>');
	});

	it('resolves new names as a message would, and leaves the rest as typed', () => {
		expect(save(':wave: {{ person }} :smile: :nosuch:')).toBe('<:wave:5> {{ person }} :smile: :nosuch:');
	});

	it('leaves names inside links and existing emoji markdown alone', () => {
		const stored = '<:tuck:1>';
		expect(save('https://example.test/:tuck:/x <:tuck:9>', stored)).toBe('https://example.test/:tuck:/x <:tuck:9>');
	});
});
