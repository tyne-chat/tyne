// SPDX-License-Identifier: AGPL-3.0-or-later

pub(in crate::server) mod dispatch;
pub(in crate::server) mod internal;
pub(in crate::server) mod ops;
pub(in crate::server) mod relay;

// Fork: the API's converter for animated AVIF uploads (tyne-chat/tyne#854).
pub(in crate::server) mod fork_animated_avif;
