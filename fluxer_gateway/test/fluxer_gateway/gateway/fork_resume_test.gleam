// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: a session whose socket dropped can be resumed for 300 s, not
// upstream's 60 s (config/settings.gleam). The web app tries to resume for
// 180 s and the mobile app for 55 s, so a hold shorter than the web's makes
// it identify again after a longer drop. Upstream's tests of the expiry
// itself (session/scenario_resume_test.gleam, scenario_timeouts_test.gleam)
// cover what happens when the hold ends; the E2E spec
// e2e/web/gateway/fork-gateway-resume.spec.ts resumes after 75 s.

import fluxer_gateway/config/settings
import fluxer_gateway/gateway/limits

const web_resume_window_ms = 180_000

const mobile_resume_window_ms = 55_000

pub fn a_dropped_session_is_held_for_300_seconds_test() {
  assert settings.default_durations().gateway.limits_resume_timeout_ms
    == 300_000
  assert settings.defaults().durations.gateway.limits_resume_timeout_ms
    == 300_000
  assert limits.resume_timeout_ms() == 300_000
}

pub fn the_hold_outlasts_what_the_apps_try_test() {
  let hold = settings.default_durations().gateway.limits_resume_timeout_ms
  assert hold > web_resume_window_ms
  assert hold > mobile_resume_window_ms
}

// Fork: draining nodes hand off presences before stopping, so presence routes must rebuild every 1 s
// instead of upstream's 10 s (fluxer_gateway/AGENTS.md, tyne-chat/tyne#905).
pub fn presence_route_rebuilds_every_second_for_drain_test() {
  assert settings.default_durations().presence.route_rebuild_interval_ms == 1000
  assert settings.defaults().durations.presence.route_rebuild_interval_ms
    == 1000
}
