// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: repairs an MP3 defect that Chromium cannot decode (tyne-chat/tyne#245).
//!
//! Some encoders write Layer III granules that declare no data (`part2_3_length` 0) but a
//! `scalefac_compress` that calls for scale factors. FFmpeg reads the phantom scale factors, finds
//! no spectral data and outputs silence for the granule, as intended. Chromium decodes MP3 with
//! Symphonia, which rejects the whole frame ("mpa: part2_3_length is not valid") and drops 26 ms of
//! audio. Setting `scalefac_compress` to 0 in such a granule makes the frame valid without changing
//! what FFmpeg decodes, so the repair is applied to every stripped MP3 upload.
//!
//! Only MPEG-1 Layer III frames without a CRC are repaired, and only granules whose phantom scale
//! factors cannot reach the output: not the second channel of an intensity-stereo frame (its scale
//! factors carry the stereo positions), and not a first granule whose scale factors the second
//! granule reuses (`scfsi`). The input is the strip's output, laid out by FFmpeg's muxer: an ID3v2
//! tag, usually an Info frame, then the audio frames. The walk stops at the first byte that does not
//! start a frame, so anything it does not recognise is left alone.

use super::strip::{AvContainer, av_container};
use std::path::Path;

const BITRATES_KBPS: [usize; 15] = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const SAMPLE_RATES: [usize; 3] = [44_100, 48_000, 32_000];
/// `(slen1, slen2)` for each MPEG-1 `scalefac_compress` value.
const SCALE_FACTOR_LENGTHS: [(u32, u32); 16] = [
    (0, 0),
    (0, 1),
    (0, 2),
    (0, 3),
    (3, 0),
    (1, 1),
    (1, 2),
    (1, 3),
    (2, 1),
    (2, 2),
    (2, 3),
    (3, 1),
    (3, 2),
    (3, 3),
    (4, 2),
    (4, 3),
];
/// Bits of one granule channel in MPEG-1 side information.
const GRANULE_CHANNEL_BITS: usize = 59;
/// Offset of `scalefac_compress` within a granule channel's side information.
const SCALEFAC_COMPRESS_OFFSET: usize = 29;
/// The Info frame's LAME tag holds its own CRC here; it covers the bytes before it.
const LAME_TAG_CRC_FRAME_OFFSET: usize = 190;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Mp3RepairReport {
    pub audio_frames: usize,
    pub repaired_granules: usize,
    pub tag_crcs_updated: bool,
}

#[derive(Clone, Copy)]
struct FrameHeader {
    len: usize,
    has_crc: bool,
    channels: usize,
    intensity_stereo: bool,
}

fn parse_header(bytes: &[u8]) -> Option<FrameHeader> {
    let header = u32::from_be_bytes(bytes.get(..4)?.try_into().ok()?);
    let is_mpeg1 = (header >> 19) & 0b11 == 0b11;
    let is_layer3 = (header >> 17) & 0b11 == 0b01;
    if header >> 21 != 0x7ff || !is_mpeg1 || !is_layer3 {
        return None;
    }
    let bitrate_kbps = *BITRATES_KBPS.get(((header >> 12) & 0xf) as usize)?;
    let sample_rate = *SAMPLE_RATES.get(((header >> 10) & 0b11) as usize)?;
    if bitrate_kbps == 0 {
        return None;
    }
    let padding = ((header >> 9) & 1) as usize;
    let mode = (header >> 6) & 0b11;
    let mode_extension = (header >> 4) & 0b11;
    Some(FrameHeader {
        len: 144 * bitrate_kbps * 1000 / sample_rate + padding,
        has_crc: (header >> 16) & 1 == 0,
        channels: if mode == 0b11 { 1 } else { 2 },
        intensity_stereo: mode == 0b01 && mode_extension & 0b01 != 0,
    })
}

fn side_info_start(header: FrameHeader) -> usize {
    if header.has_crc { 6 } else { 4 }
}

fn side_info_len(header: FrameHeader) -> usize {
    if header.channels == 1 { 17 } else { 32 }
}

fn read_bits(bytes: &[u8], bit: usize, count: usize) -> u32 {
    (bit..bit + count).fold(0, |value, index| {
        (value << 1) | u32::from((bytes[index / 8] >> (7 - index % 8)) & 1)
    })
}

fn clear_bits(bytes: &mut [u8], bit: usize, count: usize) {
    for index in bit..bit + count {
        bytes[index / 8] &= !(1 << (7 - index % 8));
    }
}

struct GranuleChannel {
    part2_3_length: u32,
    scalefac_compress: u32,
    short_blocks: bool,
    mixed_blocks: bool,
}

fn read_granule_channel(side_info: &[u8], bit: usize) -> GranuleChannel {
    let window_switching = read_bits(side_info, bit + 33, 1) == 1;
    GranuleChannel {
        part2_3_length: read_bits(side_info, bit, 12),
        scalefac_compress: read_bits(side_info, bit + SCALEFAC_COMPRESS_OFFSET, 4),
        short_blocks: window_switching && read_bits(side_info, bit + 34, 2) == 2,
        mixed_blocks: window_switching && read_bits(side_info, bit + 36, 1) == 1,
    }
}

/// Bits of scale factors a decoder reads for this granule channel. `reused` is the channel's
/// `scfsi` in the second granule (bands taken over from the first) and 0 in the first.
fn scale_factor_bits(channel: &GranuleChannel, reused: u32) -> u32 {
    let (slen1, slen2) = SCALE_FACTOR_LENGTHS[channel.scalefac_compress as usize];
    if channel.short_blocks {
        let first_part_bands = if channel.mixed_blocks { 17 } else { 18 };
        return first_part_bands * slen1 + 18 * slen2;
    }
    [(6, slen1), (5, slen1), (5, slen2), (5, slen2)]
        .iter()
        .enumerate()
        .filter(|(index, _)| reused & (0b1000 >> index) == 0)
        .map(|(_, (bands, slen))| bands * slen)
        .sum()
}

/// Repairs the side information of one audio frame; returns how many granules it changed.
fn repair_frame(frame: &mut [u8], header: FrameHeader) -> usize {
    if header.has_crc {
        return 0;
    }
    let side_info =
        &mut frame[side_info_start(header)..side_info_start(header) + side_info_len(header)];
    let channels = header.channels;
    let private_bits = if channels == 1 { 5 } else { 3 };
    let scfsi_start = 9 + private_bits;
    let granules_start = scfsi_start + 4 * channels;
    let mut repaired = 0;
    for ch in 0..channels {
        if header.intensity_stereo && ch == 1 {
            continue;
        }
        let scfsi = read_bits(side_info, scfsi_start + 4 * ch, 4);
        let bit_of = |gr: usize| granules_start + (gr * channels + ch) * GRANULE_CHANNEL_BITS;
        let first = read_granule_channel(side_info, bit_of(0));
        let second = read_granule_channel(side_info, bit_of(1));
        let second_reuses_first = !second.short_blocks && scfsi != 0;
        let candidates = [
            (bit_of(0), &first, 0, !second_reuses_first),
            (
                bit_of(1),
                &second,
                if second.short_blocks { 0 } else { scfsi },
                true,
            ),
        ];
        for (bit, granule, reused, repairable) in candidates {
            if repairable && granule.part2_3_length == 0 && scale_factor_bits(granule, reused) > 0 {
                clear_bits(side_info, bit + SCALEFAC_COMPRESS_OFFSET, 4);
                repaired += 1;
            }
        }
    }
    repaired
}

fn id3v2_len(bytes: &[u8]) -> usize {
    match bytes.get(..10) {
        Some(tag) if tag.starts_with(b"ID3") => {
            let size = tag[6..10]
                .iter()
                .fold(0usize, |size, byte| (size << 7) | usize::from(byte & 0x7f));
            let footer = if tag[5] & 0x10 != 0 { 10 } else { 0 };
            10 + size + footer
        }
        _ => 0,
    }
}

fn is_info_frame(frame: &[u8], header: FrameHeader) -> bool {
    let tag_at = side_info_start(header) + side_info_len(header);
    matches!(frame.get(tag_at..tag_at + 4), Some(b"Info" | b"Xing"))
        || frame.get(36..40) == Some(b"VBRI")
}

/// CRC-16/ARC, the CRC of the LAME tag's music and tag fields (FFmpeg's `AV_CRC_16_ANSI_LE`).
fn crc16(bytes: &[u8], initial: u16) -> u16 {
    bytes.iter().fold(initial, |crc, byte| {
        (0..8).fold(crc ^ u16::from(*byte), |crc, _| {
            if crc & 1 != 0 {
                (crc >> 1) ^ 0xa001
            } else {
                crc >> 1
            }
        })
    })
}

/// Where the Info frame's LAME tag keeps its music CRC, if the frame has one in the layout whose
/// tag CRC this module can maintain.
fn lame_music_crc_offset(frame: &[u8], header: FrameHeader) -> Option<usize> {
    let xing = side_info_start(header) + side_info_len(header);
    if !matches!(frame.get(xing..xing + 4), Some(b"Info" | b"Xing")) {
        return None;
    }
    let flags = u32::from_be_bytes(frame.get(xing + 4..xing + 8)?.try_into().ok()?);
    let fields = [(1, 4), (2, 4), (4, 100), (8, 4)];
    let lame = xing
        + 8
        + fields
            .iter()
            .filter(|(flag, _)| flags & flag != 0)
            .map(|(_, len)| len)
            .sum::<usize>();
    let music_crc = lame + 32;
    (music_crc + 2 == LAME_TAG_CRC_FRAME_OFFSET && frame.len() >= LAME_TAG_CRC_FRAME_OFFSET + 2)
        .then_some(music_crc)
}

fn read_u16(bytes: &[u8], at: usize) -> u16 {
    u16::from_be_bytes([bytes[at], bytes[at + 1]])
}

/// Keeps the Info frame's music and tag CRCs true after a repair, as FFmpeg's muxer would have
/// written them from repaired frames. Leaves them alone unless both were right before.
fn update_lame_crcs(
    info_frame: &mut [u8],
    header: FrameHeader,
    old_audio_crc: u16,
    new_audio_crc: u16,
) -> bool {
    let Some(music_crc) = lame_music_crc_offset(info_frame, header) else {
        return false;
    };
    let tag_crc_ok = read_u16(info_frame, LAME_TAG_CRC_FRAME_OFFSET)
        == crc16(&info_frame[..LAME_TAG_CRC_FRAME_OFFSET], 0);
    if read_u16(info_frame, music_crc) != old_audio_crc || !tag_crc_ok {
        return false;
    }
    info_frame[music_crc..music_crc + 2].copy_from_slice(&new_audio_crc.to_be_bytes());
    let tag_crc = crc16(&info_frame[..LAME_TAG_CRC_FRAME_OFFSET], 0);
    info_frame[LAME_TAG_CRC_FRAME_OFFSET..LAME_TAG_CRC_FRAME_OFFSET + 2]
        .copy_from_slice(&tag_crc.to_be_bytes());
    true
}

/// Repairs the MP3 in `bytes` in place. Bytes change only where a granule is repaired, and in the
/// Info frame's CRCs that cover it.
pub fn repair_mp3(bytes: &mut [u8]) -> Mp3RepairReport {
    let mut report = Mp3RepairReport::default();
    let mut frames = Vec::new();
    let mut at = id3v2_len(bytes);
    while let Some(header) = bytes.get(at..).and_then(parse_header) {
        if at + header.len > bytes.len() {
            break;
        }
        frames.push((at, header));
        at += header.len;
    }
    let info = frames
        .first()
        .copied()
        .filter(|&(start, header)| is_info_frame(&bytes[start..start + header.len], header));
    let audio = &frames[usize::from(info.is_some())..];
    let Some(&(audio_start, _)) = audio.first() else {
        return report;
    };
    report.audio_frames = audio.len();
    let audio_end = at;
    let old_audio_crc = crc16(&bytes[audio_start..audio_end], 0);
    for &(start, header) in audio {
        report.repaired_granules += repair_frame(&mut bytes[start..start + header.len], header);
    }
    if report.repaired_granules > 0
        && let Some((start, header)) = info
    {
        let new_audio_crc = crc16(&bytes[audio_start..audio_end], 0);
        report.tag_crcs_updated = update_lame_crcs(
            &mut bytes[start..start + header.len],
            header,
            old_audio_crc,
            new_audio_crc,
        );
    }
    report
}

/// Repairs an MP3 file in place; the file is rewritten only when something was repaired.
pub fn repair_mp3_file(path: &Path) -> std::io::Result<Mp3RepairReport> {
    let mut bytes = std::fs::read(path)?;
    let report = repair_mp3(&mut bytes);
    if report.repaired_granules > 0 {
        std::fs::write(path, &bytes)?;
    }
    Ok(report)
}

/// The hook after the media proxy strips an upload. A failure is logged and ignored: the repair must
/// never cost an upload that works without it.
pub fn fork_repair_stripped_mp3(container: AvContainer, path: &Path) {
    if av_container("audio/mpeg") != Some(container) {
        return;
    }
    match repair_mp3_file(path) {
        Ok(report) if report.repaired_granules > 0 => tracing::info!(
            repaired_granules = report.repaired_granules,
            audio_frames = report.audio_frames,
            tag_crcs_updated = report.tag_crcs_updated,
            "Fork: repaired MP3 granules Chromium cannot decode"
        ),
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(%error, "Fork: MP3 repair failed; keeping the stripped file as it is")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media_process::strip_av_metadata;

    /// One MPEG-1 Layer III granule channel's side information, as the tests set it.
    #[derive(Clone, Copy, Default)]
    struct Granule {
        part2_3_length: u32,
        big_values: u32,
        scalefac_compress: u32,
        block_type: u32,
    }

    struct BitWriter {
        bytes: Vec<u8>,
        bit: usize,
    }

    impl BitWriter {
        fn new(len: usize) -> Self {
            Self {
                bytes: vec![0; len],
                bit: 0,
            }
        }

        fn put(&mut self, value: u32, count: usize) {
            for index in (0..count).rev() {
                if (value >> index) & 1 == 1 {
                    self.bytes[self.bit / 8] |= 1 << (7 - self.bit % 8);
                }
                self.bit += 1;
            }
        }
    }

    const HEADER_STEREO: [u8; 4] = [0xff, 0xfb, 0x90, 0x64];
    const HEADER_INTENSITY_STEREO: [u8; 4] = [0xff, 0xfb, 0x90, 0x54];
    const FRAME_LEN: usize = 417;

    /// A silent 128 kbit/s, 44.1 kHz stereo frame (no main data) with the given side information,
    /// granules indexed `[granule][channel]`.
    fn frame(header: [u8; 4], scfsi: [u32; 2], granules: [[Granule; 2]; 2]) -> Vec<u8> {
        let mut side = BitWriter::new(32);
        side.put(0, 9);
        side.put(0, 3);
        side.put(scfsi[0], 4);
        side.put(scfsi[1], 4);
        for granule in granules {
            for g in granule {
                side.put(g.part2_3_length, 12);
                side.put(g.big_values, 9);
                side.put(150, 8);
                side.put(g.scalefac_compress, 4);
                if g.block_type == 0 {
                    side.put(0, 1);
                    side.put(0, 22);
                } else {
                    side.put(1, 1);
                    side.put(g.block_type, 2);
                    side.put(0, 20);
                }
                side.put(0, 3);
            }
        }
        let mut bytes = header.to_vec();
        bytes.extend_from_slice(&side.bytes);
        bytes.resize(FRAME_LEN, 0);
        bytes
    }

    fn silent() -> Vec<u8> {
        frame(HEADER_STEREO, [0, 0], [[Granule::default(); 2]; 2])
    }

    /// The reported file's defect: the second granule's side channel declares no data but 32 bits
    /// of scale factors.
    fn defective(header: [u8; 4]) -> Vec<u8> {
        let mut granules = [[Granule::default(); 2]; 2];
        granules[1][1].scalefac_compress = 8;
        frame(header, [0, 0], granules)
    }

    fn stream(frames: &[Vec<u8>]) -> Vec<u8> {
        frames.concat()
    }

    fn scalefac_compress(bytes: &[u8], frame_index: usize, gr: usize, ch: usize) -> u32 {
        read_bits(
            &bytes[frame_index * FRAME_LEN + 4..],
            20 + (gr * 2 + ch) * 59 + 29,
            4,
        )
    }

    #[test]
    fn clears_phantom_scale_factors_of_an_empty_granule() {
        let mut bytes = stream(&[silent(), defective(HEADER_STEREO), silent()]);
        let original = bytes.clone();

        let report = repair_mp3(&mut bytes);

        assert_eq!(
            report,
            Mp3RepairReport {
                audio_frames: 3,
                repaired_granules: 1,
                tag_crcs_updated: false
            }
        );
        assert_eq!(0, scalefac_compress(&bytes, 1, 1, 1));
        let changed: Vec<usize> = (0..bytes.len())
            .filter(|&i| bytes[i] != original[i])
            .collect();
        assert!(
            changed
                .iter()
                .all(|&i| (FRAME_LEN..FRAME_LEN + 36).contains(&i)),
            "{changed:?}"
        );
    }

    #[test]
    fn leaves_a_clean_stream_byte_identical() {
        let mut granules = [[Granule::default(); 2]; 2];
        granules[0][0] = Granule {
            part2_3_length: 400,
            big_values: 20,
            scalefac_compress: 8,
            block_type: 0,
        };
        let mut bytes = stream(&[silent(), frame(HEADER_STEREO, [0, 0], granules), silent()]);
        let original = bytes.clone();

        let report = repair_mp3(&mut bytes);

        assert_eq!(0, report.repaired_granules);
        assert_eq!(original, bytes);
    }

    #[test]
    fn keeps_intensity_stereo_positions_of_the_second_channel() {
        let mut bytes = stream(&[defective(HEADER_INTENSITY_STEREO)]);
        let original = bytes.clone();

        assert_eq!(0, repair_mp3(&mut bytes).repaired_granules);
        assert_eq!(original, bytes);
    }

    #[test]
    fn keeps_first_granule_scale_factors_the_second_reuses() {
        let mut granules = [[Granule::default(); 2]; 2];
        granules[0][0].scalefac_compress = 8;
        granules[1][0] = Granule {
            part2_3_length: 400,
            big_values: 20,
            ..Granule::default()
        };
        let mut reused = stream(&[frame(HEADER_STEREO, [0b1111, 0], granules)]);
        let mut fresh = stream(&[frame(HEADER_STEREO, [0, 0], granules)]);
        let original = reused.clone();

        assert_eq!(0, repair_mp3(&mut reused).repaired_granules);
        assert_eq!(original, reused);
        assert_eq!(1, repair_mp3(&mut fresh).repaired_granules);
        assert_eq!(0, scalefac_compress(&fresh, 0, 0, 0));
    }

    #[test]
    fn counts_reused_bands_and_short_blocks_like_a_decoder() {
        let mut granules = [[Granule::default(); 2]; 2];
        granules[1][0].scalefac_compress = 4;
        // scfsi 0b1100 reuses the two bands slen1 (3 here) applies to; slen2 is 0, so nothing is read.
        let mut all_reused = stream(&[frame(HEADER_STEREO, [0b1100, 0], granules)]);
        assert_eq!(0, repair_mp3(&mut all_reused).repaired_granules);

        granules[1][0].block_type = 2;
        // Short blocks read all their scale factors, whatever scfsi says.
        let mut short = stream(&[frame(HEADER_STEREO, [0b1100, 0], granules)]);
        assert_eq!(1, repair_mp3(&mut short).repaired_granules);
    }

    #[test]
    fn skips_frames_protected_by_a_crc() {
        let mut bytes = stream(&[defective([0xff, 0xfa, 0x90, 0x64])]);
        let original = bytes.clone();

        assert_eq!(0, repair_mp3(&mut bytes).repaired_granules);
        assert_eq!(original, bytes);
    }

    #[test]
    fn stops_at_the_first_byte_that_does_not_start_a_frame() {
        let mut bytes = stream(&[silent()]);
        bytes.extend_from_slice(b"junk");
        bytes.extend_from_slice(&defective(HEADER_STEREO));
        let original = bytes.clone();

        assert_eq!(
            Mp3RepairReport {
                audio_frames: 1,
                ..Mp3RepairReport::default()
            },
            repair_mp3(&mut bytes)
        );
        assert_eq!(original, bytes);
    }

    fn stripped(input: &[u8]) -> Vec<u8> {
        let container = av_container("audio/mpeg").expect("mp3 container");
        let output = tempfile::NamedTempFile::new().expect("output file");
        strip_av_metadata(input, container, output.path(), None).expect("stripped mp3");
        fork_repair_stripped_mp3(container, output.path());
        std::fs::read(output.path()).expect("read stripped mp3")
    }

    fn upload(defect_at: Option<usize>) -> Vec<u8> {
        let mut bytes = b"ID3\x04\x00\x00\x00\x00\x00\x00".to_vec();
        for index in 0..40 {
            bytes.extend(if Some(index) == defect_at {
                defective(HEADER_STEREO)
            } else {
                silent()
            });
        }
        bytes
    }

    #[test]
    fn strip_output_equals_the_strip_of_a_repaired_upload() {
        let mut repaired_upload = upload(Some(17));
        assert_eq!(1, repair_mp3(&mut repaired_upload).repaired_granules);
        let expected = stripped(&repaired_upload);
        let container = av_container("audio/mpeg").expect("mp3 container");
        let output = tempfile::NamedTempFile::new().expect("output file");
        strip_av_metadata(&upload(Some(17)), container, output.path(), None).expect("stripped");
        let mut unrepaired = std::fs::read(output.path()).expect("read stripped mp3");
        assert_ne!(expected, unrepaired);

        let report = repair_mp3(&mut unrepaired);

        assert_eq!(
            Mp3RepairReport {
                audio_frames: 40,
                repaired_granules: 1,
                tag_crcs_updated: true
            },
            report
        );
        assert_eq!(expected, unrepaired);
        assert_eq!(expected, stripped(&upload(Some(17))));
    }

    #[test]
    fn strip_leaves_clean_mp3_output_alone() {
        let container = av_container("audio/mpeg").expect("mp3 container");
        let output = tempfile::NamedTempFile::new().expect("output file");
        strip_av_metadata(&upload(None), container, output.path(), None).expect("stripped mp3");
        let before = std::fs::read(output.path()).expect("read");

        fork_repair_stripped_mp3(container, output.path());

        assert_eq!(before, std::fs::read(output.path()).expect("read"));
    }

    #[test]
    fn other_containers_are_not_touched() {
        let container = av_container("audio/wav").expect("wav container");
        let output = tempfile::NamedTempFile::new().expect("output file");
        let bytes = stream(&[defective(HEADER_STEREO)]);
        std::fs::write(output.path(), &bytes).expect("write");

        fork_repair_stripped_mp3(container, output.path());

        assert_eq!(bytes, std::fs::read(output.path()).expect("read"));
    }
}
