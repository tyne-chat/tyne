// SPDX-License-Identifier: AGPL-3.0-or-later
//! Fork: a sticker is scaled to fit the requested size, keeping its shape, instead of being
//! cropped to a square (tyne-chat/tyne#659). Upstream crops emoji and stickers alike, which
//! removes nothing from the stickers the apps square before upload, but cuts the sides off
//! animated stickers (uploaded as they are) and off stickers kept at their original size
//! (tyne-chat/tyne#658). The apps show stickers with `object-fit: contain` on the web and sized
//! from their aspect ratio on the phone. Emoji keep upstream's crop.
use crate::{constants::AssetKind, image_transform::ResizeMode};

/// The resize mode for `kind`, given the one upstream picked.
pub(super) fn resize_mode(kind: AssetKind, upstream: ResizeMode) -> ResizeMode {
    if kind == AssetKind::Sticker {
        ResizeMode::Fit
    } else {
        upstream
    }
}

#[cfg(test)]
mod tests {
    use super::super::serve_asset_image;
    use super::*;
    use crate::{
        config::Config, mime, server::asset_path::parse_simple_asset_path, server::state::AppState,
        test_fixtures,
    };
    use axum::{
        body::to_bytes,
        http::{HeaderMap, Method, StatusCode},
    };
    use std::sync::Arc;

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
            .expect("sticker fit test config"),
        ));
        Fixture {
            _tmp: tmp,
            app,
            root,
        }
    }

    /// Stores `body` under `key` the way the API does (no extension, no content type), then asks
    /// for `path` (an emoji or sticker URL) with `query` and returns the status and the response's
    /// sniffed size.
    async fn served_size(
        fixture: &Fixture,
        kind: AssetKind,
        key: &str,
        body: &[u8],
        path: &str,
        query: &[(&str, &str)],
    ) -> (StatusCode, u32, u32) {
        let file = fixture.root.join("cdn").join(key);
        std::fs::create_dir_all(file.parent().expect("object parent")).expect("bucket dir");
        std::fs::write(file, body).expect("write object");
        let asset = parse_simple_asset_path(path, kind).expect("asset path");
        let params = query
            .iter()
            .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
            .collect();
        let response =
            serve_asset_image(&fixture.app, Method::GET, asset, &params, &HeaderMap::new()).await;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body");
        let info = mime::sniff(&bytes);
        (status, info.width, info.height)
    }

    #[test]
    fn only_stickers_change_mode() {
        assert_eq!(
            ResizeMode::Fit,
            resize_mode(AssetKind::Sticker, ResizeMode::Cover)
        );
        assert_eq!(
            ResizeMode::Cover,
            resize_mode(AssetKind::Emoji, ResizeMode::Cover)
        );
        assert_eq!(
            ResizeMode::Fit,
            resize_mode(AssetKind::Avatar, ResizeMode::Fit)
        );
    }

    #[tokio::test]
    async fn a_wide_sticker_is_shrunk_whole_not_cropped() {
        let fixture = fixture();
        let png = test_fixtures::synthetic_png(400, 200);
        let (status, width, height) = served_size(
            &fixture,
            AssetKind::Sticker,
            "stickers/111",
            &png,
            "/stickers/111.webp",
            &[("size", "160")],
        )
        .await;
        assert_eq!(StatusCode::OK, status);
        assert_eq!((160, 80), (width, height));
    }

    /// The still frame the apps show while an animated sticker is not playing. Upstream already
    /// keeps the whole frame when the animation is asked for; the still was cropped.
    #[tokio::test]
    async fn the_still_frame_of_a_tall_animated_sticker_is_shrunk_whole_not_cropped() {
        let fixture = fixture();
        // Two frames of 200×400.
        let gif = test_fixtures::synthetic_image(200, 800, ".gif[page-height=400]");
        for (key, query) in [
            ("222", &[("size", "160")][..]),
            ("223", &[("size", "160"), ("animated", "true")][..]),
        ] {
            let (status, width, height) = served_size(
                &fixture,
                AssetKind::Sticker,
                &format!("stickers/{key}"),
                &gif,
                &format!("/stickers/{key}.webp"),
                query,
            )
            .await;
            assert_eq!(StatusCode::OK, status, "{query:?}");
            assert_eq!((80, 160), (width, height), "{query:?}");
        }
    }

    #[tokio::test]
    async fn a_sticker_smaller_than_the_size_asked_for_is_not_enlarged() {
        let fixture = fixture();
        let png = test_fixtures::synthetic_png(120, 60);
        let (status, width, height) = served_size(
            &fixture,
            AssetKind::Sticker,
            "stickers/333",
            &png,
            "/stickers/333.webp",
            &[("size", "320")],
        )
        .await;
        assert_eq!(StatusCode::OK, status);
        assert_eq!((120, 60), (width, height));
    }

    #[tokio::test]
    async fn emoji_are_still_cropped_to_a_square() {
        let fixture = fixture();
        let png = test_fixtures::synthetic_png(400, 200);
        let (status, width, height) = served_size(
            &fixture,
            AssetKind::Emoji,
            "emojis/444",
            &png,
            "/emojis/444.webp",
            &[("size", "64")],
        )
        .await;
        assert_eq!(StatusCode::OK, status);
        assert_eq!((64, 64), (width, height));
    }
}
