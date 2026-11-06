// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: tests of the fork's instance settings, read from the API's response and shown in the
//! "Community & Policy" section of the instance config page.

use super::*;
use crate::templates::pages::instance_config::policy::policy_config_section;
use serde_json::json;

const CONFIG_FORM: ConfigForm<'static> = ConfigForm {
    csrf_token: "csrf",
    loaded: "loaded",
};

const BUTTONS: [&str; 5] = [
    "server_list_button_favorites",
    "server_list_button_explore",
    "server_list_button_create_join",
    "server_list_button_download",
    "server_list_button_help",
];

fn policy(response: serde_json::Value) -> InstancePolicyResponse {
    serde_json::from_value(response).expect("policy")
}

/// The `<input>` tag named `name`.
fn input<'a>(markup: &'a str, name: &str) -> &'a str {
    let at = markup
        .find(&format!(r#"name="{name}""#))
        .unwrap_or_else(|| panic!("no input named {name}"));
    let start = markup[..at].rfind("<input").expect("input start");
    let end = at + markup[at..].find('>').expect("input end");
    &markup[start..end]
}

fn checked_buttons(markup: &str) -> Vec<bool> {
    BUTTONS
        .iter()
        .map(|name| input(markup, name).contains("checked"))
        .collect()
}

#[test]
fn the_policy_reads_the_forks_settings() {
    let policy = policy(json!({
        "server_list_buttons": {
            "favorites": false,
            "explore": true,
            "create_join": false,
            "download": true,
            "help": false
        },
        "single_community_guild_id": null,
        "signal_bar_guild_id": "123456789012345678"
    }));
    let buttons = &policy.server_list_buttons;
    assert_eq!(
        [
            buttons.favorites,
            buttons.explore,
            buttons.create_join,
            buttons.download,
            buttons.help
        ],
        [false, true, false, true, false]
    );
    assert_eq!(
        policy.signal_bar_guild_id.as_deref(),
        Some("123456789012345678")
    );
}

/// An API without the fork's settings (or before they were stored): every button shows, and there
/// is no signal bar.
#[test]
fn a_response_without_the_forks_settings_shows_every_button_and_no_signal_bar() {
    let policy = policy(json!({"single_community_guild_id": null}));
    let buttons = &policy.server_list_buttons;
    assert!(buttons.favorites && buttons.explore && buttons.create_join);
    assert!(buttons.download && buttons.help);
    assert_eq!(policy.signal_bar_guild_id, None);
}

#[test]
fn a_button_the_response_leaves_out_stays_shown() {
    let policy = policy(json!({"server_list_buttons": {"explore": false}}));
    let buttons = &policy.server_list_buttons;
    assert!(!buttons.explore);
    assert!(buttons.favorites && buttons.create_join && buttons.download && buttons.help);
}

#[test]
fn the_server_list_buttons_form_shows_the_stored_buttons() {
    let policy = policy(json!({
        "server_list_buttons": {"favorites": true, "explore": false, "create_join": true,
                                "download": false, "help": true}
    }));
    let markup = server_list_buttons_form("/admin", CONFIG_FORM, &policy).into_string();
    assert!(
        markup.contains(r#"action="/admin/instance-config?action=update_server_list_buttons""#)
    );
    assert!(input(&markup, "_csrf").contains(r#"value="csrf""#));
    assert_eq!(checked_buttons(&markup), [true, false, true, false, true]);
}

#[test]
fn the_signal_bar_form_shows_the_home_community() {
    let with = policy(json!({"signal_bar_guild_id": "123456789012345678"}));
    let markup = signal_bar_form("/admin", CONFIG_FORM, &with).into_string();
    assert!(markup.contains(r#"action="/admin/instance-config?action=update_signal_bar""#));
    assert!(input(&markup, "signal_bar_guild_id").contains(r#"value="123456789012345678""#));

    let without = signal_bar_form("/admin", CONFIG_FORM, &InstancePolicyResponse::default());
    assert!(input(&without.into_string(), "signal_bar_guild_id").contains(r#"value="""#));
}

/// Through upstream's section (policy.rs), which places the fork's forms.
#[test]
fn the_community_and_policy_section_carries_the_forks_forms() {
    let markup = policy_config_section(
        "/admin",
        CONFIG_FORM,
        &InstancePolicyResponse::default(),
        "Premium",
        false,
    )
    .into_string();
    assert!(markup.contains("action=update_server_list_buttons"));
    assert!(markup.contains("action=update_signal_bar"));
    assert_eq!(checked_buttons(&markup), [true; 5]);
}
