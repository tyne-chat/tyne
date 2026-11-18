%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork: pushes for messages in DM threads (tyne-chat/tyne#699). The API sends each recipient the event wrapped as
%% FORK_DM_THREAD_EVENT {t, d, push}; `push.message` is the message as a message in the parent DM, so apps that
%% predate DM threads open the DM. It carries fork_thread_id and fork_thread_name, which become push fields for
%% newer apps and the title "Author (Thread)".
-module(fork_dm_thread_push).
-typing([eqwalizer]).

-export([push_message/1, title/2, fields/1, read_channel_id/2, tags/2, ack/1]).

-spec push_message(term()) -> map() | undefined.
push_message(#{<<"t">> := <<"MESSAGE_CREATE">>, <<"push">> := #{<<"message">> := Message}}) when
    is_map(Message)
->
    Message;
push_message(_Data) ->
    undefined.

%% "Author (Thread, Group)": `fork_thread_context` when the API sends it (a named group DM adds its name), else the
%% thread's name.
-spec title(binary(), map()) -> binary() | undefined.
title(AuthorUsername, #{<<"fork_thread_context">> := Context}) when
    is_binary(Context), byte_size(Context) > 0
->
    iolist_to_binary([AuthorUsername, <<" (">>, Context, <<")">>]);
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

%% The channel a pushed message is read in: its DM thread (`fork_thread_id`) when it has one, else `Default`, the
%% message's own channel. Its push is still a message in the parent DM, so apps that predate DM threads open the DM;
%% but reading it, the push buffer and the notification's tags go by the thread, whose read state the API keeps and
%% whose acks clear the notification (Gemini Carbon's review of tyne-chat/tyne#699).
-spec read_channel_id(map(), integer() | undefined) -> integer() | undefined.
read_channel_id(MessageData, Default) when is_map(MessageData) ->
    case snowflake_id:parse_maybe(maps:get(<<"fork_thread_id">>, MessageData, undefined)) of
        ThreadId when is_integer(ThreadId) -> ThreadId;
        _ -> Default
    end;
read_channel_id(_MessageData, Default) ->
    Default.

%% A DM thread message's notification tags, by the thread; none for any other message.
-spec tags(map(), integer()) -> map().
tags(MessageData, MessageId) ->
    case read_channel_id(MessageData, undefined) of
        undefined ->
            #{};
        ThreadId ->
            ThreadIdBin = integer_to_binary(ThreadId),
            MessageIdBin = integer_to_binary(MessageId),
            #{
                <<"tag">> => <<"channel:", ThreadIdBin/binary, ":", MessageIdBin/binary>>,
                <<"notification_tag">> => <<"channel:", ThreadIdBin/binary>>
            }
    end.

%% A DM thread's MESSAGE_ACK as the API wraps it: the ack, whose channel_id is the thread.
-spec ack(term()) -> map() | undefined.
ack(#{<<"t">> := <<"MESSAGE_ACK">>, <<"d">> := Ack}) when is_map(Ack) ->
    Ack;
ack(_Data) ->
    undefined.
