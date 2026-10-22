%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a handed-over session's old process forwards to its new one
%% (fork_session_handoff). What is forwarded goes to a collector process, so messages other tests
%% leave in the test process's mailbox cannot interfere.

-module(fork_session_handoff_tests).
-include_lib("eunit/include/eunit.hrl").

casts_and_calls_go_on_unchanged_test() ->
    New = collector(),
    From = {self(), make_ref()},
    forwarded = fork_session_handoff:forward(
        New, {'$gen_cast', {dispatch, message_create, #{}}}
    ),
    forwarded = fork_session_handoff:forward(New, {'$gen_call', From, {heartbeat_ack, 3}}),
    ?assertEqual(
        [
            {'$gen_cast', {dispatch, message_create, #{}}},
            {'$gen_call', From, {heartbeat_ack, 3}}
        ],
        collected(New)
    ).

the_drain_and_the_old_process_own_messages_stay_behind_test() ->
    New = collector(),
    lists:foreach(
        fun(Msg) -> ?assertEqual(ok, fork_session_handoff:forward(New, Msg)) end,
        [
            {'$gen_cast', handoff_fence},
            {'$gen_cast', reconnect_drain},
            {'$gen_cast', {reconnect_drain, self()}},
            {'$gen_call', {self(), make_ref()}, export_state},
            {'DOWN', make_ref(), process, self(), normal},
            {resume_timeout, make_ref()}
        ]
    ),
    ?assertEqual([], collected(New)).

a_resume_goes_on_and_its_connection_is_told_to_reconnect_test() ->
    New = collector(),
    Socket = collector(),
    From = {self(), make_ref()},
    forwarded = fork_session_handoff:forward(New, {'$gen_call', From, {resume, 3, Socket}}),
    ?assertEqual([{'$gen_call', From, {resume, 3, Socket}}], collected(New)),
    ?assertEqual([session_reconnect], collected(Socket)).

keeps_what_arrives_in_order_until_the_fence_finds_the_new_process_test() ->
    NewPid = collector(),
    Lookup = fun() -> NewPid end,
    Waiter = run_await(#{
        parent => undefined, lookup => Lookup, poll_ms => 60000, idle_ms => 1000
    }),
    Waiter ! {'$gen_cast', {dispatch, a, #{}}},
    Waiter ! {info, b},
    Waiter ! {'$gen_cast', handoff_fence},
    ?assertEqual(
        {found, NewPid, [{'$gen_cast', {dispatch, a, #{}}}, {info, b}]}, result(Waiter)
    ).

polls_for_the_new_process_test() ->
    NewPid = collector(),
    Lookup = fun() -> NewPid end,
    Waiter = run_await(#{parent => undefined, lookup => Lookup, poll_ms => 10, idle_ms => 1000}),
    ?assertEqual({found, NewPid, []}, result(Waiter)).

gives_up_and_returns_what_it_kept_test() ->
    Lookup = fun() -> undefined end,
    Opts = #{parent => undefined, lookup => Lookup, poll_ms => 10, idle_ms => 1000},
    Test = self(),
    Waiter = spawn(fun() ->
        receive
            go -> ok
        end,
        Test ! {result, self(), fork_session_handoff:await_target(Opts, [], now_ms() + 50)}
    end),
    Waiter ! {'$gen_cast', {dispatch, a, #{}}},
    Waiter ! go,
    ?assertEqual({gave_up, [{'$gen_cast', {dispatch, a, #{}}}]}, result(Waiter)).

forwards_until_idle_test() ->
    New = collector(),
    Test = self(),
    Opts = #{
        parent => undefined, lookup => fun() -> undefined end, poll_ms => 10, idle_ms => 50
    },
    Forwarder = spawn(fun() ->
        Test ! {result, self(), fork_session_handoff:forward_loop(New, Opts, now_ms() + 60000)}
    end),
    Forwarder ! {'$gen_cast', {dispatch, a, #{}}},
    ?assertEqual(forwarded, result(Forwarder)),
    ?assertEqual([{'$gen_cast', {dispatch, a, #{}}}], collected(New)).

%% The old process's own messages (timers, monitors) do not count as traffic: with one arriving
%% every 10 ms, the forwarder still stops once nothing has been passed on for idle_ms.
messages_left_behind_do_not_keep_it_alive_test() ->
    New = collector(),
    Test = self(),
    Opts = #{
        parent => undefined, lookup => fun() -> undefined end, poll_ms => 10, idle_ms => 100
    },
    Forwarder = spawn(fun() ->
        Test ! {result, self(), fork_session_handoff:forward_loop(New, Opts, now_ms() + 60000)}
    end),
    Ticker = spawn(fun() -> tick(Forwarder) end),
    ?assertEqual(forwarded, result(Forwarder)),
    Ticker ! stop,
    ?assertEqual([], collected(New)).

tick(Pid) ->
    receive
        stop -> ok
    after 10 ->
        Pid ! {resume_timeout, make_ref()},
        tick(Pid)
    end.

run_await(Opts) ->
    Test = self(),
    spawn(fun() ->
        Test ! {result, self(), fork_session_handoff:await_target(Opts, [], now_ms() + 60000)}
    end).

result(Pid) ->
    receive
        {result, Pid, Result} -> Result
    after 5000 -> error(no_result)
    end.

%% A process that keeps what it receives, in order, until asked for it.
collector() ->
    spawn(fun() -> collect([]) end).

collect(Acc) ->
    receive
        {'$collected', From} -> From ! {'$collected', self(), lists:reverse(Acc)};
        Msg -> collect([Msg | Acc])
    end.

collected(Pid) ->
    Pid ! {'$collected', self()},
    receive
        {'$collected', Pid, Messages} -> Messages
    after 5000 -> error(no_collection)
    end.

now_ms() ->
    erlang:monotonic_time(millisecond).
