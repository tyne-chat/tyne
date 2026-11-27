// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork guard: every field of `MessageRequest::GetResponseById` and `MessageRequest::ListResponses`
//! must either affect `MessagesRouter::coalesce_key` or be explicitly classified here (secret keys),
//! so a newly added upstream field fails compilation until handled in `coalesce_key`.

use fluxer_messages::router_impl::MessagesRouter;
use fluxer_messages::types::MessageRequest;
use fluxer_svc::router::RouterService;

type RequestMutation = (&'static str, fn(&mut MessageRequest));

fn base_get_request() -> MessageRequest {
    MessageRequest::GetResponseById {
        channel_id: "ch_1".to_string(),
        message_id: "msg_1".to_string(),
        viewer_user_id: "user_1".to_string(),
        source_guild_id: Some("guild_1".to_string()),
        message_history_cutoff_ms: Some(1_000),
        can_read_message_history: true,
        media_endpoint: "https://media.a.example".to_string(),
        media_proxy_secret_key: "secret_a".to_string(),
        attachment_url_secret_base64: Some("base64_a".to_string()),
        include_reactions: Some(true),
        attachment_decay: Some(true),
        nonce: Some("nonce_1".to_string()),
        tts: Some(true),
        include_hidden: true,
        threads_mask: true,
        instance_name: "tyne-a".to_string(),
        attachment_api_base: Some("https://api.a.example".to_string()),
    }
}

fn base_list_request() -> MessageRequest {
    MessageRequest::ListResponses {
        channel_id: "ch_1".to_string(),
        viewer_user_id: "user_1".to_string(),
        limit: 50,
        before_id: Some("before_1".to_string()),
        after_id: Some("after_1".to_string()),
        around_id: Some("around_1".to_string()),
        source_guild_id: Some("guild_1".to_string()),
        message_history_cutoff_ms: Some(1_000),
        can_read_message_history: true,
        media_endpoint: "https://media.a.example".to_string(),
        media_proxy_secret_key: "secret_a".to_string(),
        attachment_url_secret_base64: Some("base64_a".to_string()),
        include_reactions: Some(true),
        attachment_decay: Some(true),
        include_hidden: true,
        threads_mask: true,
        exclude_types: vec![1, 2],
        instance_name: "tyne-a".to_string(),
        attachment_api_base: Some("https://api.a.example".to_string()),
    }
}

/// Exhaustive field destructure (no `..`) so adding any upstream field fails compilation here.
fn assert_all_fields_classified(req: &MessageRequest) {
    match req {
        MessageRequest::GetResponseById {
            channel_id: _,
            message_id: _,
            viewer_user_id: _,
            source_guild_id: _,
            message_history_cutoff_ms: _,
            can_read_message_history: _,
            media_endpoint: _,
            media_proxy_secret_key: _,
            attachment_url_secret_base64: _,
            include_reactions: _,
            attachment_decay: _,
            nonce: _,
            tts: _,
            include_hidden: _,
            threads_mask: _,
            instance_name: _,
            attachment_api_base: _,
        } => {}
        MessageRequest::ListResponses {
            channel_id: _,
            viewer_user_id: _,
            limit: _,
            before_id: _,
            after_id: _,
            around_id: _,
            source_guild_id: _,
            message_history_cutoff_ms: _,
            can_read_message_history: _,
            media_endpoint: _,
            media_proxy_secret_key: _,
            attachment_url_secret_base64: _,
            include_reactions: _,
            attachment_decay: _,
            include_hidden: _,
            threads_mask: _,
            exclude_types: _,
            instance_name: _,
            attachment_api_base: _,
        } => {}
        _ => {}
    }
}

fn coalesce(req: &MessageRequest) -> String {
    <MessagesRouter as RouterService>::coalesce_key(req).expect("expected coalesce key")
}

#[test]
fn get_response_by_id_coalesce_key_covers_every_non_secret_field() {
    let base = base_get_request();
    assert_all_fields_classified(&base);
    let base_key = coalesce(&base);

    let mutations: [RequestMutation; 15] = [
        ("channel_id", |r| {
            if let MessageRequest::GetResponseById { channel_id, .. } = r {
                *channel_id = "ch_2".into();
            }
        }),
        ("message_id", |r| {
            if let MessageRequest::GetResponseById { message_id, .. } = r {
                *message_id = "msg_2".into();
            }
        }),
        ("viewer_user_id", |r| {
            if let MessageRequest::GetResponseById { viewer_user_id, .. } = r {
                *viewer_user_id = "user_2".into();
            }
        }),
        ("source_guild_id", |r| {
            if let MessageRequest::GetResponseById {
                source_guild_id, ..
            } = r
            {
                *source_guild_id = Some("guild_2".into());
            }
        }),
        ("message_history_cutoff_ms", |r| {
            if let MessageRequest::GetResponseById {
                message_history_cutoff_ms,
                ..
            } = r
            {
                *message_history_cutoff_ms = Some(2_000);
            }
        }),
        ("can_read_message_history", |r| {
            if let MessageRequest::GetResponseById {
                can_read_message_history,
                ..
            } = r
            {
                *can_read_message_history = false;
            }
        }),
        ("media_endpoint", |r| {
            if let MessageRequest::GetResponseById { media_endpoint, .. } = r {
                *media_endpoint = "https://media.b.example".into();
            }
        }),
        ("include_reactions", |r| {
            if let MessageRequest::GetResponseById {
                include_reactions, ..
            } = r
            {
                *include_reactions = Some(false);
            }
        }),
        ("attachment_decay", |r| {
            if let MessageRequest::GetResponseById {
                attachment_decay, ..
            } = r
            {
                *attachment_decay = Some(false);
            }
        }),
        ("nonce", |r| {
            if let MessageRequest::GetResponseById { nonce, .. } = r {
                *nonce = Some("nonce_2".into());
            }
        }),
        ("tts", |r| {
            if let MessageRequest::GetResponseById { tts, .. } = r {
                *tts = Some(false);
            }
        }),
        ("include_hidden", |r| {
            if let MessageRequest::GetResponseById { include_hidden, .. } = r {
                *include_hidden = false;
            }
        }),
        ("threads_mask", |r| {
            if let MessageRequest::GetResponseById { threads_mask, .. } = r {
                *threads_mask = false;
            }
        }),
        ("instance_name", |r| {
            if let MessageRequest::GetResponseById { instance_name, .. } = r {
                *instance_name = "tyne-b".into();
            }
        }),
        ("attachment_api_base", |r| {
            if let MessageRequest::GetResponseById {
                attachment_api_base,
                ..
            } = r
            {
                *attachment_api_base = Some("https://api.b.example".into());
            }
        }),
    ];

    for (field, mutate) in mutations {
        let mut req = base_get_request();
        mutate(&mut req);
        assert_ne!(
            coalesce(&req),
            base_key,
            "mutating GetResponseById::{field} must change coalesce_key"
        );
    }

    let mut secret_changed = base_get_request();
    if let MessageRequest::GetResponseById {
        media_proxy_secret_key,
        attachment_url_secret_base64,
        ..
    } = &mut secret_changed
    {
        *media_proxy_secret_key = "secret_b".to_string();
        *attachment_url_secret_base64 = Some("base64_b".to_string());
    }
    assert_eq!(
        coalesce(&secret_changed),
        base_key,
        "secret fields must not appear in or alter GetResponseById coalesce_key"
    );
}

#[test]
fn list_responses_coalesce_key_covers_every_non_secret_field() {
    let base = base_list_request();
    assert_all_fields_classified(&base);
    let base_key = coalesce(&base);

    let mutations: [RequestMutation; 17] = [
        ("channel_id", |r| {
            if let MessageRequest::ListResponses { channel_id, .. } = r {
                *channel_id = "ch_2".into();
            }
        }),
        ("viewer_user_id", |r| {
            if let MessageRequest::ListResponses { viewer_user_id, .. } = r {
                *viewer_user_id = "user_2".into();
            }
        }),
        ("limit", |r| {
            if let MessageRequest::ListResponses { limit, .. } = r {
                *limit = 25;
            }
        }),
        ("before_id", |r| {
            if let MessageRequest::ListResponses { before_id, .. } = r {
                *before_id = Some("before_2".into());
            }
        }),
        ("after_id", |r| {
            if let MessageRequest::ListResponses { after_id, .. } = r {
                *after_id = Some("after_2".into());
            }
        }),
        ("around_id", |r| {
            if let MessageRequest::ListResponses { around_id, .. } = r {
                *around_id = Some("around_2".into());
            }
        }),
        ("source_guild_id", |r| {
            if let MessageRequest::ListResponses {
                source_guild_id, ..
            } = r
            {
                *source_guild_id = Some("guild_2".into());
            }
        }),
        ("message_history_cutoff_ms", |r| {
            if let MessageRequest::ListResponses {
                message_history_cutoff_ms,
                ..
            } = r
            {
                *message_history_cutoff_ms = Some(2_000);
            }
        }),
        ("can_read_message_history", |r| {
            if let MessageRequest::ListResponses {
                can_read_message_history,
                ..
            } = r
            {
                *can_read_message_history = false;
            }
        }),
        ("media_endpoint", |r| {
            if let MessageRequest::ListResponses { media_endpoint, .. } = r {
                *media_endpoint = "https://media.b.example".into();
            }
        }),
        ("include_reactions", |r| {
            if let MessageRequest::ListResponses {
                include_reactions, ..
            } = r
            {
                *include_reactions = Some(false);
            }
        }),
        ("attachment_decay", |r| {
            if let MessageRequest::ListResponses {
                attachment_decay, ..
            } = r
            {
                *attachment_decay = Some(false);
            }
        }),
        ("include_hidden", |r| {
            if let MessageRequest::ListResponses { include_hidden, .. } = r {
                *include_hidden = false;
            }
        }),
        ("threads_mask", |r| {
            if let MessageRequest::ListResponses { threads_mask, .. } = r {
                *threads_mask = false;
            }
        }),
        ("exclude_types", |r| {
            if let MessageRequest::ListResponses { exclude_types, .. } = r {
                *exclude_types = vec![1, 3];
            }
        }),
        ("instance_name", |r| {
            if let MessageRequest::ListResponses { instance_name, .. } = r {
                *instance_name = "tyne-b".into();
            }
        }),
        ("attachment_api_base", |r| {
            if let MessageRequest::ListResponses {
                attachment_api_base,
                ..
            } = r
            {
                *attachment_api_base = Some("https://api.b.example".into());
            }
        }),
    ];

    for (field, mutate) in mutations {
        let mut req = base_list_request();
        mutate(&mut req);
        assert_ne!(
            coalesce(&req),
            base_key,
            "mutating ListResponses::{field} must change coalesce_key"
        );
    }

    let mut secret_changed = base_list_request();
    if let MessageRequest::ListResponses {
        media_proxy_secret_key,
        attachment_url_secret_base64,
        ..
    } = &mut secret_changed
    {
        *media_proxy_secret_key = "secret_b".to_string();
        *attachment_url_secret_base64 = Some("base64_b".to_string());
    }
    assert_eq!(
        coalesce(&secret_changed),
        base_key,
        "secret fields must not appear in or alter ListResponses coalesce_key"
    );
}
