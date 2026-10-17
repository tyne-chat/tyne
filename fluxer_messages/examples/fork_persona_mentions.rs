// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fork: the persona mentions in stored messages, read by the messages service's own parser, for
//! a one-time backfill (tyne-tools scripts/backfill_message_persona_mentions.py).
//!
//! Reads one JSON object per line, `{"id": "...", "texts": ["...", ...]}`, and writes one per
//! line, `{"id": "...", "personas": [[{"user_id": "...", "persona_id": "..."}, ...], ...]}`, the
//! mentions of each text in the order given. It reads nothing else and writes nothing else.
//!
//!     cargo run -q -p fluxer-messages --example fork_persona_mentions < in.jsonl > out.jsonl

use fluxer_messages::mention_extractor::extract_mentions_from_markdown;
use fluxer_messages::types::{ApiPersonaMention, sorted_persona_mentions};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufWriter, Write};

#[derive(Deserialize)]
struct Input {
    id: String,
    texts: Vec<Option<String>>,
}

#[derive(Serialize)]
struct Output {
    id: String,
    personas: Vec<Vec<ApiPersonaMention>>,
}

fn main() -> anyhow::Result<()> {
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    for line in std::io::stdin().lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let input: Input = serde_json::from_str(&line)?;
        let personas = input
            .texts
            .iter()
            .map(|text| {
                sorted_persona_mentions(extract_mentions_from_markdown(text.as_deref()).personas)
            })
            .collect();
        serde_json::to_writer(
            &mut out,
            &Output {
                id: input.id,
                personas,
            },
        )?;
        out.write_all(b"\n")?;
    }
    out.flush()?;
    Ok(())
}
