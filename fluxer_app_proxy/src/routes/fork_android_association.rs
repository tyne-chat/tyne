// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: Android only offers an app the passkeys of a domain whose assetlinks.json names the app and its
// signing certificate. Upstream's file names Fluxer's own apps; this adds the Tyne app (`chat.tyne.app`)
// and keeps upstream's entries. The certificate must match TYNE_ANDROID_PASSKEY_ORIGIN in
// fluxer_api/src/api/auth/ForkPasskeyOrigins.ts.

use super::android_association;
use axum::{
    Json,
    body::to_bytes,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

const TYNE_PACKAGE_NAME: &str = "chat.tyne.app";

/// SHA-256 of the Tyne release signing certificate (CN=Tyne, O=Tyne Chat).
const TYNE_SHA256_CERT_FINGERPRINT: &str = "22:1C:16:E5:A4:B5:68:A4:D1:88:03:DE:9B:0E:F9:15:EE:CD:BB:F1:C0:CE:F3:6C:78:31:E3:A7:25:A1:6B:7B";

fn tyne_statement() -> Value {
    json!({
        "relation": [
            "delegate_permission/common.handle_all_urls",
            "delegate_permission/common.get_login_creds"
        ],
        "target": {
            "namespace": "android_app",
            "package_name": TYNE_PACKAGE_NAME,
            "sha256_cert_fingerprints": [TYNE_SHA256_CERT_FINGERPRINT]
        }
    })
}

pub async fn assetlinks() -> Response {
    let (parts, body) = android_association::assetlinks().await.into_parts();
    let Ok(bytes) = to_bytes(body, usize::MAX).await else {
        return Response::from_parts(parts, axum::body::Body::empty());
    };
    let mut statements: Vec<Value> = serde_json::from_slice(&bytes).unwrap_or_default();
    statements.push(tyne_statement());

    let mut response = Json(statements).into_response();
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

    #[tokio::test]
    async fn assetlinks_adds_tyne_after_upstream_statements() {
        let upstream = to_bytes(
            android_association::assetlinks().await.into_body(),
            usize::MAX,
        )
        .await
        .unwrap();
        let upstream: Vec<Value> = serde_json::from_slice(&upstream).unwrap();

        let response = assetlinks().await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=1800"
        );
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let actual: Vec<Value> = serde_json::from_slice(&body).unwrap();
        assert!(!upstream.is_empty());
        assert_eq!(actual[..upstream.len()], upstream[..]);
        assert_eq!(actual[upstream.len()..], [tyne_statement()]);
        assert_eq!(
            actual.last().unwrap()["target"]["package_name"],
            "chat.tyne.app"
        );
    }

    #[test]
    fn tyne_fingerprint_matches_the_api_passkey_origin() {
        use base64::Engine;
        let bytes: Vec<u8> = TYNE_SHA256_CERT_FINGERPRINT
            .split(':')
            .map(|byte| u8::from_str_radix(byte, 16).unwrap())
            .collect();
        assert_eq!(bytes.len(), 32);
        let hash = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        let api_origins = include_str!("../../../fluxer_api/src/api/auth/ForkPasskeyOrigins.ts");
        assert!(api_origins.contains(&format!("'android:apk-key-hash:{hash}'")));
    }
}
