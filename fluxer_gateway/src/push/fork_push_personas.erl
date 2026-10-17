%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork: personas in push notifications. The API sends a message with the persona it was sent as
%% (`subprofile`) and the personas it mentions (`mention_personas`), as upstream sends the author
%% and the accounts it mentions. What a persona lacks comes from its account, as in the clients.

-module(fork_push_personas).
-typing([eqwalizer]).

-export([mention_names/1, author_name/1, author_icon/2]).

%% Persona ID => name, for the preview's mentions.
-spec mention_names(map()) -> #{binary() => binary()}.
mention_names(MessageData) ->
    case maps:get(<<"mention_personas">>, MessageData, []) of
        Personas when is_list(Personas) -> lists:foldl(fun add_name/2, #{}, Personas);
        _ -> #{}
    end.

%% The name of the persona the message was sent as, or undefined when it was sent as the account.
-spec author_name(map()) -> binary() | undefined.
author_name(MessageData) ->
    case maps:get(<<"subprofile">>, MessageData, null) of
        #{<<"name">> := Name} when is_binary(Name), Name =/= <<>> -> Name;
        _ -> undefined
    end.

%% The notification icon: the persona's picture when the message was sent as one that has a
%% picture, otherwise the account's as upstream gives it.
-spec author_icon(map(), map()) -> binary().
author_icon(MessageData, AuthorData) ->
    case maps:get(<<"subprofile">>, MessageData, null) of
        #{<<"name">> := Name} = Persona when is_binary(Name), Name =/= <<>> ->
            persona_icon(maps:get(<<"avatar">>, Persona, null), AuthorData);
        _ ->
            push_notification_format:resolve_author_avatar_url(AuthorData)
    end.

-spec persona_icon(term(), map()) -> binary().
persona_icon(<<"https://", _/binary>> = Url, _AuthorData) ->
    Url;
persona_icon(<<"http://", _/binary>> = Url, _AuthorData) ->
    Url;
persona_icon(<<"data:", _/binary>>, AuthorData) ->
    persona_icon(null, AuthorData);
persona_icon(Hash, AuthorData) when is_binary(Hash), Hash =/= <<>> ->
    push_notification_format:resolve_author_avatar_url(AuthorData#{<<"avatar">> => Hash});
persona_icon(_Hash, AuthorData) ->
    push_notification_format:resolve_author_avatar_url(AuthorData).

-spec add_name(term(), #{binary() => binary()}) -> #{binary() => binary()}.
add_name(#{<<"id">> := Id, <<"name">> := Name}, Acc) when
    is_binary(Id), is_binary(Name), Name =/= <<>>
->
    Acc#{Id => Name};
add_name(_, Acc) ->
    Acc.
