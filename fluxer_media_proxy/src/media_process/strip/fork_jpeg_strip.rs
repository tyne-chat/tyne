// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: removes the JPEG metadata that upstream's strip (`jpeg.rs`) leaves in place.
//!
//! - Upstream filters only the segments before the first scan and copies the rest as it is. A
//!   progressive JPEG can carry application (APPn) and comment segments between its scans, and those
//!   are dropped here.
//! - Upstream keeps the JFIF segment whole, and with it the thumbnail JFIF can hold, and the JFXX
//!   extension, which exists to hold one. JFIF is kept without its thumbnail, and JFXX is dropped.
//!
//! A JPEG that has none of these comes back byte for byte. This never fails an upload: if upstream's
//! output cannot be read, the upload is re-encoded upright (`jpeg::reencode_upright`, which keeps
//! nothing but the ICC profile). If that fails too, upstream's output is kept, as before.

use super::jpeg::reencode_upright;
use crate::media_limits::MediaLimits;

const SOI: u8 = 0xD8;
const EOI: u8 = 0xD9;
const SOS: u8 = 0xDA;
const APP0: u8 = 0xE0;
const APP15: u8 = 0xEF;
const COM: u8 = 0xFE;
/// `JFIF\0`, version, density units, X and Y density: the JFIF fields before the thumbnail's size.
const JFIF_FIELDS: usize = 12;

#[derive(Debug, PartialEq)]
enum Unreadable {
    NotAJpeg,
    Truncated,
}

/// Applies the fork's filtering to `stripped`, upstream's strip of `input`, when it is a JPEG.
pub(super) fn finish(
    sniffed_mime: &str,
    stripped: Vec<u8>,
    input: &[u8],
    media_limits: &MediaLimits,
    deadline_ms: Option<i64>,
) -> Vec<u8> {
    if sniffed_mime != "image/jpeg" {
        return stripped;
    }
    match filter(&stripped) {
        Ok(Some(filtered)) => filtered,
        Ok(None) => stripped,
        Err(unreadable) => match reencode_upright(input, media_limits, deadline_ms) {
            Ok(reencoded) => {
                tracing::warn!(
                    ?unreadable,
                    "fork JPEG strip could not read the strip, re-encoded"
                );
                reencoded
            }
            Err(error) => {
                tracing::warn!(
                    ?unreadable,
                    ?error,
                    "fork JPEG strip could not read the strip or re-encode, kept upstream's"
                );
                stripped
            }
        },
    }
}

enum Action {
    Keep,
    Drop,
    Replace(Vec<u8>),
}

/// The JPEG without the segments the fork drops, or `None` when it has none of them. It walks the
/// file as upstream's `find_end_of_image` does: segments one after another until the first scan,
/// then entropy-coded data, where only a 0xFF that is not stuffing or a restart marker starts one.
fn filter(data: &[u8]) -> Result<Option<Vec<u8>>, Unreadable> {
    if data.get(..2) != Some(&[0xFF, SOI]) {
        return Err(Unreadable::NotAJpeg);
    }
    let mut output: Option<Vec<u8>> = None;
    let mut copied = 0;
    let mut offset = 2;
    let mut in_scans = false;
    while let Some(found) = data[offset..].iter().position(|&byte| byte == 0xFF) {
        let mut at = offset + found;
        while data.get(at + 1) == Some(&0xFF) {
            at += 1;
        }
        let Some(&marker) = data.get(at + 1) else {
            break;
        };
        if marker == 0x00 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            offset = at + 2;
            continue;
        }
        if marker == EOI {
            break;
        }
        let length = data
            .get(at + 2..at + 4)
            .map(|bytes| usize::from(u16::from_be_bytes([bytes[0], bytes[1]])))
            .filter(|&length| length >= 2)
            .ok_or(Unreadable::Truncated)?;
        let end = at + 2 + length;
        let payload = data.get(at + 4..end).ok_or(Unreadable::Truncated)?;
        let action = match marker {
            SOS => {
                in_scans = true;
                Action::Keep
            }
            APP0..=APP15 | COM if in_scans => Action::Drop,
            APP0 => app0_action(payload),
            _ => Action::Keep,
        };
        if !matches!(action, Action::Keep) {
            let out = output.get_or_insert_with(|| Vec::with_capacity(data.len()));
            out.extend_from_slice(&data[copied..at]);
            if let Action::Replace(segment) = action {
                out.extend_from_slice(&segment);
            }
            copied = end;
        }
        offset = end;
    }
    Ok(output.map(|mut out| {
        out.extend_from_slice(&data[copied..]);
        out
    }))
}

fn app0_action(payload: &[u8]) -> Action {
    if payload.starts_with(b"JFXX\0") {
        return Action::Drop;
    }
    if !payload.starts_with(b"JFIF\0") {
        return Action::Keep;
    }
    if payload.len() < JFIF_FIELDS + 2 {
        // Too short to be JFIF; decoders do not need it.
        return Action::Drop;
    }
    if payload.len() == JFIF_FIELDS + 2 && payload[JFIF_FIELDS..] == [0, 0] {
        return Action::Keep;
    }
    let mut segment = vec![0xFF, APP0, 0, (JFIF_FIELDS + 4) as u8];
    segment.extend_from_slice(&payload[..JFIF_FIELDS]);
    segment.extend_from_slice(&[0, 0]);
    Action::Replace(segment)
}

#[cfg(test)]
mod tests {
    use super::super::jpeg::strip_segments;
    use super::*;
    use crate::{media_process::native_runtime::ensure_vips_init, mime, test_fixtures};

    fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0xFF, marker];
        bytes.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(payload);
        bytes
    }

    fn insert(data: &[u8], at: usize, segments: &[Vec<u8>]) -> Vec<u8> {
        let mut out = data[..at].to_vec();
        for segment in segments {
            out.extend_from_slice(segment);
        }
        out.extend_from_slice(&data[at..]);
        out
    }

    /// Offsets of the scans: entropy-coded data stuffs every 0xFF, so FF DA always starts one.
    fn scan_offsets(data: &[u8]) -> Vec<usize> {
        data.windows(2)
            .enumerate()
            .filter(|(_, pair)| *pair == [0xFF, SOS])
            .map(|(index, _)| index)
            .collect()
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }

    fn strip_then_finish(input: &[u8]) -> Vec<u8> {
        let stripped = strip_segments(input).expect("upstream strip");
        finish(
            "image/jpeg",
            stripped,
            input,
            &MediaLimits::default_from_config(),
            None,
        )
    }

    fn progressive() -> Vec<u8> {
        test_fixtures::synthetic_image(96, 64, ".jpg[Q=85,interlace=true]")
    }

    #[test]
    fn segments_between_progressive_scans_are_dropped() {
        let clean = progressive();
        let scans = scan_offsets(&clean);
        assert!(scans.len() > 2, "fixture is progressive");
        let crafted = insert(
            &clean,
            scans[1],
            &[
                segment(COM, b"between the scans"),
                segment(0xE1, b"Exif\0\0GPS between the scans"),
            ],
        );
        let finished = strip_then_finish(&crafted);
        assert!(!contains(&finished, b"between the scans"));
        assert_eq!(
            strip_then_finish(&clean),
            finished,
            "only the inserted segments are gone"
        );
        assert_eq!("image/jpeg", mime::sniff(&finished).mime);
    }

    #[test]
    fn jfif_loses_its_thumbnail_and_jfxx_is_dropped() {
        let clean = progressive();
        let mut jfif = b"JFIF\0\x01\x02\x00\x00\x48\x00\x48\x02\x01".to_vec();
        jfif.extend_from_slice(b"THUMBNAIL!");
        let crafted = insert(
            &clean,
            2,
            &[segment(APP0, &jfif), segment(APP0, b"JFXX\0\x10THUMBNAIL!")],
        );
        let finished = strip_then_finish(&crafted);
        assert!(!contains(&finished, b"THUMBNAIL!"));
        assert!(!contains(&finished, b"JFXX"));
        let expected = segment(APP0, b"JFIF\0\x01\x02\x00\x00\x48\x00\x48\x00\x00");
        assert_eq!(&finished[2..2 + expected.len()], &expected[..]);
        assert_eq!("image/jpeg", mime::sniff(&finished).mime);
    }

    #[test]
    fn an_ordinary_jpeg_comes_back_as_upstream_strips_it() {
        for suffix in [
            ".jpg[Q=85]",
            ".jpg[Q=85,interlace=true]",
            ".jpg[Q=90,subsample_mode=off]",
        ] {
            let input = test_fixtures::synthetic_image(96, 64, suffix);
            assert_eq!(
                strip_segments(&input).expect("upstream strip"),
                strip_then_finish(&input),
                "{suffix}"
            );
        }
    }

    #[test]
    fn restart_markers_and_stuffing_are_not_taken_for_segments() {
        let input = test_fixtures::synthetic_image(256, 256, ".jpg[Q=95,restart_interval=1]");
        assert!(
            contains(&input, &[0xFF, 0xD0]),
            "fixture has restart markers"
        );
        assert_eq!(
            strip_segments(&input).expect("upstream strip"),
            strip_then_finish(&input)
        );
    }

    #[test]
    fn an_unreadable_strip_falls_back_to_a_re_encode_never_to_a_failure() {
        ensure_vips_init().expect("vips");
        let input = progressive();
        let limits = MediaLimits::default_from_config();
        let truncated = {
            let mut bytes = vec![0xFF, SOI, 0xFF, 0xE1, 0x40, 0x00];
            bytes.extend_from_slice(b"short");
            bytes
        };
        let reencoded = finish("image/jpeg", truncated.clone(), &input, &limits, None);
        assert_ne!(truncated, reencoded);
        assert_eq!("image/jpeg", mime::sniff(&reencoded).mime);
        let kept = finish(
            "image/jpeg",
            truncated.clone(),
            b"not an image",
            &limits,
            None,
        );
        assert_eq!(
            truncated, kept,
            "with nothing to re-encode, upstream's output stays"
        );
    }

    #[test]
    fn other_formats_are_left_alone() {
        let png = test_fixtures::synthetic_png(8, 8);
        let limits = MediaLimits::default_from_config();
        assert_eq!(png.clone(), finish("image/png", png, b"", &limits, None));
    }
}
