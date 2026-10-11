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
