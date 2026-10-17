%% SPDX-License-Identifier: AGPL-3.0-or-later

-module(fork_push_personas_tests).
-typing([eqwalizer]).

-include_lib("eunit/include/eunit.hrl").

-define(AUTHOR, #{
    <<"id">> => <<"1">>, <<"username">> => <<"alice">>, <<"avatar">> => <<"acc0">>
}).

message(Content, Extra) ->
    maps:merge(
        #{
            <<"content">> => Content,
            <<"author">> => ?AUTHOR,
            <<"mentions">> => [#{<<"id">> => <<"1">>, <<"username">> => <<"alice">>}]
        },
        Extra
    ).

preview(MessageData) ->
    Context = push_notification_format:build_markdown_context(MessageData, 0, #{}, #{}),
    push_notification_format:build_content_preview(MessageData, Context).

author_name(MessageData) ->
    push_notification_format:resolve_author_name(MessageData, #{}, <<"fallback">>).

sent_as(Persona) ->
    message(<<"hello">>, #{<<"subprofile">> => Persona}).

a_mentioned_persona_is_named_in_the_preview_test() ->
    Message = message(<<"hi <@1:999>">>, #{
        <<"mention_personas">> => [#{<<"id">> => <<"999">>, <<"name">> => <<"Bob the Fox">>}]
    }),
    ?assertEqual(<<"hi @Bob the Fox">>, preview(Message)).

a_persona_the_message_does_not_name_falls_back_to_the_account_test() ->
    ?assertEqual(<<"hi @alice">>, preview(message(<<"hi <@1:999>">>, #{}))).

the_account_keeps_its_name_in_the_preview_test() ->
    ?assertEqual(<<"hi @alice">>, preview(message(<<"hi <@1>">>, #{}))).

mention_names_ignore_malformed_entries_test() ->
    ?assertEqual(
        #{<<"7">> => <<"Ada">>},
        fork_push_personas:mention_names(#{
            <<"mention_personas">> => [
                #{<<"id">> => <<"7">>, <<"name">> => <<"Ada">>},
                #{<<"id">> => <<"8">>, <<"name">> => <<>>},
                #{<<"id">> => 9, <<"name">> => <<"Number">>},
                not_a_map
            ]
        })
    ),
    ?assertEqual(#{}, fork_push_personas:mention_names(#{<<"mention_personas">> => null})),
    ?assertEqual(#{}, fork_push_personas:mention_names(#{})).

the_title_names_the_persona_a_message_was_sent_as_test() ->
    ?assertEqual(<<"Bob the Fox">>, author_name(sent_as(#{<<"name">> => <<"Bob the Fox">>}))),
    ?assertEqual(<<"alice">>, author_name(sent_as(null))),
    ?assertEqual(<<"alice">>, author_name(message(<<"hello">>, #{}))).

the_icon_is_the_persona_picture_test() ->
    AccountIcon = push_notification_format:resolve_author_avatar_url(?AUTHOR),
    PersonaIcon = fork_push_personas:author_icon(
        sent_as(#{<<"name">> => <<"Bob">>, <<"avatar">> => <<"b0b">>}), ?AUTHOR
    ),
    ?assertEqual(
        push_notification_format:resolve_author_avatar_url(?AUTHOR#{<<"avatar">> => <<"b0b">>}),
        PersonaIcon
    ),
    ?assertNotEqual(AccountIcon, PersonaIcon),
    ?assertEqual(
        <<"https://images.example.test/bob.png">>,
        fork_push_personas:author_icon(
            sent_as(#{
                <<"name">> => <<"Bob">>,
                <<"avatar">> => <<"https://images.example.test/bob.png">>
            }),
            ?AUTHOR
        )
    ).

a_persona_without_a_picture_shows_the_account_picture_test() ->
    AccountIcon = push_notification_format:resolve_author_avatar_url(?AUTHOR),
    ?assertEqual(
        AccountIcon,
        fork_push_personas:author_icon(sent_as(#{<<"name">> => <<"Bob">>}), ?AUTHOR)
    ),
    ?assertEqual(
        AccountIcon,
        fork_push_personas:author_icon(
            sent_as(#{<<"name">> => <<"Bob">>, <<"avatar">> => <<"data:image/png;base64,AA==">>}),
            ?AUTHOR
        )
    ).

a_message_sent_as_the_account_keeps_the_account_picture_test() ->
    ?assertEqual(
        push_notification_format:resolve_author_avatar_url(?AUTHOR),
        fork_push_personas:author_icon(message(<<"hello">>, #{}), ?AUTHOR)
    ).
