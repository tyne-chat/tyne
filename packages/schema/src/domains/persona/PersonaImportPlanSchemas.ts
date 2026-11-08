// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the reviewed persona import (tyne-chat/tyne#243). The client sends the file's members to the
// preview, which classifies each one against the account's personas, deleted ones included, and
// changes nothing. The client then applies one explicit action per member. Nothing in an import
// deletes a persona, and an existing persona is overwritten only by a `use_file` action for it.

import {
	PersonaAssetHashType,
	PersonaCreateRequestSchema,
	PersonaImportItemSchema,
	PersonaResponseSchema,
	PersonaTagSchema,
	SignatureEmojiSchema,
} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

/** At most as many members as a persona list can hold, as the older import allowed. */
export const PERSONA_IMPORT_MAX_MEMBERS = 250;

export const PersonaImportSourceKindSchema = z
	.enum(['pluralkit', 'tyne'])
	.describe(
		'pluralkit for a PluralKit export; tyne for a Tyne export, which also carries signature emojis and auto-tag',
	);
export type PersonaImportSourceKind = z.infer<typeof PersonaImportSourceKindSchema>;

/**
 * A picture as the file gives it, before anything is stored. `url` is the file's link, compared with
 * what earlier imports recorded and never fetched by the preview. `hash` is a hash the client already
 * knows is stored under the account (a link to this instance's own media).
 */
export const PersonaImportImageRefSchema = z
	.object({
		url: z.string().max(2048).nullish().describe("The file's link to the picture"),
		hash: PersonaAssetHashType.nullish().describe('The hash of a copy already stored under the account'),
	})
	.nullish();
export type PersonaImportImageRef = z.infer<typeof PersonaImportImageRefSchema>;

export const PersonaImportPreviewMemberSchema = PersonaCreateRequestSchema.pick({
	name: true,
	pronouns: true,
	color: true,
	bio: true,
	auto_tag_disabled: true,
	persona_tags: true,
	signature_emojis: true,
	visibility: true,
	external_uuid: true,
}).extend({
	avatar: PersonaImportImageRefSchema.describe("The member's avatar, if the file has one"),
	banner: PersonaImportImageRefSchema.describe("The member's banner, if the file has one"),
});
export type PersonaImportPreviewMember = z.infer<typeof PersonaImportPreviewMemberSchema>;

export const PersonaImportPreviewRequestSchema = z.object({
	source: PersonaImportSourceKindSchema,
	members: z
		.array(PersonaImportPreviewMemberSchema)
		.max(PERSONA_IMPORT_MAX_MEMBERS)
		.describe('The members, in file order'),
	display_tag: z
		.object({
			text: z.string().max(100).nullish().describe("The file's system tag"),
			has_icon: z.boolean().optional().describe('Whether the file carries a tag icon'),
		})
		.nullish()
		.describe("The file's system tag, if it has one"),
});
export type PersonaImportPreviewRequest = z.infer<typeof PersonaImportPreviewRequestSchema>;

export const PersonaImportKindSchema = z
	.enum(['up_to_date', 'differs', 'deleted', 'probably_same', 'cant_tell', 'tag_in_use', 'new'])
	.describe(
		'up_to_date: linked and identical. differs: linked, with different details. deleted: linked only to a deleted persona. probably_same: the one unlinked persona with the same name and tag. cant_tell: a name or tag in common, but not one-to-one or not both. tag_in_use: a tag is held by another persona or shared with another member. new: none of these',
	);

export const PersonaImportFieldSchema = z.enum([
	'name',
	'pronouns',
	'bio',
	'color',
	'persona_tags',
	'avatar',
	'banner',
	'signature_emojis',
	'auto_tag_disabled',
	'visibility',
]);
export type PersonaImportField = z.infer<typeof PersonaImportFieldSchema>;

export const PersonaImportDifferenceSchema = z.object({
	field: PersonaImportFieldSchema,
	change: z
		.enum(['changed', 'removed', 'not_compared', 'info'])
		.describe(
			"changed: the file has another value. removed: Tyne has a value and the file has none. not_compared: the picture's origin is unknown, so it cannot be compared. info: shown only, never written (visibility)",
		),
});
export type PersonaImportDifference = z.infer<typeof PersonaImportDifferenceSchema>;

export const PersonaImportCandidateSchema = z.object({
	persona_id: SnowflakeStringType,
	matched_on: z.enum(['name', 'tag', 'name_and_tag', 'tag_case']).describe('What the member has in common with it'),
	linked_elsewhere: z.boolean().describe('Whether the persona is linked to a PluralKit member that is not this one'),
});
export type PersonaImportCandidate = z.infer<typeof PersonaImportCandidateSchema>;

export const PersonaImportClashSchema = z.object({
	tag: PersonaTagSchema.nullish().describe('The tag that clashes'),
	emoji: SignatureEmojiSchema.nullish().describe('The signature emoji that clashes'),
	held_by_persona_id: SnowflakeStringType.nullish().describe('The live persona that holds it'),
	shared_with_member: z.number().int().nullish().describe('The other member of the file that has it'),
});
export type PersonaImportClash = z.infer<typeof PersonaImportClashSchema>;

export const PersonaImportPreviewEntrySchema = z.object({
	index: z.number().int().describe("The member's position in the request"),
	kind: PersonaImportKindSchema,
	persona_id: SnowflakeStringType.nullish().describe(
		'The persona it is linked to, deleted in Tyne as, or probably the same as',
	),
	candidates: z.array(PersonaImportCandidateSchema).optional().describe('For cant_tell, the personas it may be'),
	differences: z.array(PersonaImportDifferenceSchema).optional().describe('For differs and up_to_date, field by field'),
	clashes: z
		.array(PersonaImportClashSchema)
		.optional()
		.describe('Tags and signature emojis a plain add would clash on'),
	avatar_hash: PersonaAssetHashType.nullish().describe("A stored copy of the member's avatar, safe to show"),
	banner_hash: PersonaAssetHashType.nullish().describe("A stored copy of the member's banner, safe to show"),
});
export type PersonaImportPreviewEntry = z.infer<typeof PersonaImportPreviewEntrySchema>;

export const PersonaImportPreviewResponseSchema = z.object({
	entries: z.array(PersonaImportPreviewEntrySchema).describe('One per member, in request order'),
	personas: z
		.array(PersonaResponseSchema)
		.describe('Every persona the entries name, deleted ones included, so the review can show them'),
	display_tag: z.object({
		decision: z
			.enum(['none', 'auto_apply', 'ask'])
			.describe(
				"none: the file has no tag, or the same one. auto_apply: the account has no personas and no display tag, so the file's is used. ask: it differs",
			),
		current_text: z.string().nullish(),
	}),
	untouched: z.number().int().describe('Live personas no member of the file matched; they stay as they are'),
	needs_review: z.boolean().describe('Whether anything needs a decision; if not, the client can apply at once'),
});
export type PersonaImportPreviewResponse = z.infer<typeof PersonaImportPreviewResponseSchema>;

export const PersonaImportActionKindSchema = z
	.enum(['add', 'link', 'restore', 'use_file'])
	.describe(
		"add: a new persona from the item (drop_tags leaves tags out). link: record the member's PluralKit id on persona_id, nothing else. restore: bring the deleted persona_id back as it was. use_file: replace persona_id's details with the item's, by the documented field rules",
	);

export const PersonaImportActionSchema = z.object({
	action: PersonaImportActionKindSchema,
	persona_id: SnowflakeStringType.nullish().describe('For link, restore and use_file'),
	external_uuid: z.string().max(64).nullish().describe("The member's PluralKit id, for link"),
	item: PersonaImportItemSchema.nullish().describe(
		'For add and use_file: the member with its pictures stored (hashes), as the older import sends it',
	),
	drop_tags: z.array(PersonaTagSchema).max(5).optional().describe('Tags to leave out, for add and use_file'),
	drop_signature_emojis: z
		.array(SignatureEmojiSchema)
		.optional()
		.describe('Signature emojis to leave out, for add and use_file'),
	keep_avatar: z
		.boolean()
		.optional()
		.describe("For use_file: keep the persona's avatar, because the file's could not be stored"),
	keep_banner: z
		.boolean()
		.optional()
		.describe("For use_file: keep the persona's banner, because the file's could not be stored"),
});
export type PersonaImportAction = z.infer<typeof PersonaImportActionSchema>;

export const PersonaImportApplyRequestSchema = z.object({
	source: PersonaImportSourceKindSchema,
	actions: z.array(PersonaImportActionSchema).max(PERSONA_IMPORT_MAX_MEMBERS).describe('Skipped members are left out'),
});
export type PersonaImportApplyRequest = z.infer<typeof PersonaImportApplyRequestSchema>;

export const PersonaImportApplyResponseSchema = z.object({
	personas: z.array(PersonaResponseSchema).describe('The personas written, in action order'),
	dropped: z
		.array(
			z.object({
				persona_id: SnowflakeStringType,
				tags: z.array(PersonaTagSchema),
				signature_emojis: z.array(SignatureEmojiSchema),
			}),
		)
		.describe('For restored personas: tags and signature emojis left off because another persona holds them now'),
});
export type PersonaImportApplyResponse = z.infer<typeof PersonaImportApplyResponseSchema>;

export const DeletedPersonaListResponseSchema = z
	.array(PersonaResponseSchema)
	.describe("The account's deleted personas, the most recently deleted first");

export const PersonaRestoreResponseSchema = z.object({
	persona: PersonaResponseSchema,
	dropped_tags: z.array(PersonaTagSchema).describe('Tags left off because another persona holds them now'),
	dropped_signature_emojis: z.array(SignatureEmojiSchema).describe('Signature emojis left off for the same reason'),
});
export type PersonaRestoreResponse = z.infer<typeof PersonaRestoreResponseSchema>;
