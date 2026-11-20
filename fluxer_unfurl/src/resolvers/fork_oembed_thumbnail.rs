// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the oEmbed thumbnail is only a fallback for pages without OpenGraph images
// (tyne-chat/tyne#843). Sites such as Spotify serve the same picture at a second URL as the
// oEmbed thumbnail (a resized copy on another CDN host); upstream's URL dedupe cannot see that,
// so the copy became a second gallery image and the preview showed the cover twice.

use super::default_helpers::{ImageCandidate, normalize_url, resolve_media_url};
use crate::html_parser::OgMetadata;
use crate::oembed::OEmbedResponse;
use url::Url;

fn resolved_key(base_url: &Url, value: &str) -> Option<String> {
    normalize_url(&resolve_media_url(base_url, value)?)
}

pub(crate) fn drop_redundant_oembed_thumbnail(
    candidates: &mut Vec<ImageCandidate>,
    base_url: &Url,
    og: &OgMetadata,
    oembed: Option<&OEmbedResponse>,
) {
    let Some(o) = oembed else {
        return;
    };
    let Some(thumbnail) = o
        .thumbnail_url
        .as_deref()
        .and_then(|u| resolved_key(base_url, u))
    else {
        return;
    };
    let mut og_keys = og
        .images
        .iter()
        .filter_map(|u| resolved_key(base_url, u))
        .peekable();
    if og_keys.peek().is_none() || og_keys.any(|k| k == thumbnail) {
        return;
    }
    let is_photo = o
        .oembed_type
        .as_deref()
        .is_some_and(|t| t.eq_ignore_ascii_case("photo"));
    if is_photo
        && o.url
            .as_deref()
            .and_then(|u| resolved_key(base_url, u))
            .is_some_and(|k| k == thumbnail)
    {
        return;
    }
    candidates.retain(|c| normalize_url(&c.url).as_deref() != Some(thumbnail.as_str()));
}

#[cfg(test)]
mod tests {
    use super::super::default_helpers::build_image_candidates;
    use crate::html_parser::OgMetadata;
    use crate::oembed::OEmbedResponse;
    use url::Url;

    const OG_COVER: &str = "https://i.scdn.co/image/ab67616d0000b273a73093187d6a29edc229918a";
    const OEMBED_COVER: &str =
        "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02a73093187d6a29edc229918a";

    fn page() -> Url {
        Url::parse("https://open.spotify.com/track/2TSYi0kaRDCnfm6KCd3elT").unwrap()
    }

    fn og(images: &[&str]) -> OgMetadata {
        OgMetadata {
            images: images.iter().map(|s| (*s).to_owned()).collect(),
            ..Default::default()
        }
    }

    fn oembed(kind: &str, thumbnail: Option<&str>, url: Option<&str>) -> OEmbedResponse {
        OEmbedResponse {
            oembed_type: Some(kind.to_owned()),
            thumbnail_url: thumbnail.map(str::to_owned),
            url: url.map(str::to_owned),
            ..Default::default()
        }
    }

    fn urls(og: &OgMetadata, oembed: Option<&OEmbedResponse>) -> Vec<String> {
        build_image_candidates(&page(), og, oembed)
            .into_iter()
            .map(|c| c.url)
            .collect()
    }

    #[test]
    fn spotify_cover_is_not_doubled_by_the_oembed_thumbnail() {
        let o = oembed("rich", Some(OEMBED_COVER), None);
        assert_eq!(urls(&og(&[OG_COVER]), Some(&o)), vec![OG_COVER.to_owned()]);
    }

    #[test]
    fn oembed_thumbnail_is_used_when_the_page_has_no_og_image() {
        let o = oembed("rich", Some(OEMBED_COVER), None);
        assert_eq!(urls(&og(&[]), Some(&o)), vec![OEMBED_COVER.to_owned()]);
    }

    #[test]
    fn oembed_thumbnail_equal_to_og_image_stays_once() {
        let o = oembed("rich", Some(OG_COVER), None);
        assert_eq!(urls(&og(&[OG_COVER]), Some(&o)), vec![OG_COVER.to_owned()]);
    }

    #[test]
    fn several_og_images_stay_a_gallery() {
        let second = "https://i.scdn.co/image/second";
        let o = oembed("rich", Some(OEMBED_COVER), None);
        assert_eq!(
            urls(&og(&[OG_COVER, second]), Some(&o)),
            vec![OG_COVER.to_owned(), second.to_owned()]
        );
    }

    #[test]
    fn oembed_photo_url_is_kept() {
        let photo = "https://example.com/photo.jpg";
        let o = oembed("photo", Some(OEMBED_COVER), Some(photo));
        assert_eq!(
            urls(&og(&[OG_COVER]), Some(&o)),
            vec![OG_COVER.to_owned(), photo.to_owned()]
        );
    }

    #[test]
    fn oembed_photo_whose_thumbnail_is_the_photo_is_kept() {
        let photo = "https://example.com/photo.jpg";
        let o = oembed("photo", Some(photo), Some(photo));
        assert_eq!(
            urls(&og(&[OG_COVER]), Some(&o)),
            vec![OG_COVER.to_owned(), photo.to_owned()]
        );
    }
}
