// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the placeholder accounts' flag (tyne-chat/tyne#682) is public, like TypeScript's
// PUBLIC_USER_FLAGS, so the users and messages services send it to the apps.

use fluxer_common::user_flags::{USER_FLAG_IMPORTED, visible_user_flags};

#[test]
fn the_imported_flag_is_sent_to_others() {
    assert_eq!(visible_user_flags(USER_FLAG_IMPORTED, &[]), 1 << 30);
}

#[test]
fn it_fits_the_public_i32() {
    assert!(USER_FLAG_IMPORTED <= i64::from(i32::MAX));
}
