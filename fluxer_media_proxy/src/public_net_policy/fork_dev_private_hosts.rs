// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: named hosts a development proxy may fetch from at a private address (tyne-chat/tyne#565).
//
// On the maintainers' dev host, production's public name resolves to the Docker bridge inside the
// containers (the router does not hairpin), so the proxy's public-address rule refuses it, and a
// persona import tested on the dev stack with a production export cannot download its pictures.
// `FLUXER_MEDIA_PROXY_DEV_PRIVATE_HOSTS` lists such hosts by exact name, comma-separated. It is read
// only when `FLUXER_ENV` is `development`, so a production proxy ignores it even if it is set; every
// other host keeps upstream's screen.

use super::resolver::{ResolveError, screen_resolved_addresses};
use std::net::SocketAddr;
use std::sync::OnceLock;

const HOSTS_VAR: &str = "FLUXER_MEDIA_PROXY_DEV_PRIVATE_HOSTS";

fn allowed_hosts(environment: Option<&str>, hosts: Option<&str>) -> Vec<String> {
    if environment != Some("development") {
        return Vec::new();
    }
    hosts
        .unwrap_or_default()
        .split(',')
        .map(|host| host.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|host| !host.is_empty())
        .collect()
}

fn configured_hosts() -> &'static [String] {
    static HOSTS: OnceLock<Vec<String>> = OnceLock::new();
    HOSTS.get_or_init(|| {
        allowed_hosts(
            std::env::var("FLUXER_ENV").ok().as_deref(),
            std::env::var(HOSTS_VAR).ok().as_deref(),
        )
    })
}

fn screen_for(
    allowed: &[String],
    host: &str,
    addresses: impl Iterator<Item = SocketAddr>,
) -> Result<Vec<SocketAddr>, ResolveError> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if !allowed.contains(&host) {
        return screen_resolved_addresses(addresses);
    }
    let addresses: Vec<SocketAddr> = addresses.collect();
    if addresses.is_empty() {
        return Err(ResolveError::HostResolvedToNoAddress);
    }
    Ok(addresses)
}

/// Upstream's screen of a host's addresses, except for a host the development settings name.
pub(super) fn screen_resolved_addresses_for(
    host: &str,
    addresses: impl Iterator<Item = SocketAddr>,
) -> Result<Vec<SocketAddr>, ResolveError> {
    screen_for(configured_hosts(), host, addresses)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bridge() -> std::vec::IntoIter<SocketAddr> {
        vec!["172.17.0.1:443".parse().unwrap()].into_iter()
    }

    #[test]
    fn is_off_outside_development() {
        assert!(allowed_hosts(Some("production"), Some("temple.example")).is_empty());
        assert!(allowed_hosts(None, Some("temple.example")).is_empty());
    }

    #[test]
    fn reads_exact_names_in_development() {
        assert_eq!(
            allowed_hosts(
                Some("development"),
                Some(" Temple.Example. , ,media.example")
            ),
            vec!["temple.example".to_owned(), "media.example".to_owned()]
        );
        assert!(allowed_hosts(Some("development"), None).is_empty());
    }

    #[test]
    fn lets_a_listed_host_resolve_to_a_private_address() {
        let allowed = vec!["temple.example".to_owned()];
        assert_eq!(
            screen_for(&allowed, "TEMPLE.example.", bridge()),
            Ok(bridge().collect::<Vec<_>>())
        );
    }

    #[test]
    fn keeps_the_public_address_rule_for_every_other_host() {
        let allowed = vec!["temple.example".to_owned()];
        assert_eq!(
            screen_for(&allowed, "sub.temple.example", bridge()),
            Err(ResolveError::BlockedAddress)
        );
        assert_eq!(
            screen_for(&[], "temple.example", bridge()),
            Err(ResolveError::BlockedAddress)
        );
    }
}
