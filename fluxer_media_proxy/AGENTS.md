# The media proxy

`fluxer_media_proxy` is the Rust service (Axum, with native code on libvips and FFmpeg) that serves
stored and signed external media under `/media/*`, transforms images, and answers the API's internal
requests. It is upstream's. The fork adds two things: a size cap an internal caller can ask for on
external fetches (persona avatar imports), and a repair of MP3 uploads that Chromium cannot decode
(tyne-chat/tyne#245).

## Where things are

| Concern | File |
|---|---|
| Routes, public and internal | `src/server/runtime.rs` (internal ones start with `/_`: `/_metadata`, `/_sniff`, `/_thumbnail`, `/_frames`, `/_strip`, `/_audio_duration`) |
| Internal handlers | `src/server/routes/internal.rs`; the fork's tests of them in `fork_internal_tests.rs` |
| Loading an input (stored object, external URL, request body) | `src/server/media_operations/input.rs` (the fork's `external_input_limit`) |
| Stripping metadata from uploads | `src/server/media_operations/strip.rs` → `src/media_process/strip/` |
| Audio and video remux (strip), audio duration | `src/media_process/strip/av.rs` → `src/native_shim/av_strip.c` |
| MP3 repair (fork) | `src/media_process/fork_mp3_repair.rs`; backfill tool `examples/fork_mp3_repair.rs` |
| Native C code and what it links | `src/native_shim/`, listed in `build.rs`; FFmpeg and the libraries built from source by `tools/install-native-deps.sh` |
| The API's side | `fluxer_api/src/api/infrastructure/MediaService.ts` (`stripObjectMetadata`), `fluxer_api/src/api/channel/services/message/AttachmentProcessingService.ts` |

## Uploads go through `/_strip`

When a message names an upload, the API asks `/_strip` for a copy without metadata, stores that copy
in the `cdn` bucket, and records its SHA-256 (`content_hash`) and size on the attachment. Images go
through a format-specific stripper in `src/media_process/strip/` (other formats are re-encoded).
Audio and video are remuxed by
FFmpeg (`av_strip.c`): packets are copied, never re-encoded, into the muxer that `av_container`
picks from the content type. For MP3 that muxer drops every tag, writes a small ID3v2 tag and an
Info frame, and copies the frames byte for byte.

## The MP3 repair

Some encoders write Layer III granules that declare no data (`part2_3_length` 0) but a
`scalefac_compress` that calls for scale factors. FFmpeg decodes those frames fine. Chromium decodes
MP3 with Symphonia, which rejects such a frame (`mpa: part2_3_length is not valid` in
`chrome://media-internals`) and drops 26 ms of audio; by Chromium's source, two failures in a row
stop playback. After
the remux, `fork_repair_stripped_mp3` sets `scalefac_compress` to 0 in those granules and updates the
Info frame's music and tag CRCs, so the file is what FFmpeg's muxer would have written from a
repaired upload, and FFmpeg decodes it unchanged.

- What it leaves alone, because a change there could reach the output: the second channel of an
  intensity-stereo frame (its scale factors carry the stereo positions), a first granule whose
  scale factors the second reuses (`scfsi`), frames with a CRC, MPEG-2 and 2.5 (sample rates of
  24 kHz and below), and anything after the first byte that does not start a frame.
- It never fails an upload: an error is logged and the stripped file is kept as it is.
- A file repaired after it was stored keeps its size but not its SHA-256, so its attachment's
  `content_hash` changes with it.
- To check a file by hand, the backfill tool reports without writing:
  `cargo run -p fluxer-media-proxy --example fork_mp3_repair -- FILE...`; `--write` repairs in place.

## Keeping fork code out of upstream's way

The general rules are in the root `AGENTS.md`. Here:

- Put fork code in a fork-owned Rust file and hand over to it with one statement; declare the module
  in a `// Fork:` block at the end of the parent `mod.rs`.
- Do not append to an upstream file that ends with its `#[cfg(test)] mod tests`: Clippy's
  `items_after_test_module` fails the check. Use what the type already offers instead (`AvContainer`
  keeps its fields private but derives `Eq`, so compare against `av_container("audio/mpeg")`), or a
  fork file.
- A new C file means editing upstream's fixed-size `NATIVE_SHIM_SOURCES` list in `build.rs`; prefer
  Rust where the work allows it.
- Tests of upstream modules go in fork-owned files (`fork_internal_tests.rs`, included with
  `#[path]` from a `// Fork:` block); a fork-owned module keeps its tests inside it.

## Testing

`cargo test -p fluxer-media-proxy` in the dev container: the tests link the same native libraries as
the service. The Docker build does not run them. `fork_mp3_repair.rs`'s tests build MP3 frames bit by
bit and run them through the real strip, checking that the strip of a defective upload equals the
strip of the same upload repaired by hand, byte for byte. A change to the service needs `cargo build`
and a restart of the dev orchestrator.
