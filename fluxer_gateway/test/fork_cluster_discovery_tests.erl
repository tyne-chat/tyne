%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a DNS answer naming only this node clears the previous peers
%% without a warning (fork_cluster_discovery).

-module(fork_cluster_discovery_tests).
-include_lib("eunit/include/eunit.hrl").

-define(OLD, 'fluxer_gateway@10.0.0.1').
-define(NEW, 'fluxer_gateway@10.0.0.2').

an_answer_with_only_this_node_has_no_previous_peers_test() ->
    ?assertEqual([], fork_cluster_discovery:previous_peers([{10, 0, 0, 3}], [], [?OLD])).

an_empty_answer_keeps_the_previous_peers_test() ->
    ?assertEqual([?OLD], fork_cluster_discovery:previous_peers([], [], [?OLD])).

an_answer_with_other_nodes_keeps_the_previous_peers_test() ->
    ?assertEqual(
        [?OLD], fork_cluster_discovery:previous_peers([{10, 0, 0, 2}], [?NEW], [?OLD])
    ).

%% Through upstream's poll (gateway_cluster_discovery:handle_info/2). This test node has no address
%% of its own (it is nonode@nohost), so the answer that names only this node is stood in for by
%% an address that upstream turns into no node name (an IPv6 one: colons are not allowed in a
%% node name); like this node's own address, it leaves no other peer.
an_answer_with_no_other_node_is_not_a_resolve_failure_test() ->
    Failures = resolve_failures(),
    {noreply, State} = gateway_cluster_discovery:handle_info(
        poll, discovery_state([{0, 0, 0, 0, 0, 0, 0, 1}])
    ),
    ok = cancel_poll(State),
    ?assertEqual(Failures, resolve_failures()).

%% Upstream's rule for a DNS blip stays: an empty answer keeps the previous peers and counts.
an_empty_answer_is_still_a_resolve_failure_test() ->
    Failures = resolve_failures(),
    {noreply, State} = gateway_cluster_discovery:handle_info(poll, discovery_state([])),
    ok = cancel_poll(State),
    ?assertEqual(Failures + 1, resolve_failures()),
    ?assertEqual([?OLD], maps:get(peers, State)).

discovery_state(Answer) ->
    #{
        dns_name => "gateway.internal",
        node_basename => "fluxer_gateway",
        poll_interval_ms => 60000,
        resolver => fun("gateway.internal") -> {ok, Answer} end,
        static_peers => [],
        peers => [?OLD],
        subscribers => [],
        timer => undefined
    }.

resolve_failures() ->
    maps:get(
        <<"gateway_cluster_discovery_resolve_failures_total">>,
        gateway_cluster_metrics:snapshot()
    ).

%% handle_info/2 schedules the next poll to this process.
cancel_poll(#{timer := Timer}) ->
    _ = erlang:cancel_timer(Timer),
    ok.
