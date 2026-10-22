%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): starts a session handed over from another gateway node as soon as
%% its state arrives, instead of when its client resumes.
%%
%% Upstream's handoff exports a session on the node being drained, stops it, and stores the state
%% on the target node (session_state_transfer); the target starts the session only when the client
%% sends RESUME. Nothing holds the session in between, so every event dispatched to it while its
%% client reconnects is lost, and the RESUME replays nothing: the client never learns it missed
%% them. Started at once, the session rejoins its guilds and presence and keeps what they send in
%% its replay buffer, as a session whose socket dropped does.
%%
%% The session is started with a socket process that has already exited, so it takes upstream's
%% own path for a dropped socket (session_monitor:hold_session_for_resume/1): held for the resume
%% timeout and shown offline after five seconds without a client. A RESUME that arrives first takes
%% the state through upstream's rehydrate path, and the start here finds nothing left to start.

-module(fork_session_transfer_start).
-typing([eqwalizer]).

-export([start_received/1, started_pid/1, handle_shard_start/2, start_session/4]).

-define(START_TIMEOUT_MS, 5000).

-type session_id() :: binary().

%% Called by session_state_transfer once it stored the state. Asynchronous: the shard pops the
%% state from session_state_transfer, which must not be waiting on the shard meanwhile.
-spec start_received(session_id()) -> ok.
start_received(SessionId) when is_binary(SessionId) ->
    _ = spawn(fun() ->
        try
            session_manager_routing:call_shard(
                SessionId, {fork_start_transferred, SessionId}, ?START_TIMEOUT_MS
            )
        catch
            Class:Reason ->
                logger:warning("fork: transferred session ~ts not started: ~p:~p", [
                    SessionId, Class, Reason
                ])
        end
    end),
    ok;
start_received(_SessionId) ->
    ok.

%% Called over rpc by the old session process on the node handing it over (fork_session_handoff):
%% the session's process on this node, started now if its state is still waiting.
-spec started_pid(session_id()) -> {ok, pid()} | {error, not_found}.
started_pid(SessionId) when is_binary(SessionId) ->
    case
        session_manager_routing:call_shard(
            SessionId, {fork_start_transferred, SessionId}, ?START_TIMEOUT_MS
        )
    of
        {success, Pid} when is_pid(Pid) ->
            {ok, Pid};
        _ ->
            Key = process_registry:build_process_key(session, SessionId),
            case process_registry:registry_whereis(Key) of
                Pid when is_pid(Pid) -> {ok, Pid};
                _ -> {error, not_found}
            end
    end.

%% Runs in the session's shard (session_manager_shard:handle_call/3).
-spec handle_shard_start(session_id(), map()) -> {term(), map()}.
handle_shard_start(SessionId, State) ->
    start_session(
        SessionId,
        fun session_state_transfer:pop_state/1,
        fun session_manager_shard_lifecycle:start_session_process/4,
        State
    ).

%% The steps of handle_shard_start/2, with the state store and the process start passed in so a
%% test can stand in for them.
-spec start_session(
    session_id(),
    fun((session_id()) -> {ok, map()} | {error, not_found}),
    fun((map(), session_id(), map(), State) -> {reply, term(), State}),
    State
) -> {term(), State} when State :: map().
start_session(SessionId, PopState, StartProcess, State) ->
    case PopState(SessionId) of
        {ok, TransferState} when is_map(TransferState) ->
            SessionData = TransferState#{id => SessionId, socket_pid => exited_socket()},
            Sessions = maps:get(sessions, State),
            {reply, Reply, NewState} = StartProcess(SessionData, SessionId, Sessions, State),
            log_start(SessionId, Reply),
            {Reply, NewState};
        _ ->
            {{error, not_found}, State}
    end.

-spec exited_socket() -> pid().
exited_socket() ->
    spawn(fun() -> ok end).

-spec log_start(session_id(), term()) -> ok.
log_start(_SessionId, {success, _Pid}) ->
    ok;
log_start(SessionId, Reply) ->
    logger:warning("fork: transferred session ~ts did not start: ~p", [SessionId, Reply]).
