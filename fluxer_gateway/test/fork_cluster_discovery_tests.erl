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
