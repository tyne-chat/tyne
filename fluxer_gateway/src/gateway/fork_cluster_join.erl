%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a gateway node that starts beside other gateway nodes owns nothing and
%% takes no requests from the API until it has started and joined them.
%%
%% The API reaches the gateway over NATS, with every node in one queue group. Upstream subscribes
%% as soon as NATS connects, before the cluster processes start (fluxer_gateway_sup), so a node
%% started beside a running one answers requests for a moment as if it were alone: it owns every
%% guild, does not have them, and loads fresh copies with no sessions, which then receive the
%% guild's events instead of the real ones (and the handoff adopts them, see
%% guild_manager_shard_lifecycle:start_transferred_guild/3). Here, with clustering on and other
%% nodes named in DNS (or as static peers), the node starts with upstream's RPC subscription off
%% (nats_rpc_enabled, as FLUXER_GATEWAY_NATS_RPC_ENABLED=false would) and turns it on through
%% upstream's switch (gateway_nats_rpc:enable_rpc_subscription/0) once it has joined them, or after
%% JOIN_LIMIT_MS at the latest. A node that starts alone subscribes at once, as upstream does.
%%
%% Its peers also route to it as soon as it connects, before its guild and session managers run
%% (the cluster processes start first), and requests they route there fail (the API answers 403).
%% So until it has started (its HTTP listener, started last, is up) the node counts as draining,
%% here and on each peer as it connects (fork_gateway_drain), and owns nothing.

-module(fork_cluster_join).
-typing([eqwalizer]).

-export([defer_rpc_until_joined/0, other_addresses/2]).

-define(JOIN_POLL_MS, 100).
-define(JOIN_LIMIT_MS, 30000).

-spec defer_rpc_until_joined() -> ok.
defer_rpc_until_joined() ->
    case should_defer() of
        true ->
            _ = fluxer_gateway_env:update(fun(Config) -> Config#{nats_rpc_enabled => false} end),
            ok = fork_gateway_drain:mark_self_starting(),
            logger:info("fork: other gateway nodes found; taking API requests once joined"),
            Deadline = now_ms() + ?JOIN_LIMIT_MS,
            _ = spawn(fun() -> watch_start(Deadline) end),
            ok;
        false ->
            ok
    end.

-spec should_defer() -> boolean().
should_defer() ->
    fluxer_gateway_env:get(nats_rpc_enabled) =/= false andalso
        fluxer_gateway_env:get(cluster_enabled) =:= true andalso
        others_expected().

-spec others_expected() -> boolean().
others_expected() ->
    case fluxer_gateway_env:get(cluster_static_peers) of
        [_ | _] -> true;
        _ -> others_in_dns(fluxer_gateway_env:get(cluster_discovery_dns_name))
    end.

-spec others_in_dns(term()) -> boolean().
others_in_dns([_ | _] = DnsName) ->
    case inet:getaddrs(DnsName, inet) of
        {ok, Addrs} -> other_addresses(Addrs, own_address()) =/= [];
        {error, _} -> false
    end;
others_in_dns(_) ->
    false.

%% The addresses that are not this node's.
-spec other_addresses([inet:ip_address()], {ok, inet:ip_address()} | error) ->
    [inet:ip_address()].
other_addresses(Addrs, {ok, Own}) ->
    [Addr || Addr <- Addrs, Addr =/= Own];
other_addresses(Addrs, error) ->
    Addrs.

%% From the node name, fluxer_gateway@<address>, as discovery names the nodes.
-spec own_address() -> {ok, inet:ip_address()} | error.
own_address() ->
    case string:split(atom_to_list(node()), "@") of
        [_Name, Host] ->
            case inet:parse_address(Host) of
                {ok, Addr} -> {ok, Addr};
                {error, _} -> error
            end;
        _ ->
            error
    end.

%% Tells every peer, as it connects, that this node owns nothing yet; once the node has started
%% and joined, takes that back and subscribes.
-spec watch_start(integer()) -> ok.
watch_start(Deadline) ->
    ok = net_kernel:monitor_nodes(true),
    lists:foreach(fun announce_starting/1, nodes()),
    watch_start_loop(Deadline).

-spec watch_start_loop(integer()) -> ok.
watch_start_loop(Deadline) ->
    receive
        {nodeup, Peer} ->
            announce_starting(Peer),
            watch_start_loop(Deadline)
    after ?JOIN_POLL_MS ->
        Ready = started() andalso length(gateway_cluster_membership:members()) > 1,
        case Ready orelse now_ms() >= Deadline of
            true ->
                ok = net_kernel:monitor_nodes(false),
                enable(Ready);
            false ->
                watch_start_loop(Deadline)
        end
    end.

-spec announce_starting(node()) -> ok.
announce_starting(Peer) ->
    _ = rpc:call(Peer, fork_gateway_drain, peer_draining, [node()], ?JOIN_POLL_MS * 10),
    ok.

%% The HTTP listener starts last (fluxer_gateway_app:start/2).
-spec started() -> boolean().
started() ->
    try ranch:get_status(http) of
        running -> true;
        _ -> false
    catch
        _:_ -> false
    end.

-spec enable(boolean()) -> ok.
enable(Ready) ->
    ok = fork_gateway_drain:clear_self_starting(),
    _ = rpc:multicall(
        nodes(), fork_gateway_drain, peer_undrained, [node()], ?JOIN_POLL_MS * 10
    ),
    _ = fluxer_gateway_env:update(fun(Config) -> Config#{nats_rpc_enabled => true} end),
    case Ready of
        true ->
            logger:info("fork: started and joined the gateway cluster; taking API requests");
        false ->
            logger:warning(
                "fork: did not join the gateway cluster in time; taking API requests"
            )
    end,
    enable_subscription(10).

%% gateway_nats_rpc may still be starting.
-spec enable_subscription(non_neg_integer()) -> ok.
enable_subscription(Attempts) ->
    try gateway_nats_rpc:enable_rpc_subscription() of
        _ -> ok
    catch
        _:_ when Attempts > 0 ->
            timer:sleep(?JOIN_POLL_MS),
            enable_subscription(Attempts - 1);
        Class:Reason ->
            logger:error("fork: could not enable the API subscription: ~p:~p", [Class, Reason])
    end.

-spec now_ms() -> integer().
now_ms() ->
    erlang:monotonic_time(millisecond).
