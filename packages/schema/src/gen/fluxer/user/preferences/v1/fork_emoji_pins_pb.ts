import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file fluxer/user/preferences/v1/fork_emoji_pins.proto.
 */
export const file_fluxer_user_preferences_v1_fork_emoji_pins: GenFile = /*@__PURE__*/
  fileDesc("CjBmbHV4ZXIvdXNlci9wcmVmZXJlbmNlcy92MS9mb3JrX2Vtb2ppX3BpbnMucHJvdG8SGmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxIt8BCg5FbW9qaVBpbnNTdGF0ZRIYChBwaW5uZWRfZW1vamlfaWRzGAEgAygJElEKDHBlcnNvbmFfcGlucxgCIAMoCzI7LmZsdXhlci51c2VyLnByZWZlcmVuY2VzLnYxLkVtb2ppUGluc1N0YXRlLlBlcnNvbmFQaW5zRW50cnkaYAoQUGVyc29uYVBpbnNFbnRyeRILCgNrZXkYASABKAkSOwoFdmFsdWUYAiABKAsyLC5mbHV4ZXIudXNlci5wcmVmZXJlbmNlcy52MS5QZXJzb25hRW1vamlQaW5zOgI4ASIlChBQZXJzb25hRW1vamlQaW5zEhEKCWVtb2ppX2lkcxgBIAMoCWIGcHJvdG8z");

/**
 * Emojis pinned to the front of the picker's frequently used section and the quick reactions.
 * Every list holds emoji keys as the pickers write them (`unicode:<unique name>`,
 * `custom:<guild id>:<emoji id>`), in the order they were pinned.
 *
 * @generated from message fluxer.user.preferences.v1.EmojiPinsState
 */
export type EmojiPinsState = Message<"fluxer.user.preferences.v1.EmojiPinsState"> & {
  /**
   * Pinned whoever the account writes as.
   *
   * @generated from field: repeated string pinned_emoji_ids = 1;
   */
  pinnedEmojiIds: string[];

  /**
   * Pinned for one persona only, by persona id; shown after the account's pins.
   *
   * @generated from field: map<string, fluxer.user.preferences.v1.PersonaEmojiPins> persona_pins = 2;
   */
  personaPins: { [key: string]: PersonaEmojiPins };
};

/**
 * Describes the message fluxer.user.preferences.v1.EmojiPinsState.
 * Use `create(EmojiPinsStateSchema)` to create a new message.
 */
export const EmojiPinsStateSchema: GenMessage<EmojiPinsState> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_fork_emoji_pins, 0);

/**
 * @generated from message fluxer.user.preferences.v1.PersonaEmojiPins
 */
export type PersonaEmojiPins = Message<"fluxer.user.preferences.v1.PersonaEmojiPins"> & {
  /**
   * @generated from field: repeated string emoji_ids = 1;
   */
  emojiIds: string[];
};

/**
 * Describes the message fluxer.user.preferences.v1.PersonaEmojiPins.
 * Use `create(PersonaEmojiPinsSchema)` to create a new message.
 */
export const PersonaEmojiPinsSchema: GenMessage<PersonaEmojiPins> = /*@__PURE__*/
  messageDesc(file_fluxer_user_preferences_v1_fork_emoji_pins, 1);
