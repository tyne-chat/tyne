%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): options for upstream's guild transfer (guild_handoff_freeze) that
%% point every node's guild pid cache at the guild's new process as soon as it starts.
%%
%% Each node caches guild pids (gateway_rpc_guild_infra, table guild_pid_cache), and dispatches
%% from the API are cast to the cached pid. A cached pid on another node counts as alive while that
%% node is connected (is_cached_guild_pid_alive/1), so after a guild moved, a node that had cached
%% its old process kept casting events to it after it stopped, until the old node left: every user
%% missed those events, and a session that resumed never learned it. Upstream's transfer has hooks
%% for this (after_start, on_abort) that its caller leaves empty. Events already queued at the old
%% process are captured and forwarded by the transfer itself.

-module(fork_guild_handoff).
-typing([eqwalizer]).

-export([transfer_opts/2, point_caches/2, mark_carried_over/1]).

-define(CACHE_RPC_TIMEOUT_MS, 5000).

-spec transfer_opts(integer(), pid()) -> guild_handoff_freeze:opts().
transfer_opts(GuildId, SrcPid) ->
    #{
        after_start => fun(NewPid) -> point_caches(GuildId, NewPid) end,
        on_abort => fun() -> point_caches(GuildId, SrcPid) end
    }.

%% Sets the guild's cached pid on every connected gateway node. Best effort: a node that does not
%% answer finds the pid through its owner lookup once its cached one is gone.
-spec point_caches(integer(), pid()) -> ok.
point_caches(GuildId, Pid) ->
    _ = rpc:multicall(
        [node() | nodes()],
        gateway_rpc_guild_infra,
        cache_guild_pid,
        [GuildId, Pid],
        ?CACHE_RPC_TIMEOUT_MS
    ),
    ok.

%% The connected sessions in a guild's transferred state are marked, so that their first
%% connect to the guild's new process does not take them out of its dispatches while the connect
%% worker runs (guild_connect_async's fork block; upstream marks them pending_connect).
-spec mark_carried_over(map()) -> map().
mark_carried_over(#{sessions := Sessions} = GuildState) when is_map(Sessions) ->
    GuildState#{sessions := maps:map(fun mark_session/2, Sessions)};
mark_carried_over(GuildState) ->
    GuildState.

-spec mark_session(term(), term()) -> term().
mark_session(_SessionId, #{pending_connect := true} = Session) ->
    Session;
mark_session(_SessionId, Session) when is_map(Session) ->
    Session#{fork_carried_over => true};
mark_session(_SessionId, Session) ->
    Session.
