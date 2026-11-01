// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the Dart SDK types `hidden_built_in_guild_badges` as one enum value, because its generator
// turns a top-level array of an inline enum into the enum. A phone then cannot parse a discovery
// document that carries the list, not even an empty one (tyne-chat/tyne#454), and mobile v1.2.13
// and v1.2.14 shipped like that. The field is optional and the web and desktop apps read a missing
// list as an empty one, so an empty list is left out. A list with something in it still reaches
// those two builds and they still fail on it. Remove this once they are gone.

export function forkOmitEmptyHiddenBuiltInGuildBadges<
	T extends {hidden_built_in_guild_badges?: ReadonlyArray<unknown>},
>(response: T): T | Omit<T, 'hidden_built_in_guild_badges'> {
	if (response.hidden_built_in_guild_badges?.length !== 0) {
		return response;
	}
	const {hidden_built_in_guild_badges: _omitted, ...rest} = response;
	return rest;
}
