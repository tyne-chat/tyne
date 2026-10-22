%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork (tyne-chat/tyne#196): a session's new process takes over its guild entry
%% (fork_guild_session_rebind).

-module(fork_guild_session_rebind_tests).
-include_lib("eunit/include/eunit.hrl").

-define(SESSION, <<"s1">>).

a_new_process_takes_over_the_entry_test() ->
    Old = spawn_idle(),
    New = spawn_idle(),
    OldRef = monitor(process, Old),
    State0 = state(Old, OldRef),
    State1 = fork_guild_session_rebind:rebind(?SESSION, New, State0),
    #{?SESSION := #{pid := Pid, mref := NewRef, user_id := 7}} = maps:get(sessions, State1),
    ?assertEqual(New, Pid),
    ?assertEqual(#{NewRef => ?SESSION}, maps:get(guild_session_refs, State1)),
    %% The old process's exit is no longer reported; the new one's is.
    Old ! stop,
    New ! stop,
    receive
        {'DOWN', NewRef, process, New, _} -> ok
    after 1000 -> error(no_down)
    end,
    receive
        {'DOWN', OldRef, process, Old, _} -> error(old_down_reported)
    after 0 -> ok
    end.

a_rebound_entry_loses_the_carried_over_mark_test() ->
    Old = spawn_idle(),
    New = spawn_idle(),
    #{sessions := Sessions0} = State0 = state(Old, monitor(process, Old)),
    Marked = State0#{
        sessions := Sessions0#{
            ?SESSION := (maps:get(?SESSION, Sessions0))#{fork_carried_over => true}
        }
    },
    #{sessions := #{?SESSION := Entry}} = fork_guild_session_rebind:rebind(
        ?SESSION, New, Marked
    ),
    ?assertNot(maps:is_key(fork_carried_over, Entry)),
    Old ! stop,
    New ! stop.

the_same_process_changes_nothing_test() ->
    Old = spawn_idle(),
    State0 = state(Old, monitor(process, Old)),
    ?assertEqual(State0, fork_guild_session_rebind:rebind(?SESSION, Old, State0)),
    Old ! stop.

an_unknown_session_changes_nothing_test() ->
    Old = spawn_idle(),
    State0 = state(Old, monitor(process, Old)),
    ?assertEqual(State0, fork_guild_session_rebind:rebind(<<"other">>, spawn_idle(), State0)),
    Old ! stop.

state(Pid, Ref) ->
    #{
        sessions => #{
            ?SESSION => #{session_id => ?SESSION, user_id => 7, pid => Pid, mref => Ref}
        },
        guild_session_refs => #{Ref => ?SESSION}
    }.

spawn_idle() ->
    spawn(fun() ->
        receive
            stop -> ok
        end
    end).
