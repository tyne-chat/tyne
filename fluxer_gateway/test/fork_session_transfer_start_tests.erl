%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a session handed over from another gateway node starts when its
%% state arrives (fork_session_transfer_start).

-module(fork_session_transfer_start_tests).
-include_lib("eunit/include/eunit.hrl").

starts_the_stored_state_with_an_exited_socket_test() ->
    Parent = self(),
    Stored = #{token_hash => <<"hash">>, seq => 7},
    StartProcess = fun(SessionData, SessionId, Sessions, State) ->
        Parent ! {started, SessionData, SessionId, Sessions},
        {reply, {success, Parent}, State#{started => true}}
    end,
    State0 = #{sessions => #{<<"other">> => placeholder}},
    {Reply, State1} = fork_session_transfer_start:start_session(
        <<"s1">>, fun(<<"s1">>) -> {ok, Stored} end, StartProcess, State0
    ),
    ?assertEqual({success, Parent}, Reply),
    ?assertEqual(true, maps:get(started, State1)),
    receive
        {started, SessionData, SessionId, Sessions} ->
            ?assertEqual(<<"s1">>, SessionId),
            ?assertEqual(#{<<"other">> => placeholder}, Sessions),
            ?assertEqual(<<"s1">>, maps:get(id, SessionData)),
            ?assertEqual(7, maps:get(seq, SessionData)),
            ?assertEqual(<<"hash">>, maps:get(token_hash, SessionData)),
            assert_exits(maps:get(socket_pid, SessionData))
    after 1000 ->
        ?assert(false)
    end.

does_nothing_when_the_state_is_gone_test() ->
    StartProcess = fun(_SessionData, _SessionId, _Sessions, _State) ->
        error(should_not_start)
    end,
    State0 = #{sessions => #{}},
    ?assertEqual(
        {{error, not_found}, State0},
        fork_session_transfer_start:start_session(
            <<"s1">>, fun(_) -> {error, not_found} end, StartProcess, State0
        )
    ).

passes_on_a_failed_start_test() ->
    StartProcess = fun(_SessionData, _SessionId, _Sessions, State) ->
        {reply, {error, ignored}, State}
    end,
    State0 = #{sessions => #{}},
    ?assertEqual(
        {{error, ignored}, State0},
        fork_session_transfer_start:start_session(
            <<"s1">>, fun(_) -> {ok, #{}} end, StartProcess, State0
        )
    ).

%% What the started session does with a socket that has already exited: upstream's path for a
%% dropped socket, held for resume rather than ended.
an_exited_socket_holds_the_session_for_resume_test() ->
    Socket = spawn(fun() -> ok end),
    assert_exits(Socket),
    SocketRef = monitor(process, Socket),
    Reason =
        receive
            {'DOWN', SocketRef, process, Socket, R} -> R
        after 1000 -> error(no_down)
        end,
    ?assertEqual(noproc, Reason),
    State0 = #{
        socket_pid => Socket,
        socket_mref => SocketRef,
        presence_mref => undefined,
        status => online
    },
    {noreply, State1} = session_monitor:handle_process_down(SocketRef, Reason, State0),
    ?assertEqual(undefined, maps:get(socket_pid, State1)),
    ?assertEqual(online, maps:get(resume_status, State1)),
    {_ResumeToken, ResumeTimerRef} = maps:get(resume_timer, State1),
    {_OfflineToken, OfflineTimerRef} = maps:get(offline_timer, State1),
    ?assert(is_integer(erlang:cancel_timer(ResumeTimerRef))),
    ?assert(is_integer(erlang:cancel_timer(OfflineTimerRef))).

start_received_ignores_an_invalid_session_id_test() ->
    ?assertEqual(ok, fork_session_transfer_start:start_received(undefined)).

assert_exits(Pid) ->
    Ref = monitor(process, Pid),
    receive
        {'DOWN', Ref, process, Pid, _} -> ok
    after 1000 ->
        ?assert(false)
    end.
