// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: `?original=true` on an image asset (avatars, banners and the rest `serve_asset_image`
//! serves) answers with the stored image itself instead of a resized, re-encoded copy
//! (tyne-chat/tyne#471). The app's "Open avatar in browser" and "Copy avatar URL" use it, so
//! people get the best copy there is: the upload when the crop step kept it, otherwise the crop.
//!
//! The URL's extension and `size` do not matter. A format browsers show is sent byte for byte,
//! with its own content type and a filename with its own extension. This exposes nothing new:
//! upstream already sends the stored bytes for a request in the stored format at its size or
//! larger. SVG is never sent as it is from the media origin (it can carry scripts), and HEIC, HEIF
//! or JPEG XL would not display: those are converted to a lossless PNG, an SVG fitted to the
//! asset's largest size, a raster image at its own size.

use crate::{
    asset_hash::AssetHash,
    constants::{self, AssetKind},
    image_quality::ImageQuality,
    image_transform::{AnimationMode, ResizeMode},
    media_process, mime,
    output_format::OutputFormat,
    server::{
        asset_path::ParsedAssetPath,
        format_policy::extension_from_mime,
        params::bool_param,
        response::{
            GeneratedMediaResponse, MediaResponse, content_disposition_header,
            error::text_with_source, generated_media_response, media_response,
        },
        state::AppState,
        transform::{
            cache::{CachedTransformRequest, cached_transform, coalescer_failure_response},
            cache_key::{TransformCacheKeyInput, transform_cache_key},
            execution::{coalesced_work_result, deadline_instant, run_transform},
            parameters::TransformRoute,
        },
    },
    storage,
};
use axum::{
    http::{Method, StatusCode},
    response::Response,
};
use std::{collections::HashMap, sync::Arc};

/// Formats sent as stored: every browser the apps run in shows them.
const SENT_AS_STORED: &[&str] = &[
    "image/png",
    "image/apng",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
];

pub(super) fn requested(params: &HashMap<String, String>) -> bool {
    bool_param(params, "original", false)
}

pub(super) struct OriginalAssetRequest<'a> {
    pub(super) app: &'a Arc<AppState>,
    pub(super) method: Method,
    pub(super) asset: &'a ParsedAssetPath,
    pub(super) object: storage::Object,
    pub(super) content_identity: &'a str,
    pub(super) sniffed: mime::SniffInfo,
    pub(super) range_header: Option<&'a str>,
    pub(super) requested_download: bool,
}

pub(super) async fn serve(request: OriginalAssetRequest<'_>) -> Response {
    let OriginalAssetRequest {
        app,
        method,
        asset,
        object,
        content_identity,
        sniffed,
        range_header,
        requested_download,
    } = request;
    let digest = AssetHash::parse(&asset.hash).digest();
    if SENT_AS_STORED.contains(&sniffed.mime) {
        let filename = format!("{digest}.{}", stored_extension(sniffed.mime));
        return media_response(MediaResponse {
            method,
            data: object.data.into(),
            content_type: sniffed.mime,
            range_header,
            disposition: Some(content_disposition_header(
                sniffed.mime,
                requested_download,
                Some(&filename),
            )),
        });
    }
    let (width, height) = conversion_size(asset.kind, sniffed.mime);
    let runtime = app.media.transforms();
    let format = OutputFormat::PNG;
    let quality = ImageQuality::Lossless;
    let options = media_process::ImageOptions {
        width: Some(width),
        height: Some(height),
        format,
        quality,
        animation: AnimationMode::Static,
        effort_override: None,
        resize_mode: ResizeMode::Fit,
        deadline_ms: runtime.transform_deadline_ms(),
    };
    let cache_identity = format!("{content_identity}:fork-original");
    let cache_key = transform_cache_key(TransformCacheKeyInput {
        route: TransformRoute::Asset,
        asset_kind: Some(asset.kind),
        cache_identity: &cache_identity,
        width: options.width,
        height: options.height,
        format,
        quality: Some(quality),
        animated: false,
        effort: None,
        resize_mode: Some(options.resize_mode),
    });
    let data = object.data;
    let converted = cached_transform(CachedTransformRequest {
        runtime,
        cache_key,
        format,
        deadline: deadline_instant(options.deadline_ms),
        work: move || async move {
            coalesced_work_result(run_transform(runtime, data, options).await)
                .map(|media| media_process::MediaBytes::from(media.bytes))
        },
    })
    .await;
    let converted = match converted {
        Ok(bytes) => bytes.as_bytes().clone(),
        Err(error) => {
            if let Some(response) =
                coalescer_failure_response(error, "coalescer_timeout_original_asset")
            {
                return response;
            }
            return text_with_source(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Transcode Failed",
                "transcode_failed",
                format!(
                    "original asset key={} src={}",
                    asset.storage_key, sniffed.mime
                ),
            );
        }
    };
    let filename = format!("{digest}.png");
    generated_media_response(GeneratedMediaResponse {
        method,
        data: converted.into(),
        content_type: format.mime(),
        disposition: Some(content_disposition_header(
            format.mime(),
            requested_download,
            Some(&filename),
        )),
    })
}

fn stored_extension(sniffed_mime: &str) -> &'static str {
    match extension_from_mime(sniffed_mime) {
        Some(constants::AssetExtension::Apng) | None => "png",
        Some(extension) => extension.name(),
    }
}

/// The box a converted image is fitted into. The transform never enlarges. A raster image keeps
/// its own size: its box is the largest image the proxy decodes. An SVG is drawn at its declared
/// size, shrunk when it declares more than the largest size the apps store for that kind of asset:
/// 1024 for avatars, a 2048-wide banner.
fn conversion_size(kind: AssetKind, sniffed_mime: &str) -> (u32, u32) {
    if sniffed_mime != "image/svg+xml" {
        let max = constants::MAX_MEDIA_IMAGE_DIMENSION_DEFAULT;
        return (max, max);
    }
    match kind {
        AssetKind::Banner | AssetKind::Splash | AssetKind::EmbedSplash => (2048, 1152),
        _ => {
            let max = constants::dims_for(kind).max;
            (max, max)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::serve_asset_image;
    use super::*;
    use crate::{config::Config, server::asset_path::parse_standard_asset_path, test_fixtures};
    use axum::{
        body::to_bytes,
        http::{HeaderMap, HeaderValue, header},
    };
    use std::path::Path;

    const OWNER: &str = "4242";
    const HASH: &str = "a1b2c3d4";

    struct Fixture {
        _tmp: tempfile::TempDir,
        app: Arc<AppState>,
        root: std::path::PathBuf,
    }

    fn fixture() -> Fixture {
        let tmp = tempfile::tempdir().expect("temp storage root");
        let root = tmp.path().canonicalize().expect("canonical storage root");
        let app = Arc::new(AppState::for_tests(
            Config::load_from_iter([
                (
                    "FLUXER_MEDIA_PROXY_SECRET_KEY".to_owned(),
                    "secret".to_owned(),
                ),
                (
                    "FLUXER_MEDIA_PROXY_STORAGE_BACKEND".to_owned(),
                    "local".to_owned(),
                ),
                (
                    "FLUXER_MEDIA_PROXY_STORAGE_ROOT".to_owned(),
                    root.display().to_string(),
                ),
            ])
            .expect("original asset test config"),
        ));
        Fixture {
            _tmp: tmp,
            app,
            root,
        }
    }

    /// Stores `body` the way the API does: no extension, no content type.
    fn store(root: &Path, key: &str, body: &[u8]) {
        let path = root.join("cdn").join(key);
        std::fs::create_dir_all(path.parent().expect("object parent")).expect("bucket dir");
        std::fs::write(path, body).expect("write object");
    }

    async fn get(app: &Arc<AppState>, path: &str, query: &[(&str, &str)]) -> Response {
        let asset = parse_standard_asset_path(path).expect("asset path");
        let params = query
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect();
        serve_asset_image(app, Method::GET, asset, &params, &HeaderMap::new()).await
    }

    async fn body(response: Response) -> Vec<u8> {
        to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body")
            .to_vec()
    }

    fn header_of(response: &Response, name: header::HeaderName) -> String {
        response
            .headers()
            .get(name)
            .map(HeaderValue::to_str)
            .and_then(Result::ok)
            .unwrap_or_default()
            .to_owned()
    }

    fn svg(width: u32, height: u32) -> Vec<u8> {
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\">\
             <rect width=\"{width}\" height=\"{height}\" fill=\"#3a7\"/></svg>"
        )
        .into_bytes()
    }

    #[tokio::test]
    async fn browser_formats_come_back_byte_for_byte_whatever_the_url_asks_for() {
        let fixture = fixture();
        let cases = [
            ("image/png", "png", test_fixtures::synthetic_png(300, 300)),
            (
                "image/jpeg",
                "jpeg",
                test_fixtures::synthetic_image(300, 300, ".jpg[Q=80]"),
            ),
            (
                "image/webp",
                "webp",
                test_fixtures::synthetic_image(300, 300, ".webp[Q=80]"),
            ),
            (
                "image/gif",
                "gif",
                test_fixtures::synthetic_image(40, 80, ".gif[page-height=40]"),
            ),
            (
                "image/webp",
                "webp",
                test_fixtures::synthetic_image(40, 80, ".webp[page-height=40]"),
            ),
        ];
        for (index, (mime, extension, bytes)) in cases.into_iter().enumerate() {
            let owner = (5000 + index).to_string();
            store(&fixture.root, &format!("avatars/{owner}/{HASH}"), &bytes);
            for url_extension in ["png", "webp", "gif"] {
                let path = format!("/avatars/{owner}/{HASH}.{url_extension}");
                let response = get(
                    &fixture.app,
                    &path,
                    &[("original", "true"), ("size", "160")],
                )
                .await;
                assert_eq!(
                    StatusCode::OK,
                    response.status(),
                    "{mime} as .{url_extension}"
                );
                assert_eq!(mime, header_of(&response, header::CONTENT_TYPE));
                let disposition = header_of(&response, header::CONTENT_DISPOSITION);
                assert!(
                    disposition.starts_with("inline")
                        && disposition.contains(&format!("{HASH}.{extension}")),
                    "{mime}: {disposition}"
                );
                assert_eq!(bytes, body(response).await, "{mime} as .{url_extension}");
            }
        }
    }

    #[tokio::test]
    async fn animated_avatars_and_banners_keep_their_animation() {
        let fixture = fixture();
        let gif = test_fixtures::synthetic_image(40, 80, ".gif[page-height=40]");
        assert!(mime::sniff(&gif).animated, "fixture is animated");
        store(&fixture.root, &format!("banners/{OWNER}/{HASH}"), &gif);
        let path = format!("/banners/{OWNER}/a_{HASH}.png");
        let response = get(&fixture.app, &path, &[("original", "1")]).await;
        assert_eq!("image/gif", header_of(&response, header::CONTENT_TYPE));
        assert_eq!(gif, body(response).await);
    }

    #[tokio::test]
    async fn without_the_parameter_upstreams_resized_copy_is_unchanged() {
        let fixture = fixture();
        let png = test_fixtures::synthetic_png(300, 300);
        store(&fixture.root, &format!("avatars/{OWNER}/{HASH}"), &png);
        let path = format!("/avatars/{OWNER}/{HASH}.webp");
        for query in [
            &[("size", "160")][..],
            &[("size", "160"), ("original", "false")],
        ] {
            let response = get(&fixture.app, &path, query).await;
            assert_eq!(StatusCode::OK, response.status());
            assert_eq!("image/webp", header_of(&response, header::CONTENT_TYPE));
            let info = mime::sniff(&body(response).await);
            assert_eq!((160, 160), (info.width, info.height), "{query:?}");
        }
    }

    #[tokio::test]
    async fn svg_is_never_sent_raw_and_comes_back_as_a_png_fitted_to_the_asset() {
        let fixture = fixture();
        for (prefix, declared, expected) in [
            ("avatars", (3000, 3000), (1024, 1024)),
            ("avatars", (64, 64), (64, 64)),
            ("banners", (3400, 1200), (2048, 723)),
        ] {
            let owner = (6000 + declared.0).to_string();
            store(
                &fixture.root,
                &format!("{prefix}/{owner}/{HASH}"),
                &svg(declared.0, declared.1),
            );
            let path = format!("/{prefix}/{owner}/{HASH}.png");
            let response = get(&fixture.app, &path, &[("original", "true")]).await;
            assert_eq!(StatusCode::OK, response.status(), "{prefix} {declared:?}");
            assert_eq!("image/png", header_of(&response, header::CONTENT_TYPE));
            assert!(
                header_of(&response, header::CONTENT_DISPOSITION).contains(&format!("{HASH}.png"))
            );
            let info = mime::sniff(&body(response).await);
            assert_eq!("image/png", info.mime);
            let (width, height) = (info.width, info.height);
            assert_eq!(expected.0, width, "{prefix} {declared:?}");
            assert!(
                height.abs_diff(expected.1) <= 1,
                "{prefix} {declared:?}: {height}"
            );
        }
    }

    #[tokio::test]
    async fn formats_browsers_cannot_show_become_a_lossless_png_at_their_own_size() {
        let fixture = fixture();
        let tiff = test_fixtures::synthetic_image(1500, 900, ".tif");
        assert_eq!("image/tiff", mime::sniff(&tiff).mime);
        store(&fixture.root, &format!("avatars/{OWNER}/{HASH}"), &tiff);
        let path = format!("/avatars/{OWNER}/{HASH}.png");
        let response = get(
            &fixture.app,
            &path,
            &[("original", "true"), ("size", "160")],
        )
        .await;
        assert_eq!(StatusCode::OK, response.status());
        assert_eq!("image/png", header_of(&response, header::CONTENT_TYPE));
        let png = body(response).await;
        let info = mime::sniff(&png);
        assert_eq!((1500, 900), (info.width, info.height));
        let original = test_fixtures::synthetic_png(1500, 900);
        assert_eq!(
            decoded(&original),
            decoded(&png),
            "the conversion is lossless"
        );
    }

    #[tokio::test]
    async fn server_profile_avatars_are_served_the_same_way() {
        let fixture = fixture();
        let jpeg = test_fixtures::synthetic_image(200, 200, ".jpg[Q=80]");
        store(
            &fixture.root,
            &format!("guilds/11/users/{OWNER}/avatars/{HASH}"),
            &jpeg,
        );
        let asset = crate::server::asset_path::parse_guild_member_asset_path(&format!(
            "/guilds/11/users/{OWNER}/avatars/{HASH}.png"
        ))
        .expect("guild member asset path");
        let params = HashMap::from([("original".to_owned(), "true".to_owned())]);
        let response =
            serve_asset_image(&fixture.app, Method::GET, asset, &params, &HeaderMap::new()).await;
        assert_eq!("image/jpeg", header_of(&response, header::CONTENT_TYPE));
        assert_eq!(jpeg, body(response).await);
    }

    /// The RGBA pixels of an image, to compare two encodings of it.
    fn decoded(image: &[u8]) -> Vec<u8> {
        let options = media_process::ImageOptions {
            format: OutputFormat::PNG,
            quality: ImageQuality::Lossless,
            ..Default::default()
        };
        let reencoded = media_process::transform_image(
            image,
            &options,
            &crate::media_limits::MediaLimits::default_from_config(),
            &crate::metrics::Metrics::new().transform(),
        )
        .expect("decodes");
        reencoded.bytes
    }
}
