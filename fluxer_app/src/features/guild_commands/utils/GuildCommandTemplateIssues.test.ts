// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	describeTemplateIssue,
	templateIssueOfError,
} from '@app/features/guild_commands/utils/GuildCommandTemplateIssues';
import type {GuildCommandTemplateIssue} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import {GuildCommandTemplateIssueCode} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import type {I18n, MessageDescriptor} from '@lingui/core';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));

const i18n = {
	_: (descriptor: MessageDescriptor, values: Record<string, string | number>) =>
		(descriptor.message ?? '').replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key])),
} as unknown as I18n;

const issue = (overrides: Partial<GuildCommandTemplateIssue>): GuildCommandTemplateIssue => ({
	code: 'invalid',
	line: null,
	column: null,
	name: null,
	...overrides,
});

describe('template problems', () => {
	it('says where the problem is when the server knows', () => {
		expect(describeTemplateIssue(i18n, issue({code: 'unknown_tag', line: 2, column: 3, name: 'for'}))).toBe(
			"Line 2, column 3: There's no tag called for.",
		);
		expect(describeTemplateIssue(i18n, issue({code: 'too_large'}))).toBe('The script builds too much text.');
	});

	it('has words for every code the server can send', () => {
		for (const code of GuildCommandTemplateIssueCode.options) {
			expect(describeTemplateIssue(i18n, issue({code, name: 'x'}))).not.toBe('');
		}
	});

	it('finds the problem in a failed save', () => {
		const found = issue({code: 'not_closed', line: 1, column: 1, name: '{% if x %}'});
		expect(templateIssueOfError({body: {code: 'GUILD_COMMAND_TEMPLATE_INVALID', template_issue: found}})).toBe(found);
		expect(templateIssueOfError({body: {code: 'OTHER'}})).toBeNull();
		expect(templateIssueOfError(new Error('offline'))).toBeNull();
		expect(templateIssueOfError(null)).toBeNull();
	});
});
