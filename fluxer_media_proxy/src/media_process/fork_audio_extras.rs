// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork (tyne-chat/tyne#873): what the audio player shows besides the sound, and a strip of audio
//! that does not fail on an embedded cover.
//!
//! - [`audio_extras`] reads an audio upload's embedded cover, cleaned like an image upload, and its
//!   waveform, computed as the web app computes a voice message's (`native_shim/fork_audio_extras.c`).
//! - [`fork_strip_av_metadata`] is upstream's [`strip_av_metadata`] for a file whose cover its container
//!   cannot hold. Upstream keeps the cleaned cover as a video stream in the output; WAV, ADTS AAC and
//!   Ogg cannot hold one, so FFmpeg refuses to write the file ("wav muxer does not support any stream
//!   of type video") and the strip fails. When it fails and the file has a cover, this strips it
//!   again without the cover, which the API keeps on its own instead.

use super::native_runtime::ensure_vips_init;
use super::{
    AvContainer, MediaError, MediaLimits, StrippedImage, native_optional_deadline,
    native_status_error, strip_av_metadata, strip_image_metadata,
};
use crate::native::{self, NativeStatus};
use libc::{c_double, c_int, c_longlong, c_void, size_t};
use std::{ffi::CString, os::unix::ffi::OsStrExt, path::Path, slice};

/// The voice message waveform's length (`WAVEFORM_MAX_POINTS` in the web app).
const MAX_WAVEFORM_POINTS: usize = 256;
/// Longest declared length a waveform is drawn for; longer files get the player's plain bar. Memory
/// does not limit it (the waveform is computed in constant memory, from a file mapped from disk);
/// time does, since a message waits for its attachments: an hour of Opus, the slowest codec measured,
/// decodes in about 3 s on one core (2026-11-22), so six hours stays well inside the route's 30 s.
pub const MAX_WAVEFORM_SECONDS: f64 = 6.0 * 60.0 * 60.0;
/// Largest embedded cover kept; a larger one is left out.
const MAX_COVER_BYTES: usize = 8 * 1024 * 1024;

type CoverCallback = unsafe extern "C" fn(*mut c_void, *const c_void, size_t) -> c_int;

unsafe extern "C" {
    fn fluxer_fork_audio_extras(
        media_data: *const c_void,
        media_len: size_t,
        deadline_monotonic_ms: c_longlong,
        max_waveform_seconds: c_double,
        cover_cb: Option<CoverCallback>,
        cover_user_data: *mut c_void,
        out_points: *mut u8,
        out_count: *mut c_int,
        out_waveform_status: *mut c_int,
    ) -> c_int;
}

/// An audio upload's cover, cleaned of its metadata, and its waveform: bytes 0-255, up to 256,
/// as a voice message's.
pub struct AudioExtras {
    pub cover: Option<StrippedImage>,
    pub waveform: Option<Vec<u8>>,
}

unsafe extern "C" fn copy_cover(user_data: *mut c_void, data: *const c_void, len: size_t) -> c_int {
    if user_data.is_null() || data.is_null() || len == 0 || len > MAX_COVER_BYTES {
        return -1;
    }
    let cover = unsafe { &mut *user_data.cast::<Option<Vec<u8>>>() };
    *cover = Some(unsafe { slice::from_raw_parts(data.cast::<u8>(), len) }.to_vec());
    0
}

/// The cover and waveform of `input`. A cover that cannot be cleaned as an image, or a waveform
/// that cannot be computed (a codec outside the allowlist, longer than `max_waveform_seconds`), is
/// left out; only an input FFmpeg cannot open at all is an error.
pub fn audio_extras(
    input: &[u8],
    media_limits: &MediaLimits,
    deadline_ms: Option<i64>,
    max_waveform_seconds: f64,
) -> Result<AudioExtras, MediaError> {
    ensure_vips_init()?;
    if input.is_empty() {
        return Err(MediaError::MediaDecodeFailed);
    }
    let mut raw_cover: Option<Vec<u8>> = None;
    let mut points = [0u8; MAX_WAVEFORM_POINTS];
    let mut count: c_int = 0;
    let mut waveform_status: c_int = NativeStatus::Unsupported as c_int;
    let rc = unsafe {
        fluxer_fork_audio_extras(
            input.as_ptr().cast(),
            input.len(),
            native_optional_deadline(deadline_ms),
            max_waveform_seconds,
            Some(copy_cover),
            (&raw mut raw_cover).cast(),
            points.as_mut_ptr(),
            &mut count,
            &mut waveform_status,
        )
    };
    if let Some(error) =
        native_status_error(NativeStatus::from_code(rc), MediaError::MediaDecodeFailed)
    {
        return Err(error);
    }
    let count = usize::try_from(count).unwrap_or(0).min(MAX_WAVEFORM_POINTS);
    let waveform = (NativeStatus::from_code(waveform_status) == NativeStatus::Ok && count > 0)
        .then(|| points[..count].to_vec());
    let cover =
        raw_cover.and_then(|raw| strip_image_metadata(&raw, media_limits, deadline_ms).ok());
    Ok(AudioExtras { cover, waveform })
}

unsafe extern "C" fn decline_cover(
    user_data: *mut c_void,
    _data: *const c_void,
    _len: size_t,
    _out_data: *mut *const c_void,
    _out_len: *mut size_t,
    _out_width: *mut c_int,
    _out_height: *mut c_int,
) -> c_int {
    if !user_data.is_null() {
        unsafe { *user_data.cast::<bool>() = true };
    }
    -1
}

/// Upstream's [`strip_av_metadata`]; when it fails to decode or write the file and the file has an
/// embedded cover, a second pass without the cover (see the module's comment). Other failures,
/// and files without a cover, keep upstream's result.
pub fn fork_strip_av_metadata(
    input: &[u8],
    container: AvContainer,
    output: &Path,
    media_limits: &MediaLimits,
    deadline_ms: Option<i64>,
) -> Result<(), MediaError> {
    let first = strip_av_metadata(input, container, output, media_limits, deadline_ms);
    if first != Err(MediaError::MediaDecodeFailed) {
        return first;
    }
    let (demuxer, muxer, faststart) = container.fork_parts();
    let output =
        CString::new(output.as_os_str().as_bytes()).map_err(|_| MediaError::MediaEncodeFailed)?;
    let mut saw_cover = false;
    let rc = unsafe {
        native::fluxer_av_strip_metadata(
            input.as_ptr().cast(),
            input.len(),
            demuxer.as_ptr(),
            muxer.as_ptr(),
            i32::from(faststart),
            output.as_ptr(),
            native_optional_deadline(deadline_ms),
            decline_cover,
            (&raw mut saw_cover).cast(),
        )
    };
    if !saw_cover {
        return first;
    }
    match native_status_error(NativeStatus::from_code(rc), MediaError::MediaDecodeFailed) {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{media_process::av_container, test_fixtures::synthetic_image};

    fn limits() -> MediaLimits {
        MediaLimits::default_from_config()
    }

    fn chunk(id: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut out = id.to_vec();
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(data);
        if data.len() % 2 == 1 {
            out.push(0);
        }
        out
    }

    /// Mono 16-bit PCM at 44.1 kHz.
    fn pcm16(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    fn syncsafe(n: usize) -> [u8; 4] {
        [
            (n >> 21) as u8 & 0x7f,
            (n >> 14) as u8 & 0x7f,
            (n >> 7) as u8 & 0x7f,
            n as u8 & 0x7f,
        ]
    }

    /// An ID3v2.3 tag holding one front-cover APIC frame, as the sound packs that hit this carry.
    fn id3_with_cover(jpeg: &[u8]) -> Vec<u8> {
        let mut apic = vec![0u8];
        apic.extend_from_slice(b"image/jpeg\0");
        apic.push(3);
        apic.push(0);
        apic.extend_from_slice(jpeg);
        let mut frame = b"APIC".to_vec();
        frame.extend_from_slice(&(apic.len() as u32).to_be_bytes());
        frame.extend_from_slice(&[0, 0]);
        frame.extend_from_slice(&apic);
        let mut tag = b"ID3\x03\x00\x00".to_vec();
        tag.extend_from_slice(&syncsafe(frame.len()));
        tag.extend_from_slice(&frame);
        tag
    }

    fn wav(samples: &[i16], extra_chunks: &[Vec<u8>]) -> Vec<u8> {
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&1u16.to_le_bytes());
        fmt.extend_from_slice(&1u16.to_le_bytes());
        fmt.extend_from_slice(&44_100u32.to_le_bytes());
        fmt.extend_from_slice(&88_200u32.to_le_bytes());
        fmt.extend_from_slice(&2u16.to_le_bytes());
        fmt.extend_from_slice(&16u16.to_le_bytes());
        let mut body = b"WAVE".to_vec();
        body.extend(chunk(b"fmt ", &fmt));
        body.extend(chunk(b"data", &pcm16(samples)));
        for extra in extra_chunks {
            body.extend_from_slice(extra);
        }
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend(body);
        out
    }

    /// The web app's buildWaveformBytes (VoiceMessageRecordingUtils.ts), over float samples.
    fn web_waveform(samples: &[f64], seconds: f64) -> Vec<u8> {
        let count = ((seconds / 0.1).ceil() as usize).clamp(1, 256);
        let per_point = (samples.len() / count).max(1);
        let magnitudes: Vec<f64> = (0..count)
            .map(|i| {
                let start = i * per_point;
                let end = samples.len().min(start + per_point);
                let slice = &samples[start.min(end)..end];
                if slice.is_empty() {
                    0.0
                } else {
                    (slice.iter().map(|s| s * s).sum::<f64>() / slice.len() as f64).sqrt()
                }
            })
            .collect();
        let loudest = magnitudes.iter().cloned().fold(0.0, f64::max);
        magnitudes
            .iter()
            .map(|m| {
                if loudest > 0.0 {
                    ((m / loudest).sqrt() * 255.0).round() as u8
                } else {
                    0
                }
            })
            .collect()
    }

    /// One second of a 440 Hz tone that grows louder, then a second of quieter tone.
    fn tone() -> Vec<i16> {
        (0..88_200)
            .map(|i| {
                let t = i as f64 / 44_100.0;
                let loudness = if t < 1.0 { t } else { 0.25 };
                (loudness * 20_000.0 * (2.0 * std::f64::consts::PI * 440.0 * t).sin()) as i16
            })
            .collect()
    }

    #[test]
    fn the_waveform_matches_the_web_apps_voice_message_waveform() {
        let samples = tone();
        let extras = audio_extras(&wav(&samples, &[]), &limits(), None, MAX_WAVEFORM_SECONDS)
            .expect("a plain WAV opens");
        let floats: Vec<f64> = samples.iter().map(|s| f64::from(*s) / 32768.0).collect();
        let expected = web_waveform(&floats, 2.0);
        let waveform = extras.waveform.expect("a PCM WAV has a waveform");
        assert_eq!(waveform.len(), 20);
        assert_eq!(waveform, expected);
        assert!(extras.cover.is_none());
    }

    #[test]
    fn an_id3_cover_in_a_wav_is_read_and_cleaned() {
        let jpeg = synthetic_image(48, 32, ".jpg");
        let input = wav(&tone(), &[chunk(b"ID3 ", &id3_with_cover(&jpeg))]);
        let extras = audio_extras(&input, &limits(), None, MAX_WAVEFORM_SECONDS).expect("opens");
        let cover = extras.cover.expect("the ID3 chunk's picture is the cover");
        assert_eq!(cover.content_type, "image/jpeg");
        assert_eq!((cover.width, cover.height), (48, 32));
        assert!(extras.waveform.is_some());
    }

    #[test]
    fn a_limit_of_zero_draws_any_length() {
        let extras = audio_extras(&wav(&tone(), &[]), &limits(), None, 0.0).expect("opens");
        assert_eq!(extras.waveform.map(|points| points.len()), Some(20));
    }

    /// Mono 16-bit PCM at 8 kHz, `seconds` long, loudness rising and falling twice.
    fn long_tone(seconds: usize) -> Vec<i16> {
        (0..seconds * 8_000)
            .map(|i| {
                let t = i as f64 / 8_000.0;
                let loudness =
                    0.5 + 0.5 * (2.0 * std::f64::consts::PI * t / (seconds as f64 / 2.0)).sin();
                (loudness * 20_000.0 * (2.0 * std::f64::consts::PI * 440.0 * t).sin()) as i16
            })
            .collect()
    }

    fn wav_8k(samples: &[i16], declared_data_len: Option<u32>) -> Vec<u8> {
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&1u16.to_le_bytes());
        fmt.extend_from_slice(&1u16.to_le_bytes());
        fmt.extend_from_slice(&8_000u32.to_le_bytes());
        fmt.extend_from_slice(&16_000u32.to_le_bytes());
        fmt.extend_from_slice(&2u16.to_le_bytes());
        fmt.extend_from_slice(&16u16.to_le_bytes());
        let data = pcm16(samples);
        let mut body = b"WAVE".to_vec();
        body.extend(chunk(b"fmt ", &fmt));
        body.extend_from_slice(b"data");
        body.extend_from_slice(&declared_data_len.unwrap_or(data.len() as u32).to_le_bytes());
        body.extend_from_slice(&data);
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend(body);
        out
    }

    fn assert_close_to_the_web_app(waveform: &[u8], samples: &[i16], seconds: f64) {
        let floats: Vec<f64> = samples.iter().map(|s| f64::from(*s) / 32768.0).collect();
        let expected = web_waveform(&floats, seconds);
        assert_eq!(waveform.len(), expected.len());
        for (got, want) in waveform.iter().zip(&expected) {
            assert!(
                got.abs_diff(*want) <= 3,
                "point {got} against the web app's {want}"
            );
        }
    }

    #[test]
    fn a_minute_long_file_is_drawn_in_bigger_buckets_as_the_web_app_would() {
        let samples = long_tone(60);
        let extras = audio_extras(
            &wav_8k(&samples, None),
            &limits(),
            None,
            MAX_WAVEFORM_SECONDS,
        )
        .expect("opens");
        assert_close_to_the_web_app(&extras.waveform.expect("a waveform"), &samples, 60.0);
    }

    #[test]
    fn a_file_that_does_not_declare_its_length_is_drawn_too() {
        // A streamed WAV's data length is 0xFFFFFFFF: FFmpeg reads to the end of the file.
        let samples = long_tone(60);
        let extras = audio_extras(
            &wav_8k(&samples, Some(u32::MAX)),
            &limits(),
            None,
            MAX_WAVEFORM_SECONDS,
        )
        .expect("opens");
        assert_close_to_the_web_app(&extras.waveform.expect("a waveform"), &samples, 60.0);
    }

    #[test]
    fn audio_that_says_it_is_longer_than_the_limit_is_not_decoded() {
        // Two seconds of tone against a limit of half a second: past the declared length plus
        // the second of slack, so no waveform, and the cover still comes back.
        let jpeg = synthetic_image(16, 16, ".jpg");
        let input = wav(&tone(), &[chunk(b"ID3 ", &id3_with_cover(&jpeg))]);
        let extras = audio_extras(&input, &limits(), None, 0.5).expect("opens");
        assert!(extras.waveform.is_none());
        assert!(extras.cover.is_some());
    }

    #[test]
    fn what_ffmpeg_cannot_open_is_an_error() {
        assert!(audio_extras(b"not audio at all", &limits(), None, MAX_WAVEFORM_SECONDS).is_err());
    }

    fn data_chunk(wav: &[u8]) -> Option<&[u8]> {
        let mut offset = 12;
        while offset + 8 <= wav.len() {
            let id = &wav[offset..offset + 4];
            let len = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into().ok()?) as usize;
            if id == b"data" {
                return wav.get(offset + 8..offset + 8 + len);
            }
            offset += 8 + len + (len & 1);
        }
        None
    }

    #[test]
    fn a_wav_with_a_cover_strips_without_it_where_upstreams_strip_fails() {
        let samples = tone();
        let jpeg = synthetic_image(16, 16, ".jpg");
        let input = wav(&samples, &[chunk(b"ID3 ", &id3_with_cover(&jpeg))]);
        let container = av_container("audio/wav").expect("WAV is stripped");
        let dir = tempfile::tempdir().expect("temp dir");
        let upstream_output = dir.path().join("upstream.wav");
        assert_eq!(
            strip_av_metadata(&input, container, &upstream_output, &limits(), None),
            Err(MediaError::MediaDecodeFailed),
            "upstream's strip still fails on a WAV cover; if it passes, drop this fork wrapper"
        );
        let output = dir.path().join("fork.wav");
        fork_strip_av_metadata(&input, container, &output, &limits(), None)
            .expect("the second pass leaves the cover out");
        let stripped = std::fs::read(&output).expect("output written");
        assert_eq!(data_chunk(&stripped), Some(pcm16(&samples).as_slice()));
        assert!(!stripped.windows(4).any(|w| w == b"ID3 "));
    }

    #[test]
    fn a_failure_without_a_cover_keeps_upstreams_error() {
        let container = av_container("audio/wav").expect("WAV is stripped");
        let dir = tempfile::tempdir().expect("temp dir");
        let output = dir.path().join("out.wav");
        assert_eq!(
            fork_strip_av_metadata(b"RIFF\0\0\0\0WAVEjunk", container, &output, &limits(), None),
            strip_av_metadata(b"RIFF\0\0\0\0WAVEjunk", container, &output, &limits(), None),
        );
    }
}
