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
