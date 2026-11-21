// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: an animated AVIF upload becomes an animated WebP before the API reads it
//! (tyne-chat/tyne#854).
//!
//! libvips recognises AVIF by the `avif` brand only, so nothing else in the proxy reads an
//! animated AVIF (major brand `avis`) as an image: no metadata, no stripping, no still preview.
//! Animated previews already decode the track with FFmpeg (`decode_heif_sequence`). This does the
//! same at full size with every frame and encodes the frames as an animated WebP, which the rest
//! of the pipeline handles like any other. The API stores the WebP in place of the upload.
//!
//! - The decoder's item check (`fluxer_heif_validate`) allows one `meta` box in the file. libavif
//!   writes a second one inside the track when the file carries Exif or XMP, so every `meta` box
//!   inside the movie is relabelled `free` in a copy first; the check then sees the top-level one
//!   only. A file with no top-level `meta` (only the track, as FFmpeg's MP4 muxer writes it with
//!   `-brand avis`) goes through `fluxer_fork_ffmpeg_decode_avif_track` instead, which demuxes it as
//!   an MP4 upload is, after the same sample-table check.
//! - The decode budget is the one upstream gives an animated AVIF preview
//!   (`accumulated_decode_pixels`, half of the native memory budget). A longer or larger animation
//!   is refused with `MediaError::StreamTooLong`, never cut short: the decoder runs with
//!   `require_complete`.
//! - The WebP keeps the pixels and the frame timing, nothing else: no Exif, XMP or movie tags.

use super::animated_transform::{DecodedAnimation, decode_heif_sequence};
use super::encoding::{VipsEncodeRequest, anim_limits_from_options, encode_vips_image};
use super::image_probe::animated_probe_from_image;
use super::loaded_image::{page_height, validate_dimensions};
use super::native_cost::accumulated_decode_pixels;
use super::native_runtime::{clear_vips_error, ensure_vips_init, vips_runtime};
use super::{
    MediaError, NativeCost, native_animated_frame_limit, native_optional_deadline,
    native_status_error,
};
use crate::{
    image_quality::ImageQuality,
    image_transform::{AnimationLimits, AnimationMode, ImageOptions},
    media_limits::MediaLimits,
    mime,
    native::{self, NativeStatus, VipsImage, VipsImageHandle},
    output_format::OutputFormat,
};
use libc::{c_int, c_longlong, c_void, size_t};
use std::ptr;

const RGBA_BYTES_PER_PIXEL: usize = 4;
/// Canvas buffers and encoder state per frame pixel while the WebP is written, as upstream counts
/// them for an animated transform (`image_transform_cost`).
const ENCODE_BYTES_PER_FRAME_PIXEL: usize = 8 * RGBA_BYTES_PER_PIXEL + 28;
/// Boxes the item check walks into inside the movie; a `meta` box among their children is
/// relabelled.
const MOVIE_CONTAINERS: [&[u8; 4]; 6] = [b"trak", b"mdia", b"minf", b"stbl", b"edts", b"dinf"];

unsafe extern "C" {
    fn fluxer_fork_ffmpeg_decode_avif_track(
        data: *const c_void,
        len: size_t,
        decoder_threads: c_int,
        deadline_monotonic_ms: c_longlong,
        out: *mut *mut VipsImage,
        max_frames: c_int,
        max_total_pixels: size_t,
        out_frame_count: *mut c_int,
    ) -> c_int;
}

/// The result of [`convert_animated_avif_to_webp`].
pub enum AnimatedAvifConversion {
    /// The input is not an animated AVIF; nothing to do.
    NotAnimatedAvif,
    Converted(ConvertedAnimation),
}

pub struct ConvertedAnimation {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub frames: u32,
}

/// Whether `input` is an AVIF whose brands say it is animated (`avis`), as the proxy sniffs it.
pub fn is_animated_avif(input: &[u8]) -> bool {
    let sniffed = mime::sniff(input);
    sniffed.mime == "image/avif" && sniffed.animated
}

/// The memory a conversion of `input` reserves: the decoded frames, up to the decode budget, the
/// encoder's working set for one frame, and the copy of the input.
pub fn animated_avif_conversion_cost(
    input: &[u8],
    media_limits: &MediaLimits,
) -> Result<NativeCost, MediaError> {
    let sniffed = mime::sniff(input);
    let decoded_pixels = accumulated_decode_pixels(sniffed, media_limits).unwrap_or(0);
    let frame_pixels = (sniffed.width as usize).saturating_mul(sniffed.height as usize);
    Ok(NativeCost::UpToBudget(
        input
            .len()
            .saturating_mul(2)
            .saturating_add(decoded_pixels.saturating_mul(RGBA_BYTES_PER_PIXEL))
            .saturating_add(frame_pixels.saturating_mul(ENCODE_BYTES_PER_FRAME_PIXEL)),
    ))
}

/// Decodes every frame of an animated AVIF and encodes them as an animated WebP at the same size.
///
/// `StreamTooLong` (or `InvalidImageDimensions`) means the animation is over the proxy's limits;
/// any other error means it could not be converted.
pub fn convert_animated_avif_to_webp(
    input: &[u8],
    media_limits: &MediaLimits,
    deadline_ms: Option<i64>,
) -> Result<AnimatedAvifConversion, MediaError> {
    ensure_vips_init()?;
    let sniffed = mime::sniff(input);
    if !(sniffed.mime == "image/avif" && sniffed.animated) {
        return Ok(AnimatedAvifConversion::NotAnimatedAvif);
    }
    let max_total_pixels =
        accumulated_decode_pixels(sniffed, media_limits).ok_or(MediaError::MediaDecodeFailed)?;
    let prepared = without_movie_item_metadata(input)?;
    let decoded = if prepared.has_top_level_meta {
        decode_heif_sequence(&prepared.bytes, max_total_pixels, media_limits, deadline_ms)?
    } else {
        decode_avif_track(&prepared.bytes, max_total_pixels, media_limits, deadline_ms)?
    };
    let decoded = decoded.ok_or(MediaError::MediaDecodeFailed)?;
    let frame_height = page_height(&decoded.image)?.ok_or(MediaError::MediaDecodeFailed)?;
    let width = unsafe { native::fluxer_vips_image_get_width(decoded.image.as_ptr()) };
    let height = unsafe { native::fluxer_vips_image_get_height(decoded.image.as_ptr()) };
    if width <= 0 || frame_height <= 0 || height % frame_height != 0 {
        return Err(MediaError::MediaDecodeFailed);
    }
    let frames = u32::try_from(height / frame_height).map_err(|_| MediaError::MediaDecodeFailed)?;
    let options = ImageOptions {
        format: OutputFormat::WebP,
        quality: ImageQuality::High,
        animation: AnimationMode::Animated(
            AnimationLimits::new(frames, i32::MAX as u32)
                .map_err(|_| MediaError::MediaDecodeFailed)?,
        ),
        deadline_ms,
        ..Default::default()
    };
    let bytes = encode_vips_image(
        &decoded.image,
        VipsEncodeRequest {
            format: OutputFormat::WebP,
            quality: ImageQuality::High.resolve_static(),
            page_height: Some(frame_height),
            effort_override: None,
            animation: anim_limits_from_options(&options),
            animation_loop_count: decoded.loop_count,
            media_limits,
            // Frames that store only what changed, unlike upstream's animated AVIF previews: this
            // WebP is what gets stored, so its size counts. For a 4 s 480×360 clip with a box
            // moving over still bars, every decoded frame came within 35 dB of its source frame.
            full_canvas_animation: false,
        },
    )?;
    Ok(AnimatedAvifConversion::Converted(ConvertedAnimation {
        bytes,
        width: width as u32,
        height: frame_height as u32,
        frames,
    }))
}

struct PreparedInput {
    bytes: Vec<u8>,
    has_top_level_meta: bool,
}

struct BoxHeader {
    kind: [u8; 4],
    body: usize,
    end: usize,
}

fn read_box(input: &[u8], start: usize, limit: usize) -> Result<BoxHeader, MediaError> {
    let header = input
        .get(start..start + 8)
        .ok_or(MediaError::MediaDecodeFailed)?;
    let size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
    let kind = [header[4], header[5], header[6], header[7]];
    let (body, end) = match size {
        0 => (start + 8, limit),
        1 => {
            let large = input
                .get(start + 8..start + 16)
                .ok_or(MediaError::MediaDecodeFailed)?;
            let large = u64::from_be_bytes(
                large
                    .try_into()
                    .map_err(|_| MediaError::MediaDecodeFailed)?,
            );
            let large = usize::try_from(large).map_err(|_| MediaError::MediaDecodeFailed)?;
            (
                start + 16,
                start
                    .checked_add(large)
                    .ok_or(MediaError::MediaDecodeFailed)?,
            )
        }
        size => (
            start + 8,
            start
                .checked_add(size)
                .ok_or(MediaError::MediaDecodeFailed)?,
        ),
    };
    if body > end || end > limit {
        return Err(MediaError::MediaDecodeFailed);
    }
    Ok(BoxHeader { kind, body, end })
}

/// A copy of `input` in which every `meta` box inside the movie is relabelled `free`, and
/// whether the file has a top-level `meta`. Box sizes and offsets are unchanged.
fn without_movie_item_metadata(input: &[u8]) -> Result<PreparedInput, MediaError> {
    let mut bytes = input.to_vec();
    let mut has_top_level_meta = false;
    let mut offset = 0;
    while offset < input.len() {
        let top = read_box(input, offset, input.len())?;
        match &top.kind {
            b"meta" => has_top_level_meta = true,
            b"moov" => relabel_movie_metadata(input, &mut bytes, top.body, top.end, 0)?,
            _ => {}
        }
        offset = top.end;
    }
    Ok(PreparedInput {
        bytes,
        has_top_level_meta,
    })
}

fn relabel_movie_metadata(
    input: &[u8],
    output: &mut [u8],
    start: usize,
    end: usize,
    depth: usize,
) -> Result<(), MediaError> {
    if depth > 8 {
        return Err(MediaError::MediaDecodeFailed);
    }
    let mut offset = start;
    while offset < end {
        let child = read_box(input, offset, end)?;
        if &child.kind == b"meta" {
            output[offset + 4..offset + 8].copy_from_slice(b"free");
        } else if MOVIE_CONTAINERS.contains(&&child.kind) {
            relabel_movie_metadata(input, output, child.body, child.end, depth + 1)?;
        }
        offset = child.end;
    }
    Ok(())
}

/// [`decode_heif_sequence`] for a file with no item metadata.
fn decode_avif_track(
    input: &[u8],
    max_total_pixels: usize,
    media_limits: &MediaLimits,
    deadline_ms: Option<i64>,
) -> Result<Option<DecodedAnimation>, MediaError> {
    let runtime = vips_runtime()?;
    let mut raw = ptr::null_mut();
    let mut frame_count = 0;
    let rc = unsafe {
        fluxer_fork_ffmpeg_decode_avif_track(
            input.as_ptr().cast(),
            input.len(),
            runtime.config().ffmpeg_decoder_threads(),
            native_optional_deadline(deadline_ms),
            &mut raw,
            native_animated_frame_limit(media_limits),
            max_total_pixels,
            &mut frame_count,
        )
    };
    let image = unsafe { VipsImageHandle::from_raw_owned(raw) };
    match NativeStatus::from_code(rc) {
        NativeStatus::Ok if image.is_some() => {}
        NativeStatus::Ok | NativeStatus::Unsupported | NativeStatus::CodecFailure => {
            clear_vips_error();
            return Ok(None);
        }
        status => {
            clear_vips_error();
            return Err(native_status_error(status, MediaError::MediaDecodeFailed)
                .expect("non-success native status must map to an error"));
        }
    }
    let image = image.ok_or(MediaError::MediaDecodeFailed)?;
    let frame_count = u32::try_from(frame_count).map_err(|_| MediaError::MediaDecodeFailed)?;
    if frame_count < 2 {
        return Ok(None);
    }
    let probe = animated_probe_from_image(&image)?.ok_or(MediaError::MediaDecodeFailed)?;
    if u32::try_from(probe.pages).ok() != Some(frame_count) {
        return Err(MediaError::MediaDecodeFailed);
    }
    validate_dimensions(media_limits, probe.width, probe.height)?;
    Ok(Some(DecodedAnimation {
        image,
        loop_count: None,
    }))
}

// The fixtures in `fork_animated_avif_fixtures/` are 64×48, four frames at 10 frames a second,
// made with FFmpeg 7.1 (libaom), avifenc 1.2.1 and exiftool 13.25 from `testsrc2`:
// - `ffmpeg_muxer.avif`: FFmpeg's `avif` muxer, a top-level `meta` and the track;
// - `libavif_exif_xmp.avif`: avifenc with `--exif` (GPS, make "FixturePhone", model
//   "FixtureModel9", artist "Fixture Exif Person") and `--xmp` (creator "Fixture XMP Person"),
//   which adds a `meta` inside the track;
// - `track_only_tags.avif`: `-f mp4 -brand avis -movflags use_metadata_tags` from a video tagged
//   with a location (+51.5000-000.1200/) and title "Fixture Video Title": no top-level `meta`;
// - `exiftool_udta_uuid.avif`: `ffmpeg_muxer.avif` with exiftool's `-XMP:Creator="Fixture UUID
//   Person"` (a top-level `uuid` box), `-QuickTime:GPSCoordinates` and `-UserData:Author="Fixture
//   UserData Person"` (`moov/udta`);
// - `still.avif`: one frame, `-still-picture 1`.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::media_process::{MetadataOptions, prepare_metadata, strip_image_metadata};

    const FFMPEG_MUXER: &[u8] = include_bytes!("fork_animated_avif_fixtures/ffmpeg_muxer.avif");
    const LIBAVIF_EXIF_XMP: &[u8] =
        include_bytes!("fork_animated_avif_fixtures/libavif_exif_xmp.avif");
    const TRACK_ONLY_TAGS: &[u8] =
        include_bytes!("fork_animated_avif_fixtures/track_only_tags.avif");
    const EXIFTOOL_UDTA_UUID: &[u8] =
        include_bytes!("fork_animated_avif_fixtures/exiftool_udta_uuid.avif");
    const STILL: &[u8] = include_bytes!("fork_animated_avif_fixtures/still.avif");

    const PLANTED: [&str; 8] = [
        "FixturePhone",
        "FixtureModel9",
        "Fixture Exif Person",
        "Fixture XMP Person",
        "Fixture Video Title",
        "+51.5000",
        "Fixture UUID Person",
        "Fixture UserData Person",
    ];

    fn limits() -> MediaLimits {
        MediaLimits::default_from_config().with_native_memory_budget(256 << 20)
    }

    fn convert(
        input: &[u8],
        media_limits: &MediaLimits,
    ) -> Result<AnimatedAvifConversion, MediaError> {
        convert_animated_avif_to_webp(input, media_limits, None)
    }

    fn converted(input: &[u8]) -> ConvertedAnimation {
        match convert(input, &limits()) {
            Ok(AnimatedAvifConversion::Converted(converted)) => converted,
            Ok(AnimatedAvifConversion::NotAnimatedAvif) => panic!("not taken as an animated AVIF"),
            Err(error) => panic!("conversion failed: {error:?}"),
        }
    }

    fn contains(haystack: &[u8], needle: &str) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle.as_bytes())
    }

    #[test]
    fn fixtures_carry_what_they_claim() {
        for fixture in [
            FFMPEG_MUXER,
            LIBAVIF_EXIF_XMP,
            TRACK_ONLY_TAGS,
            EXIFTOOL_UDTA_UUID,
        ] {
            assert!(is_animated_avif(fixture));
        }
        assert!(!is_animated_avif(STILL));
        for planted in ["FixturePhone", "Fixture Exif Person", "Fixture XMP Person"] {
            assert!(contains(LIBAVIF_EXIF_XMP, planted), "{planted}");
        }
        for planted in ["Fixture Video Title", "+51.5000"] {
            assert!(contains(TRACK_ONLY_TAGS, planted), "{planted}");
        }
        for planted in ["Fixture UUID Person", "Fixture UserData Person"] {
            assert!(contains(EXIFTOOL_UDTA_UUID, planted), "{planted}");
        }
        assert!(
            without_movie_item_metadata(FFMPEG_MUXER)
                .unwrap()
                .has_top_level_meta
        );
        assert!(
            !without_movie_item_metadata(TRACK_ONLY_TAGS)
                .unwrap()
                .has_top_level_meta
        );
    }

    #[test]
    fn every_layout_converts_to_an_animated_webp_with_all_frames() {
        for (name, fixture) in [
            ("ffmpeg_muxer", FFMPEG_MUXER),
            ("libavif_exif_xmp", LIBAVIF_EXIF_XMP),
            ("track_only_tags", TRACK_ONLY_TAGS),
            ("exiftool_udta_uuid", EXIFTOOL_UDTA_UUID),
        ] {
            let converted = converted(fixture);
            assert_eq!(
                (converted.width, converted.height, converted.frames),
                (64, 48, 4),
                "{name}"
            );
            let sniffed = mime::sniff(&converted.bytes);
            assert_eq!(sniffed.mime, "image/webp", "{name}");
            assert!(sniffed.animated, "{name}");
            for planted in PLANTED {
                assert!(
                    !contains(&converted.bytes, planted),
                    "{name} kept {planted}"
                );
            }
        }
    }

    #[test]
    fn the_webp_goes_through_metadata_and_stripping_like_any_animated_webp() {
        let converted = converted(LIBAVIF_EXIF_XMP);
        let sniffed = mime::sniff(&converted.bytes);
        assert_eq!((sniffed.width, sniffed.height), (64, 48));
        prepare_metadata(
            &converted.bytes,
            &MetadataOptions::default(),
            &limits(),
            &crate::metrics::transform::TransformMetrics::default(),
        )
        .expect("metadata of the converted WebP");
        let stripped = strip_image_metadata(&converted.bytes, &limits(), None)
            .expect("stripping the converted WebP");
        assert_eq!(stripped.content_type, "image/webp");
    }

    #[test]
    fn frame_timing_is_kept() {
        let converted = converted(FFMPEG_MUXER);
        let delays = webp_frame_delays_ms(&converted.bytes);
        assert_eq!(delays, vec![100, 100, 100, 100]);
    }

    #[test]
    fn a_still_avif_is_left_alone() {
        assert!(matches!(
            convert(STILL, &limits()),
            Ok(AnimatedAvifConversion::NotAnimatedAvif)
        ));
    }

    #[test]
    fn an_animation_over_the_decode_budget_is_refused_not_cut_short() {
        // 64×48×4 frames is 12,288 pixels; a budget of three frames' worth refuses it.
        let budget = 3 * 64 * 48 * RGBA_BYTES_PER_PIXEL * 2;
        let media_limits = MediaLimits::default_from_config().with_native_memory_budget(budget);
        for fixture in [FFMPEG_MUXER, TRACK_ONLY_TAGS] {
            assert!(matches!(
                convert(fixture, &media_limits),
                Err(MediaError::StreamTooLong)
            ));
        }
    }

    #[test]
    fn movie_metadata_is_relabelled_in_place() {
        let prepared = without_movie_item_metadata(LIBAVIF_EXIF_XMP).unwrap();
        assert!(prepared.has_top_level_meta);
        assert_eq!(prepared.bytes.len(), LIBAVIF_EXIF_XMP.len());
        let changed: Vec<usize> = (0..prepared.bytes.len())
            .filter(|&index| prepared.bytes[index] != LIBAVIF_EXIF_XMP[index])
            .collect();
        assert_eq!(changed.len(), 4, "only one box type relabelled");
        assert_eq!(&prepared.bytes[changed[0]..changed[0] + 4], b"free");
        assert_eq!(&LIBAVIF_EXIF_XMP[changed[0]..changed[0] + 4], b"meta");
    }

    #[test]
    fn a_truncated_box_is_refused() {
        let truncated = &FFMPEG_MUXER[..FFMPEG_MUXER.len() / 2];
        assert!(convert(truncated, &limits()).is_err());
    }

    /// The `ANMF` frame durations of an animated WebP.
    fn webp_frame_delays_ms(webp: &[u8]) -> Vec<u32> {
        let mut delays = Vec::new();
        let mut offset = 12;
        while offset + 8 <= webp.len() {
            let kind = &webp[offset..offset + 4];
            let size =
                u32::from_le_bytes(webp[offset + 4..offset + 8].try_into().unwrap()) as usize;
            if kind == b"ANMF" {
                let body = &webp[offset + 8..];
                delays.push(u32::from_le_bytes([body[12], body[13], body[14], 0]));
            }
            offset += 8 + size + (size & 1);
        }
        delays
    }
}
