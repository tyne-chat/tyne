// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork (tyne-chat/tyne#873): the audio player's cover and waveform.
//!
//! - `POST /_fork/audio_extras`, through which the API reads an audio upload's embedded cover and
//!   its waveform (`media_process::audio_extras`). The body names the input as `/_strip`'s does
//!   (`{"type": "s3", "bucket", "key"}`, `"upload"` or `"base64"`). Answers 200 with
//!   `{"waveform": base64 | null, "cover": {"base64", "content_type", "width", "height"} | null}`;
//!   400 `extras_failed` when FFmpeg cannot open the file, 503 or 504 when busy or too slow. The API
//!   treats every failure as "no cover, no waveform".
//! - `cover=1` on an attachment's URL ([`extras_request`]) serves that attachment's cover, which the
//!   API stores at [`cover_key`], instead of the file; `waveform=1` serves its waveform, stored at
//!   [`waveform_key`] as raw bytes (0-255 each), for links to the attachment, whose embeds carry no
//!   waveform. The signature is checked on the attachment's own path first, so both are readable by
//!   exactly those who can read the file; the parameters are not signed, as the other transform
//!   parameters are not.

use super::fork_animated_avif::{ConversionRequest, internal_auth_matches, read_body};
use crate::{
    media_process::{self, MediaError},
    metrics, mime,
    server::{
        media_operations::{MediaInput, MediaInputLimit, load_media_input, spool_stored_media},
        response::error::{text, text_with_source},
        state::AppState,
        transform::execution::deadline_instant,
    },
};
use axum::{
    Router,
    body::Body,
    extract::State,
    http::{HeaderMap, Request, StatusCode, header},
    response::Response,
    routing::post,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{collections::HashMap, sync::Arc};

const ROUTE: &str = "/_fork/audio_extras";
/// Decoding the whole file for the waveform; the API waits a little longer than this.
const EXTRAS_TIMEOUT_MS: i64 = 30 * 1000;
const COVER_PARAMETER: &str = "cover";
const WAVEFORM_PARAMETER: &str = "waveform";

pub(in crate::server) fn with_routes(router: Router<Arc<AppState>>) -> Router<Arc<AppState>> {
    router.route(ROUTE, post(extras_handler))
}

/// Where the API stores attachment `attachments/<channel>/<attachment>/<file>`'s cover: a namespace
/// of its own, so that no upload's name can collide with it.
pub(in crate::server) fn cover_key(attachment_key: &str) -> Option<String> {
    extra_key("attachment-covers", attachment_key)
}

/// Where the API stores that attachment's waveform, in a namespace of its own as the cover is.
pub(in crate::server) fn waveform_key(attachment_key: &str) -> Option<String> {
    extra_key("attachment-waveforms", attachment_key)
}

fn extra_key(namespace: &str, attachment_key: &str) -> Option<String> {
    let mut parts = attachment_key.strip_prefix("attachments/")?.split('/');
    let channel = parts
        .next()
        .filter(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))?;
    let attachment = parts
        .next()
        .filter(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))?;
    parts.next().filter(|p| !p.is_empty())?;
    Some(format!("{namespace}/{channel}/{attachment}"))
}

/// With `cover=1`, the cover's key and the other parameters (resizing and format apply to the
/// cover). With `waveform=1`, the waveform's key and no parameters, so its bytes are sent as stored.
/// Otherwise both unchanged. A key that names no attachment becomes one that does not exist, so the
/// request is answered 404.
pub(in crate::server) fn extras_request(
    key: String,
    mut params: HashMap<String, String>,
) -> (String, HashMap<String, String>) {
    let asks = |value: Option<String>| value.is_some_and(|value| value == "1" || value == "true");
    if asks(params.remove(WAVEFORM_PARAMETER)) {
        let waveform =
            waveform_key(&key).unwrap_or_else(|| "attachment-waveforms/missing".to_owned());
        return (waveform, HashMap::new());
    }
    if asks(params.remove(COVER_PARAMETER)) {
        let cover = cover_key(&key).unwrap_or_else(|| "attachment-covers/missing".to_owned());
        return (cover, params);
    }
    (key, params)
}

#[derive(serde::Serialize)]
struct ExtrasResponse {
    waveform: Option<String>,
    cover: Option<CoverResponse>,
}

#[derive(serde::Serialize)]
struct CoverResponse {
    base64: String,
    content_type: &'static str,
    width: u32,
    height: u32,
}

async fn extras_handler(
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
    let (data, held_in_memory) = match input {
        // A stored file is streamed to a file on disk and read through a memory map (upstream's
        // `spool_stored_media`, its path for stored media over the in-memory limit), so even an
        // hour-long recording costs disk, not memory: the waveform is computed in constant memory.
        MediaInput::Storage { bucket, key, .. } => {
            match spool_stored_media(
                &app,
                &bucket,
                &key,
                &[mime::Category::Audio, mime::Category::Video],
            )
            .await
            {
                Ok(object) => (object.data, 0),
                Err(error) => {
                    return text_with_source(
                        StatusCode::BAD_REQUEST,
                        "Bad Request",
                        "extras_read_failed",
                        error,
                    );
                }
            }
        }
        other => match load_media_input(&app, other, MediaInputLimit::INTERNAL_REQUEST).await {
            Ok(input) => {
                let len = input.data.len();
                (input.data, len)
            }
            Err(failure) => return failure.into_response(),
        },
    };
    let runtime = app.media.transforms();
    let media_limits = runtime.limits();
    let deadline_ms = Some(metrics::now_ms() + EXTRAS_TIMEOUT_MS);
    // Mapped from disk, a stored input is not memory the native budget has to hold: the base cost
    // only. An input sent in the request is held in memory and counts.
    let cost = media_process::av_native_cost(held_in_memory);
    let result = runtime
        .tasks()
        .run_native(
            deadline_instant(deadline_ms),
            move || Ok(cost),
            move || {
                Ok(media_process::audio_extras(
                    &data,
                    &media_limits,
                    deadline_ms,
                    media_process::MAX_WAVEFORM_SECONDS,
                )?)
            },
        )
        .await;
    match result {
        Ok(extras) => {
            let response = ExtrasResponse {
                waveform: extras.waveform.map(|points| STANDARD.encode(points)),
                cover: extras.cover.map(|cover| CoverResponse {
                    base64: STANDARD.encode(&cover.bytes),
                    content_type: cover.content_type,
                    width: cover.width,
                    height: cover.height,
                }),
            };
            match serde_json::to_vec(&response) {
                Ok(json) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json))
                    .unwrap_or_else(|_| {
                        text(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
                    }),
                Err(_) => text(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error"),
            }
        }
        Err(error) => match error.downcast_ref::<MediaError>() {
            Some(MediaError::RequestTimeout) => text_with_source(
                StatusCode::GATEWAY_TIMEOUT,
                "Gateway Timeout",
                "extras_timeout",
                error,
            ),
            Some(MediaError::AllocationFailed) | None => text_with_source(
                StatusCode::SERVICE_UNAVAILABLE,
                "Service Unavailable",
                "extras_busy",
                error,
            ),
            Some(_) => text_with_source(
                StatusCode::BAD_REQUEST,
                "Bad Request",
                "extras_failed",
                error,
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cover_lives_in_its_own_namespace() {
        assert_eq!(
            cover_key("attachments/123/456/Spell.wav").as_deref(),
            Some("attachment-covers/123/456")
        );
        assert_eq!(
            cover_key("attachments/123/456/a/b.wav").as_deref(),
            Some("attachment-covers/123/456")
        );
        assert_eq!(cover_key("attachments/123/456/"), None);
        assert_eq!(cover_key("attachments/12x/456/a.wav"), None);
        assert_eq!(cover_key("emojis/123/456/a.wav"), None);
    }

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn cover_1_swaps_the_key_and_keeps_the_resizing() {
        let (key, rest) = extras_request(
            "attachments/1/2/a.mp3".to_owned(),
            params(&[("cover", "1"), ("width", "160"), ("format", "webp")]),
        );
        assert_eq!(key, "attachment-covers/1/2");
        assert_eq!(rest, params(&[("width", "160"), ("format", "webp")]));
    }

    #[test]
    fn without_cover_1_nothing_changes() {
        let (key, rest) = extras_request(
            "attachments/1/2/a.mp3".to_owned(),
            params(&[("cover", "0")]),
        );
        assert_eq!(key, "attachments/1/2/a.mp3");
        assert!(rest.is_empty());
        let (key, rest) = extras_request(
            "attachments/1/2/a.mp3".to_owned(),
            params(&[("width", "10")]),
        );
        assert_eq!(key, "attachments/1/2/a.mp3");
        assert_eq!(rest, params(&[("width", "10")]));
    }

    #[test]
    fn waveform_1_swaps_the_key_and_drops_every_transform() {
        assert_eq!(
            waveform_key("attachments/123/456/Spell.wav").as_deref(),
            Some("attachment-waveforms/123/456")
        );
        let (key, rest) = extras_request(
            "attachments/1/2/a.mp3".to_owned(),
            params(&[("waveform", "1"), ("width", "160"), ("cover", "1")]),
        );
        assert_eq!(key, "attachment-waveforms/1/2");
        assert!(rest.is_empty());
        let (key, _) = extras_request("emojis/1/2/a.mp3".to_owned(), params(&[("waveform", "1")]));
        assert_eq!(key, "attachment-waveforms/missing");
    }

    #[test]
    fn a_cover_of_something_that_is_no_attachment_is_not_found() {
        let (key, _) = extras_request("attachments/x/y".to_owned(), params(&[("cover", "1")]));
        assert_eq!(key, "attachment-covers/missing");
    }
}
