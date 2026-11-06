%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a guild transfer repoints the guild pid cache (fork_guild_handoff).

-module(fork_guild_handoff_tests).
-include_lib("eunit/include/eunit.hrl").

-define(GUILD, 1234).

hooks_repoint_the_cache_test_() ->
    {setup, fun setup_cache/0, fun cleanup_cache/1, fun(_) ->
        [
            fun after_start_points_the_cache_at_the_new_process/0,
            fun on_abort_points_the_cache_back_at_the_source/0
        ]
    end}.

after_start_points_the_cache_at_the_new_process() ->
    Source = spawn_idle(),
    New = spawn_idle(),
    true = ets:insert(guild_pid_cache, {?GUILD, Source}),
    #{after_start := AfterStart} = fork_guild_handoff:transfer_opts(?GUILD, Source),
    ?assertEqual(ok, AfterStart(New)),
    ?assertEqual([{?GUILD, New}], ets:lookup(guild_pid_cache, ?GUILD)),
    stop_idle([Source, New]).

on_abort_points_the_cache_back_at_the_source() ->
    Source = spawn_idle(),
    New = spawn_idle(),
    true = ets:insert(guild_pid_cache, {?GUILD, New}),
    #{on_abort := OnAbort} = fork_guild_handoff:transfer_opts(?GUILD, Source),
    ?assertEqual(ok, OnAbort()),
    ?assertEqual([{?GUILD, Source}], ets:lookup(guild_pid_cache, ?GUILD)),
    stop_idle([Source, New]).

setup_cache() ->
    case ets:whereis(guild_pid_cache) of
        undefined ->
            ets:new(guild_pid_cache, [named_table, public, set]),
            created;
        _ ->
            existing
    end.

cleanup_cache(created) ->
    ets:delete(guild_pid_cache);
cleanup_cache(existing) ->
    ets:delete(guild_pid_cache, ?GUILD).

spawn_idle() ->
    spawn(fun() ->
        receive
            stop -> ok
        end
    end).

stop_idle(Pids) ->
    lists:foreach(fun(Pid) -> Pid ! stop end, Pids).

carried_over_sessions_are_marked_unless_pending_test() ->
    State = fork_guild_handoff:mark_carried_over(#{
        id => 1,
        sessions => #{
            <<"a">> => #{user_id => 1, pending_connect => false},
            <<"b">> => #{user_id => 2, pending_connect => true}
        }
    }),
    #{sessions := #{<<"a">> := A, <<"b">> := B}} = State,
    ?assertEqual(true, maps:get(fork_carried_over, A)),
    ?assertNot(maps:is_key(fork_carried_over, B)).

a_state_without_sessions_is_left_alone_test() ->
    ?assertEqual(#{id => 1}, fork_guild_handoff:mark_carried_over(#{id => 1})).

%% Through upstream's start of a guild that arrives in a handoff
%% (guild_manager_shard_lifecycle:start_transferred_guild/3): the started guild process holds the
%% marks. This starts a real guild, and with it upstream's counts cache and voice server, which
%% all stop with it.
a_transferred_guild_starts_with_its_sessions_marked_test() ->
    with_config(#{}, fun() ->
        ok = process_registry:init(),
        SessionA = spawn_idle(),
        SessionB = spawn_idle(),
        Transferred = #{
            data => #{},
            sessions => #{
                <<"a">> => #{user_id => 1, pid => SessionA, pending_connect => false},
                <<"b">> => #{user_id => 2, pid => SessionB, pending_connect => true}
            }
        },
        {ok, Guild, _State} = guild_manager_shard_lifecycle:start_transferred_guild(
            ?GUILD, Transferred, #{guilds => #{}}
        ),
        try
            #{sessions := #{<<"a">> := A, <<"b">> := B}} = sys:get_state(Guild),
            ?assertEqual(true, maps:get(fork_carried_over, A, false)),
            ?assertNot(maps:is_key(fork_carried_over, B))
        after
            ok = gen_server:stop(Guild),
            process_registry:safe_unregister(process_registry:build_process_key(guild, ?GUILD)),
            stop_idle([SessionA, SessionB])
        end
    end).

with_config(Config, Fun) ->
    Key = {fluxer_gateway, runtime_config},
    Previous = persistent_term:get(Key, undefined),
    persistent_term:put(Key, Config),
    try
        Fun()
    after
        case Previous of
            undefined -> persistent_term:erase(Key);
            _ -> persistent_term:put(Key, Previous)
        end
    end.
