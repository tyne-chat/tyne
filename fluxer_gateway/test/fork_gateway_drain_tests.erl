%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): draining nodes own nothing (fork_gateway_drain).

-module(fork_gateway_drain_tests).
-include_lib("eunit/include/eunit.hrl").

-define(OLD, 'fluxer_gateway@10.0.0.1').
-define(NEW, 'fluxer_gateway@10.0.0.2').

no_draining_node_keeps_every_owner_test() ->
    ?assertEqual([?OLD, ?NEW], fork_gateway_drain:owners([?OLD, ?NEW], [])).

a_draining_node_is_left_out_test() ->
    ?assertEqual([?NEW], fork_gateway_drain:owners([?OLD, ?NEW], [?OLD])).

the_last_node_owns_even_while_draining_test() ->
    ?assertEqual([?OLD], fork_gateway_drain:owners([?OLD], [?OLD])),
    ?assertEqual([?OLD, ?NEW], fork_gateway_drain:owners([?OLD, ?NEW], [?OLD, ?NEW])).

%% Through upstream's owner selection: with this node draining, every key goes to the other one.
a_draining_node_owns_no_key_test() ->
    Previous = persistent_term:get({fluxer_gateway, draining}, undefined),
    persistent_term:put({fluxer_gateway, draining}, true),
    try
        Nodes = [node(), ?NEW],
        Owners = [gateway_node_router:select_owner_node(Key, Nodes) || Key <- lists:seq(1, 50)],
        ?assertEqual([?NEW], lists:usort(Owners)),
        ?assertEqual(node(), gateway_node_router:select_owner_node(1, [node()]))
    after
        restore(Previous)
    end.

without_a_drain_keys_spread_over_both_nodes_test() ->
    Previous = persistent_term:get({fluxer_gateway, draining}, undefined),
    persistent_term:erase({fluxer_gateway, draining}),
    try
        Nodes = [node(), ?NEW],
        Owners = [gateway_node_router:select_owner_node(Key, Nodes) || Key <- lists:seq(1, 50)],
        ?assertEqual(lists:usort(Nodes), lists:usort(Owners))
    after
        restore(Previous)
    end.

restore(undefined) -> persistent_term:erase({fluxer_gateway, draining});
restore(Value) -> persistent_term:put({fluxer_gateway, draining}, Value).

a_node_alone_finds_nothing_elsewhere_test() ->
    ?assertEqual(none, fork_gateway_drain:live_elsewhere({guild, 1})).

a_starting_node_owns_no_key_test() ->
    ok = fork_gateway_drain:mark_self_starting(),
    try
        ?assertEqual(['fluxer_gateway@10.0.0.2'], fork_gateway_drain:owners([node(), ?NEW]))
    after
        fork_gateway_drain:clear_self_starting()
    end,
    ?assertEqual([node(), ?NEW], fork_gateway_drain:owners([node(), ?NEW])).

with_another_member_clients_are_not_told_early_test() ->
    Key = {gateway_cluster_membership, members},
    Previous = persistent_term:get(Key, undefined),
    persistent_term:put(Key, [node(), ?NEW]),
    try
        ?assertEqual(skipped, fork_gateway_drain:reconnect_drain())
    after
        case Previous of
            undefined -> persistent_term:erase(Key);
            _ -> persistent_term:put(Key, Previous)
        end
    end.

%% A drain while a rebalance is in flight waits for it (upstream's guard matched only a tuple).
a_drain_during_a_handoff_does_not_start_another_test() ->
    Handoff = #{
        pid => self(),
        ref => make_ref(),
        timer => make_ref(),
        members => [],
        role_members => #{}
    },
    State0 = #{
        members => [node()],
        role_members => #{},
        pending_members => undefined,
        timer => undefined,
        reconcile_timer => undefined,
        handoff => Handoff,
        last_result => #{}
    },
    {noreply, State1} = gateway_cluster_handoff:handle_cast(drain, State0),
    ?assertEqual(Handoff, maps:get(handoff, State1)),
    ?assertNotEqual(undefined, maps:get(pending_members, State1)).

%% Alone, a draining node keeps taking API requests; it switches them off only with somewhere
%% to hand over to, and switches them back on when the drain is withdrawn.
alone_the_api_subscription_is_left_on_test() ->
    with_members([node()], fun() ->
        ok = fork_gateway_drain:announce(),
        ?assertEqual(false, persistent_term:get({fork_gateway_drain, rpc_off}, false))
    end).

with_another_node_the_api_subscription_goes_off_and_back_on_test() ->
    with_members([node(), ?NEW], fun() ->
        ok = fork_gateway_drain:announce(),
        ?assertEqual(true, persistent_term:get({fork_gateway_drain, rpc_off}, false)),
        ok = fork_gateway_drain:withdraw(),
        ?assertEqual(false, persistent_term:get({fork_gateway_drain, rpc_off}, false))
    end).

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
