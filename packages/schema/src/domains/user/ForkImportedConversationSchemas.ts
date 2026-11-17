// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a conversation the Discord history import made with a placeholder account (tyne-chat/tyne#696).

import {SnowflakeStringType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

export const ImportedConversationResponse = z.object({
	channel_id: SnowflakeStringType.nullable().describe(
		'Your DM with this Discord import placeholder when it holds imported messages, which can be opened again once closed; null for anyone else, or an empty DM',
	),
});
export type ImportedConversationResponse = z.infer<typeof ImportedConversationResponse>;
