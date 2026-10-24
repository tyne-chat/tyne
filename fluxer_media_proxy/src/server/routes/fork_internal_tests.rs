// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: tests of what the fork adds to the internal routes.

use super::*;
use crate::config::Config;
use crate::test_fixtures::synthetic_png;
use axum::http::HeaderValue;

fn authorized_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        HeaderValue::from_static("Bearer secret"),
    );
    headers
}

fn json_request(body: String) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .body(Body::from(body))
        .expect("json request")
}

#[tokio::test]
async fn metadata_external_max_bytes_caps_the_input_the_caller_will_accept() {
    const ENDPOINT: &str = "https://media.test";
    let tmp = tempfile::tempdir().expect("temp storage root");
    let storage_root = tmp.path().canonicalize().expect("canonical storage root");
    let app = Arc::new(AppState::for_tests(
        Config::load_from_iter([
            (
                "FLUXER_MEDIA_PROXY_SECRET_KEY".to_owned(),
                "secret".to_owned(),
            ),
            (
                "FLUXER_MEDIA_PROXY_STORAGE_ROOT".to_owned(),
                storage_root.display().to_string(),
            ),
            (
                "FLUXER_MEDIA_PROXY_PUBLIC_ENDPOINT".to_owned(),
                ENDPOINT.to_owned(),
            ),
        ])
        .expect("metadata max_bytes config"),
    ));
    let key = "attachments/1/2/cat.png";
    let png = synthetic_png(4, 4);
    app.store
        .write_object(&app.cfg.storage.bucket_cdn, key, &png, "image/png")
        .await
        .expect("stored attachment");

    for (max_bytes, expected) in [
        (png.len() as u64, StatusCode::OK),
        (png.len() as u64 - 1, StatusCode::PAYLOAD_TOO_LARGE),
        (0, StatusCode::PAYLOAD_TOO_LARGE),
        (u64::MAX, StatusCode::OK),
    ] {
        let body = serde_json::json!({
            "version": 2,
            "type": "external",
            "nsfw": "allow",
            "with_base64": true,
            "max_bytes": max_bytes,
            "url": format!("{ENDPOINT}/{key}"),
        })
        .to_string();
        let response = metadata_handler(
            State(Arc::clone(&app)),
            authorized_headers(),
            json_request(body),
        )
        .await;
        assert_eq!(expected, response.status(), "max_bytes={max_bytes}");
    }
}
