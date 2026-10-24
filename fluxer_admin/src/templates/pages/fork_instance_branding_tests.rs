// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: tests of what the fork adds to the branding form.

use super::*;
use crate::api::types::AppBrandingConfigResponse;
use crate::config::ProxyConfig;

/// The admin's configuration as the form needs it: served under `/admin`, nothing else set.
fn admin_config() -> AdminConfig {
    AdminConfig {
        host: String::new(),
        port: 0,
        secret_key_base: String::new(),
        base_path: "/admin".to_owned(),
        api_endpoint: String::new(),
        api_public_endpoint: String::new(),
        media_endpoint: String::new(),
        static_cdn_endpoint: String::new(),
        reports_bucket_origin: String::new(),
        admin_endpoint: String::new(),
        web_app_endpoint: String::new(),
        oauth_client_id: String::new(),
        oauth_client_secret: String::new(),
        oauth_redirect_uri: String::new(),
        build_version: String::new(),
        self_hosted: false,
        proxy: ProxyConfig {
            trust_client_ip_header: false,
            client_ip_header_name: String::new(),
        },
    }
}

fn branding_form(desktop_app_prompt_enabled: bool) -> String {
    let app_public = AppPublicConfigResponse {
        branding: AppBrandingConfigResponse {
            desktop_app_prompt_enabled,
            ..Default::default()
        },
        ..Default::default()
    };
    let config_form = ConfigForm {
        csrf_token: "csrf",
        loaded: "",
    };
    branding_section(&admin_config(), config_form, &app_public, "example.test").into_string()
}

#[test]
fn the_branding_form_carries_the_desktop_app_prompt_switch() {
    let markup = branding_form(true);
    assert!(markup.contains(r#"name="app_desktop_app_prompt_enabled""#));
    assert!(markup.contains("Show desktop app prompt"));
}

#[test]
fn the_desktop_app_prompt_switch_shows_the_stored_setting() {
    let checked = |markup: &str| {
        let at = markup
            .find(r#"name="app_desktop_app_prompt_enabled""#)
            .expect("switch");
        let start = markup[..at].rfind("<input").expect("input start");
        let end = at + markup[at..].find('>').expect("input end");
        markup[start..end].contains("checked")
    };
    assert!(checked(&branding_form(true)));
    assert!(!checked(&branding_form(false)));
}
