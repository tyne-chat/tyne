%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): what upstream's DNS discovery compares a new answer with.
%%
%% Upstream keeps the previous peers, logs a warning and counts a resolve failure whenever DNS
%% answers with no other node, to ride out a DNS blip. When the answer names this node and nothing
%% else, there was no blip: the other nodes are gone. That is the normal state of Tyne's gateway
%% between deploys (one node; the old one removed after each handoff), where upstream's rule would
%% warn every five seconds until the next deploy. For that answer the previous peers count as none,
%% so the poll goes on without a warning.

-module(fork_cluster_discovery).
-typing([eqwalizer]).

-export([previous_peers/3]).

-spec previous_peers([inet:ip_address()], [node()], [node()]) -> [node()].
previous_peers([_ | _], [], _OldPeers) ->
    [];
previous_peers(_Addrs, _NewPeers, OldPeers) ->
    OldPeers.
