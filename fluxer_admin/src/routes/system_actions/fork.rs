// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the config actions of the fork's own instance settings, dispatched from
//! `instance_config_post` in `system_actions.rs`.

use crate::{
    api::types::{InstanceConfigUpdateRequest, InstancePolicyUpdateRequest, ServerListButtonsUpdateRequest},
    utils::forms::MultiValueForm,
};

pub(super) fn build_server_list_buttons_update(form: &MultiValueForm) -> InstanceConfigUpdateRequest {
    let flag = |key: &str| form.bool_value(key);
    InstanceConfigUpdateRequest {
        policy: Some(InstancePolicyUpdateRequest {
            server_list_buttons: Some(ServerListButtonsUpdateRequest {
                favorites: Some(flag("server_list_button_favorites")),
                explore: Some(flag("server_list_button_explore")),
                create_join: Some(flag("server_list_button_create_join")),
                download: Some(flag("server_list_button_download")),
                help: Some(flag("server_list_button_help")),
            }),
            ..Default::default()
        }),
        ..Default::default()
    }
}

pub(super) fn build_signal_bar_update(form: &MultiValueForm) -> InstanceConfigUpdateRequest {
    let guild_id = form
        .first("signal_bar_guild_id")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    InstanceConfigUpdateRequest {
        policy: Some(InstancePolicyUpdateRequest {
            signal_bar_guild_id: Some(guild_id),
            ..Default::default()
        }),
        ..Default::default()
    }
}
