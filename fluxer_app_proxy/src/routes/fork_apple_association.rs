// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: iOS only offers an app the passkeys and saved passwords of a domain whose
// apple-app-site-association file names the app (`webcredentials`). Upstream's file names Fluxer's
// own apps; this adds the Tyne iOS app (team 2VU375L9T2, `chat.tyne.app`) and keeps upstream's
// entries. The app's side is `webcredentials:<instance>` in the entitlements that the mobile repo's
// tool/fork_ios_identity.py writes.

use super::apple_association;
use axum::{
    Json,
    body::to_bytes,
    response::{IntoResponse, Response},
};
use serde_json::Value;

const TYNE_IOS_APP_ID: &str = "2VU375L9T2.chat.tyne.app";

fn with_tyne(mut association: Value) -> Value {
    let apps = association
        .as_object_mut()
        .map(|object| {
            object
                .entry("webcredentials")
                .or_insert_with(|| Value::Object(Default::default()))
        })
        .and_then(Value::as_object_mut)
        .map(|webcredentials| {
            webcredentials
                .entry("apps")
                .or_insert_with(|| Value::Array(Vec::new()))
        })
        .and_then(Value::as_array_mut);
    if let Some(apps) = apps
        && !apps.iter().any(|app| app == TYNE_IOS_APP_ID)
    {
        apps.push(Value::from(TYNE_IOS_APP_ID));
    }
    association
}

pub async fn apple_app_site_association() -> Response {
    let (parts, body) = apple_association::apple_app_site_association()
        .await
        .into_parts();
    let Ok(bytes) = to_bytes(body, usize::MAX).await else {
        return Response::from_parts(parts, axum::body::Body::empty());
    };
    let association: Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::Object(Default::default()));

    let mut response = Json(with_tyne(association)).into_response();
    for (name, value) in &parts.headers {
        response.headers_mut().insert(name, value.clone());
    }
    *response.status_mut() = parts.status;
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{StatusCode, header};
    use serde_json::json;

    async fn body_json(response: Response) -> Value {
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    #[tokio::test]
    async fn adds_tyne_after_upstream_apps() {
        let upstream = body_json(apple_association::apple_app_site_association().await).await;
        let upstream_apps = upstream["webcredentials"]["apps"]
            .as_array()
            .unwrap()
            .clone();
        assert!(!upstream_apps.is_empty());

        let response = apple_app_site_association().await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=1800"
        );
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );

        let actual = body_json(response).await;
        let apps = actual["webcredentials"]["apps"].as_array().unwrap();
        assert_eq!(apps[..upstream_apps.len()], upstream_apps[..]);
        assert_eq!(apps[upstream_apps.len()..], [json!(TYNE_IOS_APP_ID)]);
    }

    #[test]
    fn creates_the_section_when_upstream_has_none() {
        assert_eq!(
            with_tyne(json!({})),
            json!({"webcredentials": {"apps": [TYNE_IOS_APP_ID]}})
        );
    }

    #[test]
    fn does_not_add_tyne_twice() {
        let once = with_tyne(json!({"webcredentials": {"apps": ["A.b"]}}));
        assert_eq!(with_tyne(once.clone()), once);
    }
}
