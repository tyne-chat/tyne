%% SPDX-License-Identifier: AGPL-3.0-or-later

%% Fork: gateway events the fork adds that no upstream map lists.
-module(fork_event_atoms).
-typing([eqwalizer]).

-export([event_map/0]).

-spec event_map() -> #{binary() => atom()}.
event_map() ->
    #{
        %% tyne-chat/tyne#699: every event about a thread in a DM, wrapped as {t, d}.
        <<"FORK_DM_THREAD_EVENT">> => fork_dm_thread_event,
        %% tyne-chat/tyne#829: the account's persona groups changed, to its own sessions only.
        <<"USER_PERSONA_GROUPS_UPDATE">> => user_persona_groups_update
    }.
