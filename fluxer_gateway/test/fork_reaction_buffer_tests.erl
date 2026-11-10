%% SPDX-License-Identifier: AGPL-3.0-or-later

-module(fork_reaction_buffer_tests).
-typing([eqwalizer]).
-include_lib("eunit/include/eunit.hrl").

%% Personas in session_dispatch_voice's reaction buffer (tyne-chat/tyne#120): adds sent together
%% as MESSAGE_REACTION_ADD_MANY keep their persona, and a remove cancels only the buffered add of
%% the same persona.

add(PersonaId) ->
    Base = #{
        <<"channel_id">> => <<"10">>,
        <<"message_id">> => <<"20">>,
        <<"user_id">> => <<"30">>,
        <<"emoji">> => #{<<"id">> => null, <<"name">> => <<"🦊"/utf8>>}
    },
    case PersonaId of
        undefined ->
            Base;
        _ ->
            Base#{
                <<"persona_id">> => PersonaId,
                <<"subprofile">> => #{<<"id">> => PersonaId, <<"name">> => <<"Fox">>}
            }
    end.

remove(PersonaId) ->
    maps:remove(<<"subprofile">>, add(PersonaId)).

%% Each buffer also starts the session's 650 ms flush timer; a test that never flushes leaves its
%% message in the test process's mailbox, which nothing reads.
buffered(Adds) ->
    lists:foldl(
        fun(Add, State) -> session_dispatch_voice:buffer_reaction(Add, State) end,
        #{debounce_reactions => true},
        Adds
    ).

%% What the session sends when the buffer is flushed.
flushed(State) ->
    Self = self(),
    Dispatch = fun(Event, Data, S) ->
        Self ! {dispatched, Event, Data},
        {noreply, S}
    end,
    _ = session_dispatch_voice:flush_reaction_buffer(Dispatch, State),
    receive
        {dispatched, Event, Data} -> {Event, Data}
    after 1000 -> erlang:error(nothing_dispatched)
    end.

adds_sent_together_keep_their_personas_test() ->
    {Event, Data} = flushed(buffered([add(<<"1">>), add(<<"2">>), add(undefined)])),
    ?assertEqual(message_reaction_add_many, Event),
    [Fox, Bao, Account] = maps:get(<<"reactions">>, Data),
    ?assertEqual(<<"1">>, maps:get(<<"persona_id">>, Fox)),
    ?assertEqual(<<"1">>, maps:get(<<"id">>, maps:get(<<"subprofile">>, Fox))),
    ?assertEqual(<<"2">>, maps:get(<<"persona_id">>, Bao)),
    ?assertEqual(<<"30">>, maps:get(<<"user_id">>, Account)),
    ?assertNot(maps:is_key(<<"persona_id">>, Account)),
    ?assertNot(maps:is_key(<<"subprofile">>, Account)),
    ok.

a_remove_cancels_the_add_of_the_same_persona_test() ->
    State = buffered([add(<<"1">>)]),
    {cancelled, After} =
        session_dispatch_voice:maybe_cancel_buffered_reaction(
            message_reaction_remove, remove(<<"1">>), State
        ),
    ?assertEqual(0, queue:len(maps:get(reaction_buffer, After))),
    ok.

a_remove_leaves_the_add_of_another_persona_test() ->
    State = buffered([add(<<"1">>)]),
    ?assertEqual(
        not_applicable,
        session_dispatch_voice:maybe_cancel_buffered_reaction(
            message_reaction_remove, remove(<<"2">>), State
        )
    ),
    ok.

the_account_and_its_personas_do_not_cancel_each_other_test() ->
    PersonaAdd = buffered([add(<<"1">>)]),
    AccountAdd = buffered([add(undefined)]),
    ?assertEqual(
        not_applicable,
        session_dispatch_voice:maybe_cancel_buffered_reaction(
            message_reaction_remove, remove(undefined), PersonaAdd
        )
    ),
    ?assertEqual(
        not_applicable,
        session_dispatch_voice:maybe_cancel_buffered_reaction(
            message_reaction_remove, remove(<<"1">>), AccountAdd
        )
    ),
    {cancelled, _} =
        session_dispatch_voice:maybe_cancel_buffered_reaction(
            message_reaction_remove, remove(undefined), AccountAdd
        ),
    ok.
