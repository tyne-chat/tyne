%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork: pushes for messages in DM threads and their event name (tyne-chat/tyne#699).
-module(fork_dm_thread_push_tests).

-include_lib("eunit/include/eunit.hrl").

push_message_test_() ->
    Message = #{
        <<"id">> => <<"3">>, <<"channel_id">> => <<"2">>, <<"fork_thread_id">> => <<"4">>
    },
    [
        ?_assertEqual(
            Message,
            fork_dm_thread_push:push_message(#{
                <<"t">> => <<"MESSAGE_CREATE">>,
                <<"d">> => #{<<"id">> => <<"3">>},
                <<"push">> => #{<<"message">> => Message}
            })
        ),
        ?_assertEqual(
            undefined,
            fork_dm_thread_push:push_message(#{<<"t">> => <<"MESSAGE_CREATE">>, <<"d">> => #{}})
        ),
        ?_assertEqual(
            undefined,
            fork_dm_thread_push:push_message(#{
                <<"t">> => <<"TYPING_START">>, <<"push">> => #{<<"message">> => Message}
            })
        ),
        ?_assertEqual(undefined, fork_dm_thread_push:push_message(not_a_map))
    ].

title_test_() ->
    [
        ?_assertEqual(
            <<"Wren (Trip planning)">>,
            fork_dm_thread_push:title(<<"Wren">>, #{
                <<"fork_thread_name">> => <<"Trip planning">>
            })
        ),
        ?_assertEqual(undefined, fork_dm_thread_push:title(<<"Wren">>, #{})),
        ?_assertEqual(
            undefined, fork_dm_thread_push:title(<<"Wren">>, #{<<"fork_thread_name">> => <<>>})
        ),
        %% A named group DM: the API sends the thread and the group (Carbon's review of tyne-chat/tyne#699).
        ?_assertEqual(
            <<"Wren (Trip planning, Book club)">>,
            fork_dm_thread_push:title(<<"Wren">>, #{
                <<"fork_thread_name">> => <<"Trip planning">>,
                <<"fork_thread_context">> => <<"Trip planning, Book club">>
            })
        ),
        ?_assertEqual(
            <<"Wren (Trip planning)">>,
            fork_dm_thread_push:title(<<"Wren">>, #{
                <<"fork_thread_name">> => <<"Trip planning">>,
                <<"fork_thread_context">> => <<>>
            })
        )
    ].

notification_title_test() ->
    Message = #{<<"channel_type">> => 1, <<"fork_thread_name">> => <<"Trip planning">>},
    ?assertEqual(
        <<"Wren (Trip planning)">>,
        push_notification:build_notification_title(<<"Wren">>, Message, 0, undefined, undefined)
    ),
    ?assertEqual(
        <<"Wren">>,
        push_notification:build_notification_title(
            <<"Wren">>, #{<<"channel_type">> => 1}, 0, undefined, undefined
        )
    ).

fields_test() ->
    ?assertEqual(
        #{<<"fork_thread_id">> => <<"4">>, <<"fork_thread_name">> => <<"Trip planning">>},
        fork_dm_thread_push:fields(#{
            <<"id">> => <<"3">>,
            <<"fork_thread_id">> => <<"4">>,
            <<"fork_thread_name">> => <<"Trip planning">>
        })
    ),
    ?assertEqual(#{}, fork_dm_thread_push:fields(#{<<"fork_thread_name">> => <<>>})).

event_name_test() ->
    ?assertEqual(fork_dm_thread_event, event_atoms:normalize(<<"FORK_DM_THREAD_EVENT">>)).

%% A DM thread's message is read in the thread: its pushes, read marks and tags go by the thread, while the push
%% still opens the parent DM (Carbon's review of tyne-chat/tyne#699).
read_channel_id_test_() ->
    [
        ?_assertEqual(
            700,
            fork_dm_thread_push:read_channel_id(#{<<"fork_thread_id">> => <<"700">>}, 100)
        ),
        ?_assertEqual(100, fork_dm_thread_push:read_channel_id(#{}, 100)),
        ?_assertEqual(
            100, fork_dm_thread_push:read_channel_id(#{<<"fork_thread_id">> => <<"x">>}, 100)
        ),
        ?_assertEqual(undefined, fork_dm_thread_push:read_channel_id(not_a_map, undefined))
    ].

tags_test_() ->
    [
        ?_assertEqual(
            #{
                <<"tag">> => <<"channel:700:701">>,
                <<"notification_tag">> => <<"channel:700">>
            },
            fork_dm_thread_push:tags(#{<<"fork_thread_id">> => <<"700">>}, 701)
        ),
        ?_assertEqual(#{}, fork_dm_thread_push:tags(#{<<"channel_id">> => <<"100">>}, 701))
    ].

ack_test_() ->
    Ack = #{<<"channel_id">> => <<"700">>, <<"message_id">> => <<"701">>},
    [
        ?_assertEqual(
            Ack, fork_dm_thread_push:ack(#{<<"t">> => <<"MESSAGE_ACK">>, <<"d">> => Ack})
        ),
        ?_assertEqual(
            undefined,
            fork_dm_thread_push:ack(#{<<"t">> => <<"MESSAGE_CREATE">>, <<"d">> => Ack})
        ),
        ?_assertEqual(undefined, fork_dm_thread_push:ack(not_a_map))
    ].

%% A buffered push for a DM thread message is dropped when the thread is read, not when the DM is.
buffer_ack_test() ->
    Message = #{
        <<"id">> => <<"701">>,
        <<"channel_id">> => <<"100">>,
        <<"fork_thread_id">> => <<"700">>,
        <<"author">> => #{<<"id">> => <<"2">>}
    },
    Entry = #{channel_id => 700, message_id => 701, params => #{}, buffered_at => 0},
    State = #{user_id => 1, push_buffer => [Entry]},
    Unchanged = presence_update:handle_message_ack_event(
        #{<<"channel_id">> => <<"100">>, <<"message_id">> => <<"701">>}, State
    ),
    ?assertEqual([Entry], maps:get(push_buffer, Unchanged)),
    Read = presence_update:handle_message_ack_event(
        #{<<"channel_id">> => <<"700">>, <<"message_id">> => <<"701">>}, State
    ),
    ?assertEqual([], maps:get(push_buffer, Read)),
    ?assertEqual(700, fork_dm_thread_push:read_channel_id(Message, 100)).
