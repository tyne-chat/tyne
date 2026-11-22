// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: `POST /_fork/animated_avif_to_webp`, through which the API turns an animated AVIF upload
//! into an animated WebP before it reads it (tyne-chat/tyne#854; the conversion is
//! `media_process::fork_animated_avif`).
//!
//! The body names the input as `/_strip`'s does (`{"type": "s3", "bucket", "key"}`, `"upload"` or
//! `"base64"`). Answers:
//! - 200 with the WebP, and `x-fluxer-media-width`, `x-fluxer-media-height` and
//!   `x-tyne-animation-frames`;
//! - 422 `not_animated_avif`: nothing to convert; the API keeps the upload;
//! - 413 `animation_too_large`: longer or larger than the proxy decodes; the API refuses it;
//! - 400 `conversion_failed`, 503 or 504: not converted; the API keeps the upload, as it does when
//!   another conversion fails.

use crate::{
    constants,
    media_process::{self, AnimatedAvifConversion, MediaError},
    metrics,
    server::{
        media_operations::{MediaFailure, MediaInput, MediaInputLimit, load_media_input},
        response::error::{text, text_with_reason, text_with_source},
        state::AppState,
        transform::execution::deadline_instant,
    },
};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{HeaderMap, Request, StatusCode, header},
    response::Response,
    routing::post,
};
use bytes::Bytes;
use serde::Deserialize;
use std::sync::Arc;

const ROUTE: &str = "/_fork/animated_avif_to_webp";
const FRAMES_HEADER: &str = "x-tyne-animation-frames";
const WIDTH_HEADER: &str = "x-fluxer-media-width";
const HEIGHT_HEADER: &str = "x-fluxer-media-height";
/// Longer than a preview's: the whole animation is encoded at full size. The API waits a little
/// longer than this.
const CONVERSION_TIMEOUT_MS: i64 = 2 * 60 * 1000;

pub(in crate::server) fn with_routes(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    router.route(ROUTE, post(convert_handler))
}

#[derive(Debug, Deserialize)]
pub(super) struct ConversionRequest {
    #[serde(rename = "type")]
    typ: String,
    base64: Option<String>,
    upload_filename: Option<String>,
    bucket: Option<String>,
    key: Option<String>,
    filename: Option<String>,
}

impl ConversionRequest {
    pub(super) fn into_media_input(self) -> Result<MediaInput, MediaFailure> {
        match self.typ.as_str() {
            "base64" => Ok(MediaInput::Base64 {
                data: self.base64.ok_or(MediaFailure::MediaInputMissingField)?,
                filename: self.filename,
            }),
            "upload" => Ok(MediaInput::Upload {
                upload_filename: self
                    .upload_filename
                    .ok_or(MediaFailure::MediaInputMissingField)?,
                filename: self.filename,
            }),
            "s3" => Ok(MediaInput::Storage {
                bucket: self.bucket.ok_or(MediaFailure::MediaInputMissingField)?,
                key: self.key.ok_or(MediaFailure::MediaInputMissingField)?,
                filename: self.filename,
            }),
            _ => Err(MediaFailure::MediaInputUnsupportedType),
        }
    }
}

async fn convert_handler(
    State(app): State<Arc<AppState>>,
    headers: HeaderMap,
    request: Request<Body>,
) -> Response {
    if !internal_auth_matches(&headers, app.cfg.secret_key.expose()) {
        return text(StatusCode::UNAUTHORIZED, "Unauthorized");
    }
    let body = match read_body(request).await {
        Ok(body) => body,
        Err(status) => return text(status, status.canonical_reason().unwrap_or("Bad Request")),
    };
    let Ok(req) = serde_json::from_slice::<ConversionRequest>(&body) else {
        return text(StatusCode::BAD_REQUEST, "Bad Request");
    };
    let input = match req.into_media_input() {
        Ok(input) => input,
        Err(failure) => return failure.into_response(),
    };
    let input = match load_media_input(&app, input, MediaInputLimit::INTERNAL_REQUEST).await {
        Ok(input) => input,
        Err(failure) => return failure.into_response(),
    };
    let runtime = app.media.transforms();
    let media_limits = runtime.limits();
    let deadline_ms = Some(metrics::now_ms() + CONVERSION_TIMEOUT_MS);
    let cost_data = input.data.clone();
    let data = input.data;
    let result = runtime
        .tasks()
        .run_native(
            deadline_instant(deadline_ms),
            move || {
                Ok(media_process::animated_avif_conversion_cost(
                    &cost_data,
                    &media_limits,
                )?)
            },
            move || {
                Ok(media_process::convert_animated_avif_to_webp(
                    &data,
                    &media_limits,
                    deadline_ms,
                )?)
            },
        )
        .await;
    match result {
        Ok(AnimatedAvifConversion::NotAnimatedAvif) => text_with_reason(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unprocessable Entity",
            "not_animated_avif",
        ),
        Ok(AnimatedAvifConversion::Converted(converted)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/webp")
            .header(header::CONTENT_LENGTH, converted.bytes.len())
            .header(WIDTH_HEADER, converted.width)
            .header(HEIGHT_HEADER, converted.height)
            .header(FRAMES_HEADER, converted.frames)
            .body(Body::from(converted.bytes))
            .unwrap_or_else(|_| text(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")),
        Err(error) => match error.downcast_ref::<MediaError>() {
            Some(
                MediaError::StreamTooLong
                | MediaError::TooLargeToProcess
                | MediaError::InvalidImageDimensions,
            ) => text_with_source(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Payload Too Large",
                "animation_too_large",
                error,
            ),
            Some(MediaError::RequestTimeout) => text_with_source(
                StatusCode::GATEWAY_TIMEOUT,
                "Gateway Timeout",
                "conversion_timeout",
                error,
            ),
            Some(MediaError::AllocationFailed) => text_with_source(
                StatusCode::SERVICE_UNAVAILABLE,
                "Service Unavailable",
                "conversion_busy",
                error,
            ),
            Some(_) => text_with_source(
                StatusCode::BAD_REQUEST,
                "Bad Request",
                "conversion_failed",
                error,
            ),
            None => text_with_source(
                StatusCode::SERVICE_UNAVAILABLE,
                "Service Unavailable",
                "conversion_busy",
                error,
            ),
        },
    }
}

/// The internal bearer check of `routes/internal.rs`, which keeps its own private. Compared in
/// constant time, as there.
pub(super) fn internal_auth_matches(headers: &HeaderMap, secret: &str) -> bool {
    let Some(auth) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let expected = format!("Bearer {secret}");
    auth.len() == expected.len()
        && auth
            .bytes()
            .zip(expected.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}

/// The body limit of `routes/internal.rs`'s private `read_limited_body`.
pub(super) async fn read_body(request: Request<Body>) -> Result<Bytes, StatusCode> {
    let body = to_bytes(
        request.into_body(),
        constants::MAX_INTERNAL_REQUEST_BODY_BYTES + 1,
    )
    .await
    .map_err(|_| StatusCode::BAD_REQUEST)?;
    if body.len() > constants::MAX_INTERNAL_REQUEST_BODY_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn auth_needs_the_exact_bearer_secret() {
        let mut headers = HeaderMap::new();
        assert!(!internal_auth_matches(&headers, "secret"));
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer secret"),
        );
        assert!(internal_auth_matches(&headers, "secret"));
        assert!(!internal_auth_matches(&headers, "secreT"));
        assert!(!internal_auth_matches(&headers, "secret2"));
    }

    #[test]
    fn requests_name_their_input_as_strip_requests_do() {
        let parse = |json: &str| {
            serde_json::from_str::<ConversionRequest>(json)
                .unwrap()
                .into_media_input()
        };
        assert!(matches!(
            parse(r#"{"type":"s3","bucket":"uploads","key":"k"}"#),
            Ok(MediaInput::Storage { .. })
        ));
        assert!(matches!(
            parse(r#"{"type":"upload","upload_filename":"k"}"#),
            Ok(MediaInput::Upload { .. })
        ));
        assert!(matches!(
            parse(r#"{"type":"base64","base64":"AA=="}"#),
            Ok(MediaInput::Base64 { .. })
        ));
        assert!(parse(r#"{"type":"s3","bucket":"uploads"}"#).is_err());
        assert!(parse(r#"{"type":"external","url":"https://example.com"}"#).is_err());
    }
}
