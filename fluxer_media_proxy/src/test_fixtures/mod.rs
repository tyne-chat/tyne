// SPDX-License-Identifier: AGPL-3.0-or-later

mod adversarial;
mod ffmpeg_cli;
mod images;
mod media;

pub use adversarial::{
    ADVERSARIAL_RANGE_HEADERS, ADVERSARIAL_TEXT_INPUTS, adversarial_media_bytes,
};
pub use ffmpeg_cli::{ffmpeg_gen_media, ffmpeg_gen_mp4, ffmpeg_gen_rotated_mp4, ffmpeg_mirror_mp4};
pub use images::{
    ANIMATED_WEBP_1024_17_FRAMES, JPEG_ROTATED_MISMATCHED_SCAN, JXL_64_LOSSY_ALPHA,
    JXL_4100_LOSSLESS_RGB16, JXL_4100_LOSSY_ALPHA, JXL_4100_LOSSY_RGB_DEPTH,
    JXL_7000X4000_LOSSY_RGB, animated_gif_fixture, animated_gif_frames, apng_header,
    first_webp_anim_frame_size, gif_frame_delays_cs, gif_loop_count, minimal_gif, png_dimensions,
    synthetic_bmp, synthetic_png, webp_animation_loop_count, webp_canvas_size, webp_chunk_payloads,
    webp_with_metadata_chunk,
};
pub use media::{
    fixture_audio_mp3_with_png_cover_art, fixture_audio_mp4_with_attached_picture,
    fixture_audio_only_mp4, fixture_h264_mp4, fixture_jpeg, fixture_mkv_with_png_video_stream,
    fixture_mp4_with_undecodable_video, synthetic_wav,
};

static TRACING_TEST_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));
static INIT_TEST_TRACING: std::sync::Once = std::sync::Once::new();

pub fn init_test_tracing() {
    INIT_TEST_TRACING.call_once(|| {
        let subscriber = tracing_subscriber::fmt()
            .with_writer(std::io::sink)
            .with_max_level(tracing::Level::TRACE)
            .finish();
        let _ = tracing::subscriber::set_global_default(subscriber);
    });
}

/// For `#[test]` functions; async tests use [`lock_test_tracing_async`].
pub fn lock_test_tracing() -> tokio::sync::MutexGuard<'static, ()> {
    init_test_tracing();
    TRACING_TEST_LOCK.blocking_lock()
}

/// For `#[tokio::test]` functions, which hold the lock across awaits.
pub async fn lock_test_tracing_async() -> tokio::sync::MutexGuard<'static, ()> {
    init_test_tracing();
    TRACING_TEST_LOCK.lock().await
}


mod captured_log;
pub(crate) use captured_log::CapturedLog;
