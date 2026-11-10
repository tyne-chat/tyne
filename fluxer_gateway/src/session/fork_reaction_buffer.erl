%% SPDX-License-Identifier: AGPL-3.0-or-later

-module(fork_reaction_buffer).
-typing([eqwalizer]).

%% Fork: personas in the reaction buffer of session_dispatch_voice (tyne-chat/tyne#120).
%%
%% A reaction can come from one of the account's personas: the API puts `persona_id` and the
%% persona's `subprofile` on MESSAGE_REACTION_ADD and `persona_id` on MESSAGE_REACTION_REMOVE.
%% Upstream's buffer knows only the user. Without these two helpers, several adds sent together as
%% MESSAGE_REACTION_ADD_MANY lose their persona, and removing one persona's reaction can cancel the
%% buffered add of another persona of the same account.

-export([with_persona/2, reactor/1]).

%% Copies the persona of a buffered MESSAGE_REACTION_ADD into its MESSAGE_REACTION_ADD_MANY entry.
-spec with_persona(map(), map()) -> map().
with_persona(Entry, Reaction) ->
    lists:foldl(
        fun(Key, Acc) ->
            case maps:get(Key, Entry, undefined) of
                undefined -> Acc;
                null -> Acc;
                Value -> Acc#{Key => Value}
            end
        end,
        Reaction,
        [<<"persona_id">>, <<"subprofile">>]
    ).

%% Who reacted: the user and, for a persona's reaction, the persona. The account's own reaction
%% carries no persona (the API leaves `persona_id` out for it).
-spec reactor(map()) -> {term(), term()}.
reactor(Data) ->
    PersonaId =
        case maps:get(<<"persona_id">>, Data, undefined) of
            null -> undefined;
            <<"0">> -> undefined;
            Id -> Id
        end,
    {maps:get(<<"user_id">>, Data, undefined), PersonaId}.
