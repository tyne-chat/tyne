%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork: pushes for messages in DM threads (tyne-chat/tyne#699). The API sends each recipient the event wrapped as
%% FORK_DM_THREAD_EVENT {t, d, push}; `push.message` is the message as a message in the parent DM, so apps that
%% predate DM threads open the DM. It carries fork_thread_id and fork_thread_name, which become push fields for
%% newer apps and the title "Author (Thread)".
-module(fork_dm_thread_push).
-typing([eqwalizer]).

-export([push_message/1, title/2, fields/1]).

-spec push_message(term()) -> map() | undefined.
push_message(#{<<"t">> := <<"MESSAGE_CREATE">>, <<"push">> := #{<<"message">> := Message}}) when
    is_map(Message)
->
    Message;
push_message(_Data) ->
    undefined.

-spec title(binary(), map()) -> binary() | undefined.
title(AuthorUsername, #{<<"fork_thread_name">> := Name}) when
    is_binary(Name), byte_size(Name) > 0
->
    iolist_to_binary([AuthorUsername, <<" (">>, Name, <<")">>]);
title(_AuthorUsername, _MessageData) ->
    undefined.

-spec fields(map()) -> map().
fields(MessageData) ->
    maps:filter(
        fun(_Key, Value) -> is_binary(Value) andalso byte_size(Value) > 0 end,
        maps:with([<<"fork_thread_id">>, <<"fork_thread_name">>], MessageData)
    ).
