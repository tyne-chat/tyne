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

%% Through upstream's handoff on the receiving node: the state the old node pushes
%% (session_state_transfer) starts its session in its shard (session_manager_shard) at once, with
%% no RESUME. The session holds the state's seq and waits for its client as one whose socket
%% dropped; the old node's forwarder then finds it (started_pid/1, as fork_session_handoff asks).
a_received_state_starts_its_session_at_once_test() ->
    with_transfer_and_shard(fun(Shard) ->
        ok = report_replies(Shard),
        Exported = session_lifecycle:serialize_transfer_state(session_state(<<"s1">>, 7)),
        ok = session_state_transfer:push_state(node(), <<"s1">>, Exported),
        {success, Session} = shard_reply(Shard),
        #{seq := Seq, socket_pid := SocketPid, resume_timer := ResumeTimer} = sys:get_state(
            Session
        ),
        ?assertEqual(7, Seq),
        ?assertEqual(undefined, SocketPid),
        ?assertNotEqual(undefined, ResumeTimer),
        ?assertEqual({error, not_found}, session_state_transfer:pop_state(<<"s1">>)),
        ?assertEqual({ok, Session}, fork_session_transfer_start:started_pid(<<"s1">>))
    end).

started_pid_finds_nothing_without_a_state_or_a_session_test() ->
    with_transfer_and_shard(fun(_Shard) ->
        ?assertEqual({error, not_found}, fork_session_transfer_start:started_pid(<<"s2">>))
    end).

%% session_state_transfer and one session_manager_shard, both upstream's servers, the shard
%% entered with the state its init/1 builds and put in upstream's shard table, so that
%% session_manager_routing finds it. Every session it started is stopped afterwards.
with_transfer_and_shard(Fun) ->
    Key = {fluxer_gateway, runtime_config},
    PreviousConfig = persistent_term:get(Key, undefined),
    persistent_term:put(Key, #{}),
    ok = process_registry:init(),
    {ok, Transfer} = session_state_transfer:start_link(),
    Shard = proc_lib:spawn(fun() ->
        process_flag(trap_exit, true),
        gen_server:enter_loop(session_manager_shard, [], #{
            sessions => #{},
            session_refs => #{},
            pending_identifies => #{},
            identify_workers => #{},
            shard_index => 0
        })
    end),
    ok = session_manager_shards:sync_shard_table(#{
        shard_count => 1, shards => #{0 => #{pid => Shard, ref => make_ref()}}
    }),
    try
        Fun(Shard)
    after
        Sessions = maps:get(sessions, sys:get_state(Shard)),
        lists:foreach(fun stop_session/1, maps:to_list(Sessions)),
        stop(Shard, kill),
        ok = session_manager_shards:delete_shard_table(),
        ok = gen_server:stop(Transfer),
        case PreviousConfig of
            undefined -> persistent_term:erase(Key);
            _ -> persistent_term:put(Key, PreviousConfig)
        end
    end.

%% Tells the test what the shard answers to each call.
report_replies(Shard) ->
    Test = self(),
    sys:install(Shard, {
        fun
            (Acc, {out, Reply, _From, _State}, _ProcState) ->
                Test ! {shard_reply, Shard, Reply},
                Acc;
            (Acc, _Event, _ProcState) ->
                Acc
        end,
        ok
    }).

shard_reply(Shard) ->
    receive
        {shard_reply, Shard, Reply} -> Reply
    after 4000 -> error(no_shard_reply)
    end.

stop_session({SessionId, {Pid, _Ref}}) ->
    stop(Pid, kill),
    process_registry:safe_unregister(process_registry:build_process_key(session, SessionId)).

stop(Pid, Reason) ->
    Ref = monitor(process, Pid),
    exit(Pid, Reason),
    receive
        {'DOWN', Ref, process, Pid, _} -> ok
    after 4000 -> error(not_stopped)
    end.

%% The fields upstream's export (session_lifecycle:serialize_transfer_state/1) requires.
session_state(SessionId, Seq) ->
    #{
        id => SessionId,
        user_id => 42,
        user_data => #{},
        version => 1,
        token_hash => <<"token">>,
        auth_session_id_hash => <<"auth">>,
        properties => #{},
        status => online,
        afk => false,
        mobile => false,
        ready => undefined,
        seq => Seq
    }.

assert_exits(Pid) ->
    Ref = monitor(process, Pid),
    receive
        {'DOWN', Ref, process, Pid, _} -> ok
    after 1000 ->
        ?assert(false)
    end.
