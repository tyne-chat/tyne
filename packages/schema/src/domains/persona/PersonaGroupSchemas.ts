// SPDX-License-Identifier: AGPL-3.0-or-later

import {createStringType, SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

/**
 * Fork: groups of one's own personas (tyne-chat/tyne#829), as PluralKit has them for members. A
 * persona can be in any number of groups. Groups are private: only their owner's sessions see them.
 */

export const PERSONA_GROUP_NAME_MAX_LENGTH = 100;
/** PluralKit's default limit, so any PluralKit system's groups fit. */
export const PERSONA_GROUPS_MAX = 250;

export const PersonaGroupResponseSchema = z.object({
	id: SnowflakeStringType.describe('The ID of the group'),
	name: z.string().describe('The name of the group'),
	persona_ids: z
		.array(SnowflakeStringType)
		.describe(
			'The personas in the group, in the order they were added. A deleted persona stays listed, so that restoring it puts it back',
		),
});
export type PersonaGroupResponse = z.infer<typeof PersonaGroupResponseSchema>;

export const PersonaGroupListResponseSchema = z
	.array(PersonaGroupResponseSchema)
	.describe('The groups, in the order they were made');
export type PersonaGroupListResponse = z.infer<typeof PersonaGroupListResponseSchema>;

const PersonaGroupNameType = createStringType(1, PERSONA_GROUP_NAME_MAX_LENGTH).describe('The name of the group');
const PersonaGroupPersonaIdsType = z.array(SnowflakeStringType).max(250);

export const PersonaGroupCreateRequestSchema = z.object({
	name: PersonaGroupNameType,
	persona_ids: PersonaGroupPersonaIdsType.optional().describe('Personas of yours to put in the new group'),
});

export const PersonaGroupUpdateRequestSchema = z.object({
	name: PersonaGroupNameType,
});

export const PersonaGroupIdParam = z.object({
	group_id: SnowflakeStringType.describe('The ID of the group'),
});

/** Many membership changes in one request: the multi-select's "Add to group", or a persona editor's Groups. */
export const PersonaGroupMembersRequestSchema = z.object({
	changes: z
		.array(
			z.object({
				group_id: SnowflakeStringType.describe('The ID of one of your groups'),
				add: PersonaGroupPersonaIdsType.optional().describe('Personas of yours to put in the group'),
				remove: PersonaGroupPersonaIdsType.optional().describe('Personas to take out of the group'),
			}),
		)
		.min(1)
		.max(PERSONA_GROUPS_MAX)
		.describe('The groups to change'),
});

/** `USER_PERSONA_GROUPS_UPDATE`, to the owner's own sessions after every change: the whole list. */
export const PersonaGroupsUpdateEventSchema = z.object({
	groups: PersonaGroupListResponseSchema,
});
export type PersonaGroupsUpdateEvent = z.infer<typeof PersonaGroupsUpdateEventSchema>;
