%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a session that connects to a guild under an id the guild already has,
%% from a different process, takes over the entry.
%%
%% Upstream's guild keys sessions by session id. When a session moves to another gateway node, its
%% new process connects (guild_connect_async, session_connect_async) while the old one still
%% forwards to it (fork_session_handoff); the guild must send to the new process from then on, and
%% must not drop the session when the old process stops. Called from guild_connect_async's fork
%% block for an entry that is already connected; upstream's presence process does the same for its
%% sessions (presence_session:refresh_existing_session). The old process's monitor is removed, so
%% its exit is not taken for the session's.

-module(fork_guild_session_rebind).
-typing([eqwalizer]).

-export([rebind/3]).

-spec rebind(binary(), pid(), map()) -> map().
rebind(SessionId, Pid, State) ->
    Sessions = maps:get(sessions, State, #{}),
    case maps:get(SessionId, Sessions, undefined) of
        #{pid := Pid} ->
            State;
        #{} = Session ->
            OldRef = maps:get(mref, Session, undefined),
            demonitor_old(OldRef),
            NewRef = monitor(process, Pid),
            Refs = maps:remove(OldRef, maps:get(guild_session_refs, State, #{})),
            Rebound = maps:remove(fork_carried_over, Session#{pid => Pid, mref => NewRef}),
            State#{
                sessions => Sessions#{SessionId => Rebound},
                guild_session_refs => Refs#{NewRef => SessionId}
            };
        _ ->
            State
    end.

-spec demonitor_old(term()) -> ok.
demonitor_old(Ref) when is_reference(Ref) ->
    erlang:demonitor(Ref, [flush]),
    ok;
demonitor_old(_) ->
    ok.
