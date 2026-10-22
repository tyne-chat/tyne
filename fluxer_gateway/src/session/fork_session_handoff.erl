%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): moves a session to another gateway node without losing an event.
%%
%% Upstream's drain (session_manager_shard_drain) asks the session for its state (export_state),
%% stores it on the target node and then stops the old process (handoff_fence). Events that reach
%% the old process after the export are not in the exported state, and guilds keep sending to the
%% stopped process until the new one has connected to them, so those events are lost; the client
%% resumes on the new node and never learns it missed them.
%%
%% Here the export turns the old process into a forwarder. It tells its client to reconnect, stops
%% handling anything itself, finds the session's new process on another node (as soon as the drain
%% sends handoff_fence, and by polling until then), and passes every cast and call it receives on
%% to it as the same message: a forwarded call is answered by the new process directly. It stops
%% once it has passed nothing on for a while, by when the guilds and the presence process have
%% switched to the new process, which takes over a session id's entry when it connects (the fork
%% block in guild_connect_async for guilds; presence already does). If no new process turns up,
%% the old one puts what it received back in its mailbox and carries on as before.
%%
%% Upstream's drain is unchanged; only the session's answer to export_state is the fork's.

-module(fork_session_handoff).
-typing([eqwalizer]).

-export([export_and_forward/2]).

-ifdef(TEST).
-export([await_target/3, forward_loop/3, forward/2]).
-endif.

-define(LOOKUP_RPC_TIMEOUT_MS, 1000).
%% How long the old process waits to learn the new one before it gives up and carries on.
-define(TARGET_WAIT_MS, 10000).
-define(TARGET_POLL_MS, 100).
%% The forwarder stops after this long without a message, and after FORWARD_MAX_MS at the latest.
-define(FORWARD_IDLE_MS, 2000).
-define(FORWARD_MAX_MS, 60000).

-type opts() :: #{
    parent := pid() | undefined,
    lookup := fun(() -> pid() | undefined),
    poll_ms := pos_integer(),
    idle_ms := pos_integer()
}.

%% In the old session process, for upstream's export_state call (session:handle_call/3). Replies
%% with the exported state at once, then forwards until done.
-spec export_and_forward(gen_server:from(), map()) ->
    {stop, normal, ok, map()} | {reply, ok, map()}.
export_and_forward(From, State) ->
    gen_server:reply(From, {ok, session_lifecycle:serialize_transfer_state(State)}),
    ok = tell_client_to_reconnect(State),
    SessionId = maps:get(id, State),
    Key = process_registry:build_process_key(session, SessionId),
    Opts = #{
        parent => parent(),
        lookup => fun() -> new_process(SessionId, Key) end,
        poll_ms => ?TARGET_POLL_MS,
        idle_ms => ?FORWARD_IDLE_MS
    },
    case await_target(Opts, [], now_ms() + ?TARGET_WAIT_MS) of
        {found, NewPid, Queue} ->
            %% Lookups now find the new process (registered on its node), not this one.
            ok = process_registry:safe_unregister(Key, self()),
            lists:foreach(fun(Msg) -> _ = forward(NewPid, Msg) end, Queue),
            forwarded = forward_loop(NewPid, Opts, now_ms() + ?FORWARD_MAX_MS),
            {stop, normal, ok, State#{fenced => true}};
        {gave_up, Queue} ->
            logger:warning("fork: session ~ts found no new process; carrying on here", [
                SessionId
            ]),
            lists:foreach(fun(Msg) -> self() ! Msg end, Queue),
            {reply, ok, State}
    end.

-spec tell_client_to_reconnect(map()) -> ok.
tell_client_to_reconnect(#{socket_pid := SocketPid}) when is_pid(SocketPid) ->
    SocketPid ! session_reconnect,
    ok;
tell_client_to_reconnect(_State) ->
    ok.

%% Keeps everything that arrives, in order, until the new process is found. The drain's
%% handoff_fence means the state is stored on the target: look at once.
-spec await_target(opts(), [term()], integer()) ->
    {found, pid(), [term()]} | {gave_up, [term()]}.
await_target(#{parent := Parent, poll_ms := PollMs, lookup := Lookup} = Opts, Queue, Deadline) ->
    receive
        {'$gen_cast', handoff_fence} ->
            look(Opts, Queue, Deadline, Lookup());
        {'EXIT', Parent, Reason} when is_pid(Parent) ->
            exit(Reason);
        Msg ->
            await_target(Opts, [Msg | Queue], Deadline)
    after PollMs ->
        look(Opts, Queue, Deadline, Lookup())
    end.

-spec look(opts(), [term()], integer(), pid() | undefined) ->
    {found, pid(), [term()]} | {gave_up, [term()]}.
look(_Opts, Queue, _Deadline, NewPid) when is_pid(NewPid) ->
    {found, NewPid, lists:reverse(Queue)};
look(Opts, Queue, Deadline, _NotFound) ->
    case now_ms() >= Deadline of
        true -> {gave_up, lists:reverse(Queue)};
        false -> await_target(Opts, Queue, Deadline)
    end.

-spec forward_loop(pid(), opts(), integer()) -> forwarded.
forward_loop(NewPid, #{idle_ms := IdleMs} = Opts, StopAt) ->
    forward_loop(NewPid, Opts, StopAt, now_ms() + IdleMs).

%% Only a message that is passed on counts as traffic; the old process's own timers and monitors
%% do not keep it alive.
-spec forward_loop(pid(), opts(), integer(), integer()) -> forwarded.
forward_loop(NewPid, #{parent := Parent, idle_ms := IdleMs} = Opts, StopAt, IdleAt) ->
    Wait = max(0, min(IdleAt, StopAt) - now_ms()),
    receive
        {'EXIT', Parent, Reason} when is_pid(Parent) ->
            exit(Reason);
        Msg ->
            case forward(NewPid, Msg) of
                forwarded -> forward_loop(NewPid, Opts, StopAt, now_ms() + IdleMs);
                ok -> forward_loop(NewPid, Opts, StopAt, IdleAt)
            end
    after Wait ->
        forwarded
    end.

%% Casts and calls go on unchanged; what belongs to the old process (monitors, timers, system
%% messages) and the drain's own requests do not.
-spec forward(pid(), term()) -> forwarded | ok.
forward(_NewPid, {'$gen_cast', handoff_fence}) ->
    ok;
forward(_NewPid, {'$gen_cast', reconnect_drain}) ->
    ok;
forward(_NewPid, {'$gen_cast', {reconnect_drain, _}}) ->
    ok;
forward(NewPid, {'$gen_cast', _} = Msg) ->
    NewPid ! Msg,
    forwarded;
forward(_NewPid, {'$gen_call', _From, export_state}) ->
    ok;
%% A RESUME that found this process (sent before it was unregistered): the new process takes the
%% client, but the client's connection stays bound to this process, which is about to stop, and
%% would then report the session as ended. So the connection is also told to reconnect; it handles
%% that after the RESUME's reply, and the next RESUME finds the new process.
forward(NewPid, {'$gen_call', _From, {resume, _Seq, SocketPid}} = Msg) when is_pid(SocketPid) ->
    NewPid ! Msg,
    SocketPid ! session_reconnect,
    forwarded;
forward(NewPid, {'$gen_call', _From, _Request} = Msg) ->
    NewPid ! Msg,
    forwarded;
forward(_NewPid, _Msg) ->
    ok.

%% The session's process on another node: started there now if its state is waiting
%% (fork_session_transfer_start:started_pid/1), else whatever is registered under its id.
-spec new_process(binary(), process_registry:process_key()) -> pid() | undefined.
new_process(SessionId, _Key) ->
    {Replies, _BadNodes} = rpc:multicall(
        nodes(), fork_session_transfer_start, started_pid, [SessionId], ?LOOKUP_RPC_TIMEOUT_MS
    ),
    first_pid(Replies).

-spec first_pid([term()]) -> pid() | undefined.
first_pid([{ok, Pid} | _]) when is_pid(Pid) -> Pid;
first_pid([_ | Rest]) -> first_pid(Rest);
first_pid([]) -> undefined.

-spec parent() -> pid() | undefined.
parent() ->
    case get('$ancestors') of
        [Parent | _] when is_pid(Parent) -> Parent;
        [Name | _] when is_atom(Name) -> registered_pid(whereis(Name));
        _ -> undefined
    end.

-spec registered_pid(pid() | port() | undefined) -> pid() | undefined.
registered_pid(Pid) when is_pid(Pid) -> Pid;
registered_pid(_) -> undefined.

-spec now_ms() -> integer().
now_ms() ->
    erlang:monotonic_time(millisecond).
