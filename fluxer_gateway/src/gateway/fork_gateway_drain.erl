%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a draining gateway node stops owning anything, on every node.
%%
%% Upstream picks the owner of a session, guild or call by rendezvous hashing over the cluster's
%% members (gateway_node_router:select_owner_node/2), and a draining node stays a member until it
%% leaves. So during a drain, the guilds that hash to the draining node are not handed over
%% (guild_manager_handoff resolves owners over all members and skips those it owns itself) and die
%% with it, and requests for those guilds and sessions are still routed to it: a RESUME for a
%% session it already handed over is answered INVALID_SESSION, and a guild request can start a
%% second copy of the guild there. Here the draining node announces itself to its peers, and owner
%% selection leaves draining nodes out while any other node remains. Lookups of live processes
%% still search every member, so a session not yet handed over is found where it is, and a guild
%% its owner does not have yet is used where it still runs instead of being loaded afresh
%% (live_elsewhere/1, used by guild_manager_shard_lookup).

-module(fork_gateway_drain).
-typing([eqwalizer]).

-export([
    announce/0,
    withdraw/0,
    peer_draining/1,
    peer_undrained/1,
    owners/1,
    owners/2,
    draining_nodes/0,
    live_elsewhere/1,
    mark_self_starting/0,
    clear_self_starting/0,
    reconnect_drain/0
]).

-define(PEERS_KEY, {fork_gateway_drain, draining_peers}).
-define(STARTING_KEY, {fork_gateway_drain, self_starting}).
-define(RPC_OFF_KEY, {fork_gateway_drain, rpc_off}).
-define(RPC_TIMEOUT_MS, 2000).

%% On the draining node, before anything is handed over. With another node to hand over to, the
%% node also leaves the API's NATS queue group (upstream's switch), as it owns nothing any more:
%% no request reaches it while it drains and stops. Alone, it keeps answering.
-spec announce() -> ok.
announce() ->
    _ = rpc:multicall(nodes(), ?MODULE, peer_draining, [node()], ?RPC_TIMEOUT_MS),
    case survivors() of
        [] ->
            ok;
        _ ->
            persistent_term:put(?RPC_OFF_KEY, true),
            safe_rpc_switch(disable_rpc_subscription)
    end.

%% On a node whose drain was cancelled (/_health/undrain).
-spec withdraw() -> ok.
withdraw() ->
    _ = rpc:multicall(nodes(), ?MODULE, peer_undrained, [node()], ?RPC_TIMEOUT_MS),
    case persistent_term:get(?RPC_OFF_KEY, false) of
        true ->
            _ = persistent_term:erase(?RPC_OFF_KEY),
            safe_rpc_switch(enable_rpc_subscription);
        false ->
            ok
    end.

-spec survivors() -> [node()].
survivors() ->
    [Node || Node <- gateway_cluster_membership:members(), Node =/= node()].

-spec safe_rpc_switch(disable_rpc_subscription | enable_rpc_subscription) -> ok.
safe_rpc_switch(Function) ->
    try gateway_nats_rpc:Function() of
        _ -> ok
    catch
        Class:Reason ->
            logger:warning("fork: gateway_nats_rpc:~p failed: ~p:~p", [Function, Class, Reason])
    end.

%% On each peer. The mark lasts until the node disconnects: a node that comes back under the same
%% name (a new container on a reused address) is a different node and owns again.
-spec peer_draining(node()) -> ok.
peer_draining(Node) when is_atom(Node) ->
    update_peers(fun(Peers) -> lists:usort([Node | Peers]) end),
    _ = spawn(fun() -> clear_on_nodedown(Node) end),
    ok.

-spec peer_undrained(node()) -> ok.
peer_undrained(Node) when is_atom(Node) ->
    update_peers(fun(Peers) -> lists:delete(Node, Peers) end),
    ok.

%% The nodes of a list that may own keys: all but the draining ones, unless that leaves none.
-spec owners([node()]) -> [node()].
owners(Nodes) ->
    owners(Nodes, draining_nodes()).

-spec owners([node()], [node()]) -> [node()].
owners(Nodes, []) ->
    Nodes;
owners(Nodes, Draining) ->
    case [Node || Node <- Nodes, not lists:member(Node, Draining)] of
        [] -> Nodes;
        Kept -> Kept
    end.

%% Upstream's drain first tells every client on the node to reconnect, then hands the sessions over.
%% When there is another node to hand them to, each session tells its own client as it moves
%% (fork_session_handoff); the early call only made clients reconnect before their session had
%% moved, to the old process, and then again. Alone, the node does as upstream does.
-spec reconnect_drain() -> {ok, non_neg_integer()} | {error, timeout | unavailable} | skipped.
reconnect_drain() ->
    case survivors() of
        [] -> session_manager:reconnect_drain();
        _Survivors -> skipped
    end.

%% A node that is starting beside others (fork_cluster_join) owns nothing until it has started,
%% like a draining one: its peers are told the same way (peer_draining/1, peer_undrained/1).
-spec draining_nodes() -> [node()].
draining_nodes() ->
    Peers = persistent_term:get(?PEERS_KEY, []),
    case gateway_node_router:is_draining() orelse persistent_term:get(?STARTING_KEY, false) of
        true -> [node() | Peers];
        false -> Peers
    end.

-spec mark_self_starting() -> ok.
mark_self_starting() ->
    persistent_term:put(?STARTING_KEY, true).

-spec clear_self_starting() -> ok.
clear_self_starting() ->
    _ = persistent_term:erase(?STARTING_KEY),
    ok.

%% A process registered under Key on another connected node, if any. Asks nothing on a node that
%% is alone. Used where a node is about to start a guild it owns but does not have: during a drain,
%% and after a node joins, the guild may still run where it was.
-spec live_elsewhere(process_registry:process_key()) -> {ok, pid()} | none.
live_elsewhere(Key) ->
    live_on(nodes(), Key).

-spec live_on([node()], process_registry:process_key()) -> {ok, pid()} | none.
live_on([], _Key) ->
    none;
live_on([Node | Rest], Key) ->
    case rpc:call(Node, process_registry, registry_whereis, [Key], ?RPC_TIMEOUT_MS) of
        Pid when is_pid(Pid) -> {ok, Pid};
        _ -> live_on(Rest, Key)
    end.

-spec clear_on_nodedown(node()) -> ok.
clear_on_nodedown(Node) ->
    true = erlang:monitor_node(Node, true),
    receive
        {nodedown, Node} -> peer_undrained(Node)
    end.

%% persistent_term, read on every owner lookup; written only when a drain starts or ends.
-spec update_peers(fun(([node()]) -> [node()])) -> ok.
update_peers(Fun) ->
    Peers = Fun(persistent_term:get(?PEERS_KEY, [])),
    case Peers of
        [] ->
            _ = persistent_term:erase(?PEERS_KEY),
            ok;
        _ ->
            persistent_term:put(?PEERS_KEY, Peers)
    end.
