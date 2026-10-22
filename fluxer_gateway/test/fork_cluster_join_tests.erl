%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a node beside others takes API requests once joined
%% (fork_cluster_join).

-module(fork_cluster_join_tests).
-include_lib("eunit/include/eunit.hrl").

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
