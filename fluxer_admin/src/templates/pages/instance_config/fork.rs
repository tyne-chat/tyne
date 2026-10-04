// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the instance settings the fork adds to the instance config page. Each form posts to
//! upstream's config actions; `policy.rs` places them in its "Community & Policy" section.

use super::ConfigForm;
use crate::{
    api::types::InstancePolicyResponse,
    templates::components::form::{Checkbox, form_actions, submit_button, text_input},
};
use maud::{Markup, html};

pub(super) fn server_list_buttons_form(
    base: &str,
    config_form: ConfigForm<'_>,
    policy: &InstancePolicyResponse,
) -> Markup {
    let buttons = &policy.server_list_buttons;
    let button = |name: &'static str, label: &'static str, checked: bool| {
        Checkbox { name, value: "true", label, checked, enabled: true }.render()
    };
    html! {
        div class="space-y-4 border-t border-neutral-200 pt-6" {
            div class="flex flex-wrap items-center gap-2" {
                h3 class="text-sm font-semibold text-neutral-900" { "Server list buttons" }
            }
            p class="text-sm text-neutral-500" {
                "Control which special navigation buttons appear in the left server list column for users on this instance."
            }
            form method="post" action={(base) "/instance-config?action=update_server_list_buttons"} {
                (config_form.fields())
                div class="space-y-3" {
                    (button("server_list_button_favorites", "Favorites", buttons.favorites))
                    (button("server_list_button_explore", "Explore communities", buttons.explore))
                    (button("server_list_button_create_join", "Create or join a community", buttons.create_join))
                    (button("server_list_button_download", "Download desktop app", buttons.download))
                    (button("server_list_button_help", "Help center", buttons.help))
                    (form_actions(html! {
                        (submit_button("Save button settings"))
                    }))
                }
            }
        }
    }
}

pub(super) fn signal_bar_form(
    base: &str,
    config_form: ConfigForm<'_>,
    policy: &InstancePolicyResponse,
) -> Markup {
    html! {
        div class="space-y-4 border-t border-neutral-200 pt-6" {
            div class="flex flex-wrap items-center gap-2" {
                h3 class="text-sm font-semibold text-neutral-900" { "Signal bar" }
            }
            p class="text-sm text-neutral-500" {
                "The signal bar is shown above the message box in every channel and DM on this \
                 instance. Members with Manage Community in the home community choose its signals \
                 from that community's Message Tools settings. Leave empty to turn the bar off."
            }
            form method="post" action={(base) "/instance-config?action=update_signal_bar"} {
                (config_form.fields())
                div class="space-y-3" {
                    (text_input(
                        "signal_bar_guild_id",
                        "Home community ID",
                        policy.signal_bar_guild_id.as_deref().unwrap_or(""),
                        "Community ID",
                    ))
                    (form_actions(html! {
                        (submit_button("Save signal bar settings"))
                    }))
                }
            }
        }
    }
}
