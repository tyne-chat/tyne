%% SPDX-License-Identifier: AGPL-3.0-or-later

-module(fork_persona_event_atoms_tests).
-typing([eqwalizer]).
-include_lib("eunit/include/eunit.hrl").

%% The API tells an account's own sessions which persona it has selected in a channel. A dispatch
%% whose event name has no atom here is refused, so the fork's event names must be in the table.
persona_events_for_the_account_have_atoms_test() ->
    ?assertEqual(
        user_persona_channel_state_update,
        event_atoms:normalize(<<"USER_PERSONA_CHANNEL_STATE_UPDATE">>)
    ),
    ?assertEqual(
        user_persona_settings_update, event_atoms:normalize(<<"USER_PERSONA_SETTINGS_UPDATE">>)
    ),
    ok.

%% The rest of the fork's persona events: the account's own persona list, and the community-wide
%% notice that a member's personas changed.
persona_list_and_community_events_have_atoms_test() ->
    lists:foreach(
        fun({Name, Atom}) -> ?assertEqual(Atom, event_atoms:normalize(Name)) end,
        [
            {<<"USER_PERSONA_CREATE">>, user_persona_create},
            {<<"USER_PERSONA_UPDATE">>, user_persona_update},
            {<<"USER_PERSONA_DELETE">>, user_persona_delete},
            {<<"USER_PERSONAS_UPDATE">>, user_personas_update},
            {<<"GUILD_PERSONAS_DIRTY">>, guild_personas_dirty}
        ]
    ),
    ok.
