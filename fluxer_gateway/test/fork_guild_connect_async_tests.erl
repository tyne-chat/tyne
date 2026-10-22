%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a session that connects again because of a handoff is not taken out
%% of the guild's dispatches (guild_connect_async's fork block). Upstream's case, a session that
%% simply reconnects, is upstream's own test (enqueue_marks_existing_session_pending_connect_test).

-module(fork_guild_connect_async_tests).
-include_lib("eunit/include/eunit.hrl").

-define(SESSION, <<"s-existing">>).
-define(USER, 21).

a_moved_session_takes_over_its_entry_and_keeps_receiving_test() ->
    Old = spawn_idle(),
    New = spawn_idle(),
    OldRef = monitor(process, Old),
    Entry = enqueue(New, existing(Old, OldRef, #{})),
    ?assertEqual(New, maps:get(pid, Entry)),
    ?assertNotEqual(OldRef, maps:get(mref, Entry)),
    ?assertNotEqual(true, maps:get(pending_connect, Entry)),
    stop([Old, New]).

a_session_that_came_with_the_guild_keeps_receiving_test() ->
    Pid = spawn_idle(),
    Ref = monitor(process, Pid),
    Entry = enqueue(Pid, existing(Pid, Ref, #{fork_carried_over => true})),
    ?assertEqual(Pid, maps:get(pid, Entry)),
    ?assertEqual(Ref, maps:get(mref, Entry)),
    ?assertNotEqual(true, maps:get(pending_connect, Entry)),
    ?assertNot(maps:is_key(fork_carried_over, Entry)),
    stop([Pid]).

any_other_reconnect_is_upstreams_test() ->
    Pid = spawn_idle(),
    Entry = enqueue(Pid, existing(Pid, monitor(process, Pid), #{})),
    ?assertEqual(true, maps:get(pending_connect, Entry)),
    stop([Pid]).

existing(Pid, Ref, Extra) ->
    maps:merge(
        #{
            session_id => ?SESSION,
            user_id => ?USER,
            pid => Pid,
            mref => Ref,
            pending_connect => false,
            active_guilds => sets:new()
        },
        Extra
    ).

%% No connect worker starts: the in-flight count is at any limit.
enqueue(Pid, Existing) ->
    State0 = #{
        id => 42,
        sessions => #{?SESSION => Existing},
        guild_session_refs => #{maps:get(mref, Existing) => ?SESSION},
        session_connect_pending => #{},
        session_connect_queue => queue:new(),
        session_connect_inflight => 1000000,
        session_connect_max_queue => 1000000
    },
    Request = #{
        session_id => ?SESSION,
        user_id => ?USER,
        session_pid => Pid,
        bot => false,
        is_staff => false,
        active_guilds => sets:new()
    },
    State1 = guild_connect_async:enqueue_session_connect_async(42, 1, Request, #{}, State0),
    maps:get(?SESSION, maps:get(sessions, State1)).

spawn_idle() ->
    spawn(fun() ->
        receive
            stop -> ok
        end
    end).

stop(Pids) ->
    lists:foreach(fun(Pid) -> Pid ! stop end, Pids).
