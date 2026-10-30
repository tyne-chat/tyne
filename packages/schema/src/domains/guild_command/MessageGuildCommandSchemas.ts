// SPDX-License-Identifier: AGPL-3.0-or-later

import {SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

// Fork: the `command` field of a message made by a server command (docs/design/server-commands.md).
// Its own file, so the message schemas can import it without importing the command schemas.

export const MessageGuildCommandResponseSchema = z.object({
	id: SnowflakeStringType.describe('The ID of the command'),
	guild_id: SnowflakeStringType.describe('The community the command belongs to'),
	name: z.string().describe("The command's name when the message was posted"),
});
export type MessageGuildCommandResponse = z.infer<typeof MessageGuildCommandResponseSchema>;
