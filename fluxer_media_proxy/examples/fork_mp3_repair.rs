// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the backfill tool for the media proxy's MP3 repair (tyne-chat/tyne#245). Prints one JSON
//! line per file saying what the repair finds; with `--write`, also repairs each file in place.
//!
//! `cargo run -p fluxer-media-proxy --example fork_mp3_repair -- [--write] FILE...`

use fluxer_media_proxy::media_process::{repair_mp3, repair_mp3_file};
use std::path::Path;

fn main() -> anyhow::Result<()> {
    let mut write = false;
    let mut files = Vec::new();
    for argument in std::env::args().skip(1) {
        if argument == "--write" {
            write = true;
        } else {
            files.push(argument);
        }
    }
    if files.is_empty() {
        anyhow::bail!("usage: fork_mp3_repair [--write] FILE...");
    }
    for file in files {
        let report = if write {
            repair_mp3_file(Path::new(&file))?
        } else {
            repair_mp3(&mut std::fs::read(&file)?)
        };
        println!(
            "{}",
            serde_json::json!({
                "file": file,
                "audio_frames": report.audio_frames,
                "repaired_granules": report.repaired_granules,
                "tag_crcs_updated": report.tag_crcs_updated,
                "written": write && report.repaired_granules > 0,
            })
        );
    }
    Ok(())
}
