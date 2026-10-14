// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: passkeys used in the Tyne Android app (`chat.tyne.app`) arrive with the app's signing certificate
// as their origin, not the instance's web origin. Every instance running this software accepts them,
// whatever FLUXER_PASSKEY_ADDITIONAL_ALLOWED_ORIGINS lists. The certificate must match the app's entry in
// fluxer_app_proxy/src/routes/fork_android_association.rs.

/** `android:apk-key-hash:` + the release certificate's SHA-256 in unpadded base64url (CN=Tyne, O=Tyne Chat). */
export const TYNE_ANDROID_PASSKEY_ORIGIN = 'android:apk-key-hash:IhwW5aS1aKTRiAPemw75Fe7Nu_HAzvNseDHjpyWha3s';

export function withForkPasskeyOrigins(origins: Array<string>): Array<string> {
	return [...new Set([...origins, TYNE_ANDROID_PASSKEY_ORIGIN])];
}
