-- Migration: Add persona_id to legacy message_reactions rows in fluxer_kv
--
-- In commit a3a88ee0f, MessageReactions primary key was expanded to 7 parts:
--   ['channel_id', 'bucket', 'message_id', 'emoji_id', 'emoji_name', 'user_id', 'persona_id']
-- Legacy reaction rows had a 6-part row_key and did not have 'persona_id' in row_data.
-- This migration updates all legacy rows by:
--   1. Appending \x1F{"__fluxer_type":"bigint","value":"0"} to row_key (root user reaction)
--   2. Adding persona_id: {"__fluxer_type":"bigint","value":"0"} to row_data
--
-- Safe to re-run (idempotent, checks NOT (row_data ? 'persona_id')).

BEGIN;

UPDATE fluxer_kv
SET row_key = row_key || E'\x1F{"__fluxer_type":"bigint","value":"0"}',
    row_data = row_data || jsonb_build_object('persona_id', jsonb_build_object('__fluxer_type', 'bigint', 'value', '0')),
    updated_at = now()
WHERE table_name = 'message_reactions'
  AND NOT (row_data ? 'persona_id');

COMMIT;
