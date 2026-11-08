// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: fixed download links for Tyne's apps (tyne-chat/tyne#242). `/download/<target>` redirects to
// the matching file of the newest release on GitHub: the desktop apps from tyne-chat/tyne, the
// Android app from tyne-chat/tyne-mobile. The file names carry the version, so a link that never
// changes needs someone to look the newest one up; the web app's /download page, the login and
// invite panels and the sidebar's dialog link here. `/download` itself is the web app's page and
// is left to the SPA fallback.
//
// Requests to GitHub: at most one per repository every FRESH_FOR, shared by every visitor; after a
// failure none for RETRY_AFTER_FAILURE, keeping the last good answer meanwhile. GitHub's API allows
// 60 unauthenticated requests an hour per IP address, so this stays far below it. When no file is
// known, the link goes to the repository's latest release page instead, where people can pick.

use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const DESKTOP_REPOSITORY: &str = "tyne-chat/tyne";
const MOBILE_REPOSITORY: &str = "tyne-chat/tyne-mobile";
const FRESH_FOR: Duration = Duration::from_secs(10 * 60);
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(5 * 60);
const MAX_RELEASE_BYTES: usize = 2 * 1024 * 1024;
const USER_AGENT: &str = "tyne-app-proxy (https://github.com/tyne-chat/tyne)";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum DownloadTarget {
    Windows,
    Mac,
    LinuxDeb,
    LinuxRpm,
    LinuxAppImage,
    Android,
}

impl DownloadTarget {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "windows" => Some(Self::Windows),
            "mac" => Some(Self::Mac),
            "linux-deb" => Some(Self::LinuxDeb),
            "linux-rpm" => Some(Self::LinuxRpm),
            "linux-appimage" => Some(Self::LinuxAppImage),
            "android" => Some(Self::Android),
            _ => None,
        }
    }

    fn repository(self) -> &'static str {
        match self {
            Self::Android => MOBILE_REPOSITORY,
            _ => DESKTOP_REPOSITORY,
        }
    }

    // The names the release workflows give the files, e.g. `Tyne-Setup-2.1.22-win-x64.exe` and
    // `tyne-v1.2.16.apk`.
    fn matches(self, name: &str) -> bool {
        match self {
            Self::Windows => name.starts_with("Tyne-Setup-") && name.ends_with("-win-x64.exe"),
            Self::Mac => name.starts_with("Tyne-") && name.ends_with("-mac-arm64.dmg"),
            Self::LinuxDeb => name.starts_with("Tyne-") && name.ends_with("-linux-amd64.deb"),
            Self::LinuxRpm => name.starts_with("Tyne-") && name.ends_with("-linux-x86_64.rpm"),
            Self::LinuxAppImage => {
                name.starts_with("Tyne-") && name.ends_with("-linux-x86_64.AppImage")
            }
            Self::Android => name.starts_with("tyne-") && name.ends_with(".apk"),
        }
    }
}

const ALL_TARGETS: [DownloadTarget; 6] = [
    DownloadTarget::Windows,
    DownloadTarget::Mac,
    DownloadTarget::LinuxDeb,
    DownloadTarget::LinuxRpm,
    DownloadTarget::LinuxAppImage,
    DownloadTarget::Android,
];

fn latest_release_page(repository: &str) -> String {
    format!("https://github.com/{repository}/releases/latest")
}

/// The download link of each target in a release from GitHub's `releases/latest` API. Only links
/// into that repository's own releases are taken.
pub(crate) fn links_in_release(
    repository: &str,
    release: &Value,
) -> HashMap<DownloadTarget, String> {
    let prefix = format!("https://github.com/{repository}/releases/download/");
    let mut links = HashMap::new();
    let Some(assets) = release.get("assets").and_then(Value::as_array) else {
        return links;
    };
    for asset in assets {
        let (Some(name), Some(url)) = (
            asset.get("name").and_then(Value::as_str),
            asset.get("browser_download_url").and_then(Value::as_str),
        ) else {
            continue;
        };
        if !url.starts_with(&prefix) {
            continue;
        }
        for target in ALL_TARGETS {
            if target.repository() == repository && target.matches(name) {
                links.entry(target).or_insert_with(|| url.to_owned());
            }
        }
    }
    links
}

#[derive(Default)]
pub(crate) struct ReleaseCache {
    links: HashMap<DownloadTarget, String>,
    fetched_at: Option<Instant>,
    failed_at: Option<Instant>,
}

impl ReleaseCache {
    fn is_fresh(&self, now: Instant) -> bool {
        self.fetched_at
            .is_some_and(|at| now.saturating_duration_since(at) < FRESH_FOR)
    }

    fn is_cooling_down(&self, now: Instant) -> bool {
        self.failed_at
            .is_some_and(|at| now.saturating_duration_since(at) < RETRY_AFTER_FAILURE)
    }
}

/// The link for `target`, fetching the release only when the cache is stale and not cooling down
/// after a failure. Holding the lock while fetching makes overlapping requests share one fetch.
pub(crate) async fn resolve_link<F, Fut>(
    cache: &Mutex<ReleaseCache>,
    target: DownloadTarget,
    now: impl Fn() -> Instant,
    fetch: F,
) -> Option<String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let mut cache = cache.lock().await;
    let checked_at = now();
    if !cache.is_fresh(checked_at) && !cache.is_cooling_down(checked_at) {
        match fetch().await {
            Ok(release) => {
                let links = links_in_release(target.repository(), &release);
                if links.is_empty() {
                    tracing::warn!(
                        repository = target.repository(),
                        "Fork: latest release has no known download files"
                    );
                    cache.failed_at = Some(now());
                } else {
                    cache.links = links;
                    cache.fetched_at = Some(now());
                    cache.failed_at = None;
                }
            }
            Err(error) => {
                tracing::warn!(repository = target.repository(), %error, "Fork: could not fetch the latest release");
                cache.failed_at = Some(now());
            }
        }
    }
    cache.links.get(&target).cloned()
}

fn cache_for(repository: &str) -> &'static Mutex<ReleaseCache> {
    static DESKTOP: OnceLock<Mutex<ReleaseCache>> = OnceLock::new();
    static MOBILE: OnceLock<Mutex<ReleaseCache>> = OnceLock::new();
    let cell = if repository == MOBILE_REPOSITORY {
        &MOBILE
    } else {
        &DESKTOP
    };
    cell.get_or_init(|| Mutex::new(ReleaseCache::default()))
}

async fn fetch_latest_release(client: &reqwest::Client, repository: &str) -> Result<Value, String> {
    let response = client
        .get(format!(
            "https://api.github.com/repos/{repository}/releases/latest"
        ))
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("GitHub answered {status}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RELEASE_BYTES as u64)
    {
        return Err("release is too large".to_owned());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_RELEASE_BYTES {
        return Err("release is too large".to_owned());
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn redirect(location: &str) -> Response {
    let Ok(value) = HeaderValue::from_str(location) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut response = StatusCode::FOUND.into_response();
    response.headers_mut().insert(header::LOCATION, value);
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub async fn download(State(state): State<AppState>, Path(target): Path<String>) -> Response {
    let Some(target) = DownloadTarget::parse(&target) else {
        return redirect("/download");
    };
    let repository = target.repository();
    let link = resolve_link(cache_for(repository), target, Instant::now, || {
        fetch_latest_release(&state.http_client, repository)
    })
    .await;
    redirect(&link.unwrap_or_else(|| latest_release_page(repository)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn desktop_release() -> Value {
        let base = "https://github.com/tyne-chat/tyne/releases/download/desktop-v2.1.22";
        json!({
            "tag_name": "desktop-v2.1.22",
            "assets": [
                {"name": "SHA256SUMS.txt", "browser_download_url": format!("{base}/SHA256SUMS.txt")},
                {"name": "Tyne-2.1.22-linux-amd64.deb", "browser_download_url": format!("{base}/Tyne-2.1.22-linux-amd64.deb")},
                {"name": "Tyne-2.1.22-linux-x64.tar.gz", "browser_download_url": format!("{base}/Tyne-2.1.22-linux-x64.tar.gz")},
                {"name": "Tyne-2.1.22-linux-x86_64.AppImage", "browser_download_url": format!("{base}/Tyne-2.1.22-linux-x86_64.AppImage")},
                {"name": "Tyne-2.1.22-linux-x86_64.rpm", "browser_download_url": format!("{base}/Tyne-2.1.22-linux-x86_64.rpm")},
                {"name": "Tyne-2.1.22-mac-arm64.dmg", "browser_download_url": format!("{base}/Tyne-2.1.22-mac-arm64.dmg")},
                {"name": "Tyne-2.1.22-mac-arm64.zip", "browser_download_url": format!("{base}/Tyne-2.1.22-mac-arm64.zip")},
                {"name": "Tyne-Setup-2.1.22-win-x64.exe", "browser_download_url": format!("{base}/Tyne-Setup-2.1.22-win-x64.exe")},
                {"name": "tyne_desktop-2.1.22-full.nupkg", "browser_download_url": format!("{base}/tyne_desktop-2.1.22-full.nupkg")}
            ]
        })
    }

    #[test]
    fn parses_only_known_targets() {
        assert_eq!(
            DownloadTarget::parse("windows"),
            Some(DownloadTarget::Windows)
        );
        assert_eq!(
            DownloadTarget::parse("linux-appimage"),
            Some(DownloadTarget::LinuxAppImage)
        );
        assert_eq!(DownloadTarget::parse("Windows"), None);
        assert_eq!(DownloadTarget::parse("../etc"), None);
    }

    #[test]
    fn finds_each_desktop_file_in_a_release() {
        let links = links_in_release(DESKTOP_REPOSITORY, &desktop_release());
        let base = "https://github.com/tyne-chat/tyne/releases/download/desktop-v2.1.22";
        assert_eq!(links.len(), 5);
        assert_eq!(
            links[&DownloadTarget::Windows],
            format!("{base}/Tyne-Setup-2.1.22-win-x64.exe")
        );
        assert_eq!(
            links[&DownloadTarget::Mac],
            format!("{base}/Tyne-2.1.22-mac-arm64.dmg")
        );
        assert_eq!(
            links[&DownloadTarget::LinuxDeb],
            format!("{base}/Tyne-2.1.22-linux-amd64.deb")
        );
        assert_eq!(
            links[&DownloadTarget::LinuxRpm],
            format!("{base}/Tyne-2.1.22-linux-x86_64.rpm")
        );
        assert_eq!(
            links[&DownloadTarget::LinuxAppImage],
            format!("{base}/Tyne-2.1.22-linux-x86_64.AppImage")
        );
    }

    #[test]
    fn finds_the_android_file_in_a_mobile_release() {
        let url =
            "https://github.com/tyne-chat/tyne-mobile/releases/download/v1.2.16/tyne-v1.2.16.apk";
        let release =
            json!({"assets": [{"name": "tyne-v1.2.16.apk", "browser_download_url": url}]});
        let links = links_in_release(MOBILE_REPOSITORY, &release);
        assert_eq!(links.len(), 1);
        assert_eq!(links[&DownloadTarget::Android], url);
    }

    #[test]
    fn ignores_links_outside_the_repository_releases() {
        let release = json!({"assets": [{
            "name": "Tyne-Setup-2.1.22-win-x64.exe",
            "browser_download_url": "https://example.com/Tyne-Setup-2.1.22-win-x64.exe"
        }]});
        assert!(links_in_release(DESKTOP_REPOSITORY, &release).is_empty());
        assert!(links_in_release(DESKTOP_REPOSITORY, &json!({})).is_empty());
    }

    async fn resolve_counting(
        cache: &Mutex<ReleaseCache>,
        now: Instant,
        result: Result<Value, String>,
        fetches: &AtomicUsize,
    ) -> Option<String> {
        resolve_link(
            cache,
            DownloadTarget::Windows,
            || now,
            || {
                fetches.fetch_add(1, Ordering::SeqCst);
                async move { result }
            },
        )
        .await
    }

    #[tokio::test]
    async fn fetches_once_while_the_answer_is_fresh() {
        let cache = Mutex::new(ReleaseCache::default());
        let fetches = AtomicUsize::new(0);
        let start = Instant::now();
        for minute in 0..10 {
            let now = start + Duration::from_secs(minute * 60);
            let link = resolve_counting(&cache, now, Ok(desktop_release()), &fetches).await;
            assert!(link.unwrap().ends_with("Tyne-Setup-2.1.22-win-x64.exe"));
        }
        assert_eq!(fetches.load(Ordering::SeqCst), 1);

        let later = start + FRESH_FOR;
        resolve_counting(&cache, later, Ok(desktop_release()), &fetches).await;
        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_failure_is_not_retried_until_the_cooldown_ends() {
        let cache = Mutex::new(ReleaseCache::default());
        let fetches = AtomicUsize::new(0);
        let start = Instant::now();
        for second in 0..100 {
            let now = start + Duration::from_secs(second);
            let link = resolve_counting(&cache, now, Err("429".to_owned()), &fetches).await;
            assert_eq!(link, None);
        }
        assert_eq!(fetches.load(Ordering::SeqCst), 1);

        let later = start + RETRY_AFTER_FAILURE;
        let link = resolve_counting(&cache, later, Ok(desktop_release()), &fetches).await;
        assert!(link.is_some());
        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn keeps_the_last_good_links_when_a_refresh_fails() {
        let cache = Mutex::new(ReleaseCache::default());
        let fetches = AtomicUsize::new(0);
        let start = Instant::now();
        resolve_counting(&cache, start, Ok(desktop_release()), &fetches).await;

        let stale = start + FRESH_FOR;
        let link = resolve_counting(&cache, stale, Err("offline".to_owned()), &fetches).await;
        assert!(link.unwrap().ends_with("Tyne-Setup-2.1.22-win-x64.exe"));
        let soon_after = stale + Duration::from_secs(1);
        resolve_counting(&cache, soon_after, Err("offline".to_owned()), &fetches).await;
        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_release_without_known_files_counts_as_a_failure() {
        let cache = Mutex::new(ReleaseCache::default());
        let fetches = AtomicUsize::new(0);
        let start = Instant::now();
        let empty = json!({"assets": []});
        assert_eq!(
            resolve_counting(&cache, start, Ok(empty.clone()), &fetches).await,
            None
        );
        let soon_after = start + Duration::from_secs(1);
        assert_eq!(
            resolve_counting(&cache, soon_after, Ok(empty), &fetches).await,
            None
        );
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn overlapping_requests_share_one_fetch() {
        let cache = Arc::new(Mutex::new(ReleaseCache::default()));
        let fetches = Arc::new(AtomicUsize::new(0));
        let now = Instant::now();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel::<()>();
        let first = {
            let cache = cache.clone();
            let fetches = fetches.clone();
            tokio::spawn(async move {
                resolve_link(
                    &cache,
                    DownloadTarget::Windows,
                    || now,
                    || {
                        fetches.fetch_add(1, Ordering::SeqCst);
                        async move {
                            release_rx.await.ok();
                            Ok(desktop_release())
                        }
                    },
                )
                .await
            })
        };
        while fetches.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        let others: Vec<_> = (0..20)
            .map(|_| {
                let cache = cache.clone();
                let fetches = fetches.clone();
                tokio::spawn(async move {
                    resolve_link(
                        &cache,
                        DownloadTarget::Mac,
                        || now,
                        || {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            async { Ok(desktop_release()) }
                        },
                    )
                    .await
                })
            })
            .collect();
        release_tx.send(()).unwrap();
        assert!(first.await.unwrap().is_some());
        for other in others {
            assert!(other.await.unwrap().unwrap().ends_with("mac-arm64.dmg"));
        }
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unknown_targets_fall_back_to_the_page() {
        let response = redirect("/download");
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(response.headers()[header::LOCATION], "/download");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    }
}
