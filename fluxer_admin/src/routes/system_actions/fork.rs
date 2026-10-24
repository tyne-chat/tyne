// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the config actions of the fork's own instance settings, dispatched from
//! `instance_config_post` in `system_actions.rs`.

use crate::{
    api::types::{
        InstanceConfigUpdateRequest, InstancePolicyUpdateRequest, ServerListButtonsUpdateRequest,
    },
    utils::forms::MultiValueForm,
};

pub(super) fn build_server_list_buttons_update(
    form: &MultiValueForm,
) -> InstanceConfigUpdateRequest {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn signal_bar_guild_id(form: &[u8]) -> Option<Option<String>> {
        build_signal_bar_update(&MultiValueForm::parse(form))
            .policy
            .expect("policy")
            .signal_bar_guild_id
    }

    #[test]
    fn a_blank_signal_bar_community_clears_it_and_a_padded_one_is_trimmed() {
        assert_eq!(signal_bar_guild_id(b"signal_bar_guild_id="), Some(None));
        assert_eq!(signal_bar_guild_id(b"signal_bar_guild_id=+++"), Some(None));
        assert_eq!(signal_bar_guild_id(b""), Some(None));
        assert_eq!(
            signal_bar_guild_id(b"signal_bar_guild_id=+123456789012345678+"),
            Some(Some("123456789012345678".to_owned()))
        );
    }

    #[test]
    fn server_list_buttons_left_unchecked_are_switched_off() {
        let buttons = build_server_list_buttons_update(&MultiValueForm::parse(
            b"server_list_button_favorites=true&server_list_button_help=true",
        ))
        .policy
        .expect("policy")
        .server_list_buttons
        .expect("server list buttons");

        assert_eq!(buttons.favorites, Some(true));
        assert_eq!(buttons.explore, Some(false));
        assert_eq!(buttons.create_join, Some(false));
        assert_eq!(buttons.download, Some(false));
        assert_eq!(buttons.help, Some(true));
    }
}
