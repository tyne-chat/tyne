%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a node beside others takes API requests once joined
%% (fork_cluster_join).

-module(fork_cluster_join_tests).
-include_lib("eunit/include/eunit.hrl").

-define(NEW, 'fluxer_gateway@10.0.0.2').

own_address_is_not_another_node_test() ->
    ?assertEqual(
        [{10, 0, 0, 2}],
        fork_cluster_join:other_addresses([{10, 0, 0, 1}, {10, 0, 0, 2}], {ok, {10, 0, 0, 1}})
    ),
    ?assertEqual([], fork_cluster_join:other_addresses([{10, 0, 0, 1}], {ok, {10, 0, 0, 1}})).

without_an_own_address_every_address_counts_test() ->
    ?assertEqual([{10, 0, 0, 1}], fork_cluster_join:other_addresses([{10, 0, 0, 1}], error)).

without_clustering_the_subscription_is_left_alone_test() ->
    with_config(#{cluster_enabled => false, nats_rpc_enabled => true}, fun() ->
        ok = fork_cluster_join:defer_rpc_until_joined(),
        ?assertEqual(true, fluxer_gateway_env:get(nats_rpc_enabled))
    end).

a_node_with_no_other_peers_subscribes_at_once_test() ->
    Config = #{
        cluster_enabled => true,
        nats_rpc_enabled => true,
        cluster_static_peers => [],
        cluster_discovery_dns_name => undefined
    },
    with_config(Config, fun() ->
        ok = fork_cluster_join:defer_rpc_until_joined(),
        ?assertEqual(true, fluxer_gateway_env:get(nats_rpc_enabled))
    end).

%% A DNS failure at start is no reason to wait: the node starts as if alone. The name is one no
%% resolver accepts, so the test asks no DNS server.
a_dns_name_that_does_not_resolve_leaves_the_subscription_alone_test() ->
    Config = #{
        cluster_enabled => true,
        nats_rpc_enabled => true,
        cluster_static_peers => [],
        cluster_discovery_dns_name => "no such gateway"
    },
    with_config(Config, fun() ->
        ok = fork_cluster_join:defer_rpc_until_joined(),
        ?assertEqual(true, fluxer_gateway_env:get(nats_rpc_enabled)),
        ?assertEqual([node(), ?NEW], fork_gateway_drain:owners([node(), ?NEW]))
    end).

%% The order of a deploy: the new node has joined the old one (cluster processes start first),
%% then its HTTP listener comes up last. Until then it takes no API requests and owns nothing;
%% then it owns again and subscribes, through upstream's switch (gateway_nats_rpc).
a_node_beside_others_takes_api_requests_once_started_test() ->
    Config = #{
        cluster_enabled => true,
        nats_rpc_enabled => true,
        cluster_static_peers => [?NEW],
        cluster_discovery_dns_name => undefined
    },
    with_config(Config, fun() ->
        with_members([node(), ?NEW], fun() ->
            with_stub(gateway_nats_rpc, fun answering/1, fun() ->
                ok = fork_cluster_join:defer_rpc_until_joined(),
                ?assertEqual(false, fluxer_gateway_env:get(nats_rpc_enabled)),
                ?assertEqual([?NEW], fork_gateway_drain:owners([node(), ?NEW])),
                with_http_listener(fun() ->
                    ?assertEqual(enable_rpc_subscription, next_call()),
                    ?assertEqual(true, fluxer_gateway_env:get(nats_rpc_enabled)),
                    ?assertEqual([node(), ?NEW], fork_gateway_drain:owners([node(), ?NEW]))
                end)
            end)
        end)
    end).

%% Other nodes found in DNS count as well (an address that is not this node's: here the node has
%% no address of its own). gateway_nats_rpc may still be starting when the node is ready: a
%% failed switch is tried again.
a_failed_subscription_is_tried_again_test() ->
    Config = #{
        cluster_enabled => true,
        nats_rpc_enabled => true,
        cluster_static_peers => [],
        cluster_discovery_dns_name => "10.0.0.2"
    },
    with_config(Config, fun() ->
        with_members([node(), ?NEW], fun() ->
            with_stub(gateway_nats_rpc, fun failing_once/1, fun() ->
                with_http_listener(fun() ->
                    ok = fork_cluster_join:defer_rpc_until_joined(),
                    ?assertEqual({refused, enable_rpc_subscription}, next_call()),
                    ?assertEqual(enable_rpc_subscription, next_call()),
                    ?assertEqual(true, fluxer_gateway_env:get(nats_rpc_enabled))
                end)
            end)
        end)
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

with_members(Members, Fun) ->
    Key = {gateway_cluster_membership, members},
    Previous = persistent_term:get(Key, undefined),
    persistent_term:put(Key, Members),
    try
        Fun()
    after
        case Previous of
            undefined -> persistent_term:erase(Key);
            _ -> persistent_term:put(Key, Previous)
        end
    end.

%% The listener fork_cluster_join waits for (ranch's `http`, which fluxer_gateway_app starts last),
%% on a free local port.
with_http_listener(Fun) ->
    {ok, Started} = application:ensure_all_started(ranch),
    {ok, _} = ranch:start_listener(
        http, ranch_tcp, #{socket_opts => [{ip, {127, 0, 0, 1}}, {port, 0}]}, cowboy_clear, #{}
    ),
    try
        Fun()
    after
        ok = ranch:stop_listener(http),
        lists:foreach(fun application:stop/1, lists:reverse(Started))
    end.

%% A process registered as Name, standing in for one of upstream's servers. Behaviour decides
%% how it handles each gen_server call, and it tells the test about each one first.
with_stub(Name, Behaviour, Fun) ->
    Test = self(),
    true = register(Name, spawn(fun() -> Behaviour(Test) end)),
    try
        Fun()
    after
        stop(whereis(Name))
    end.

answering(Test) ->
    receive
        {'$gen_call', From, Request} ->
            Test ! {stub_called, Request},
            gen_server:reply(From, ok),
            answering(Test);
        stop ->
            ok
    end.

%% Exits on the first call, as a server that is not up yet would, with an answering stub in its
%% place under the same name.
failing_once(Test) ->
    receive
        {'$gen_call', _From, Request} ->
            {registered_name, Name} = process_info(self(), registered_name),
            true = unregister(Name),
            true = register(Name, spawn(fun() -> answering(Test) end)),
            Test ! {stub_called, {refused, Request}},
            exit(not_started);
        stop ->
            ok
    end.

next_call() ->
    receive
        {stub_called, Request} -> Request
    after 4000 -> error(no_call)
    end.

stop(undefined) ->
    ok;
stop(Pid) ->
    Ref = monitor(process, Pid),
    Pid ! stop,
    receive
        {'DOWN', Ref, process, Pid, _} -> ok
    after 4000 -> error(not_stopped)
    end.
