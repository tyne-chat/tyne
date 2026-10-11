%% SPDX-License-Identifier: AGPL-3.0-or-later

-module(fork_session_passive_tests).
-typing([eqwalizer]).
-include_lib("eunit/include/eunit.hrl").

signal_bar_update_bypasses_passive_test() ->
    SessionData = #{user_id => 1, active_guilds => sets:new(), bot => false},
    State = #{member_count => 300},
    ?assertEqual(
        true,
        session_passive:should_receive_event(signal_bar_update, #{}, 123, SessionData, State)
    ),
    ok.

channel_signal_update_is_channel_scoped_and_passive_filtered_test() ->
    SessionData = #{user_id => 1, active_guilds => sets:new(), bot => false},
    State = #{member_count => 300},
    ?assertEqual(true, guild_dispatch_filter:is_channel_scoped_event(channel_signal_update)),
    ?assertEqual(
        true, guild_dispatch_filter:is_channel_scoped_event(channel_signal_bar_update)
    ),
    ?assertEqual(
        channel_signal_bar_update, event_atoms:normalize(<<"CHANNEL_SIGNAL_BAR_UPDATE">>)
    ),
    ?assertEqual(false, guild_dispatch_filter:is_channel_scoped_event(signal_bar_update)),
    ?assertEqual(
        false,
        session_passive:should_receive_event(
            channel_signal_update, #{}, 123, SessionData, State
        )
    ),
    ?assertEqual(channel_signal_update, event_atoms:normalize(<<"CHANNEL_SIGNAL_UPDATE">>)),
    ?assertEqual(signal_bar_update, event_atoms:normalize(<<"SIGNAL_BAR_UPDATE">>)),
    ok.
