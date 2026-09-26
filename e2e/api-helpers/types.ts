export interface AuthRegisterRequest {
	username: string;
	email: string;
	password: string;
	consent?: boolean;
	date_of_birth?: string;
	global_name?: string;
}

export interface AuthLoginRequest {
	login: string;
	password: string;
}

export interface AuthTokenResponse {
	token: string;
	user_id?: string;
	user?: {
		id: string;
		username: string;
		global_name?: string;
	};
}

export interface PersonaTag {
	prefix?: string;
	suffix?: string;
}

export interface CreatePersonaParams {
	name: string;
	avatar_url?: string | null;
	banner_url?: string | null;
	pronouns?: string | null;
	color?: number | null;
	bio?: string | null;
	auto_tag_disabled?: boolean;
	persona_tags?: Array<PersonaTag>;
	visibility?: 'unlisted' | 'public' | 'private';
	external_uuid?: string | null;
}

export interface PersonaRecord {
	id: string;
	name: string;
	avatar_url?: string | null;
	banner_url?: string | null;
	pronouns?: string | null;
	color?: number | null;
	bio?: string | null;
	auto_tag_disabled: boolean;
	persona_tags: Array<PersonaTag>;
	use_count: number;
	visibility: 'unlisted' | 'public' | 'private';
	external_uuid?: string | null;
	created_at: string;
	updated_at: string;
}

export interface PersonaSettingsRecord {
	user_id: string;
	active_persona_mode: 'manual' | 'last';
	active_persona_id?: string | null;
	is_latched: boolean;
	display_tag_text?: string | null;
	display_tag_icon?: string | null;
}

export interface TestAccountInfo {
	username: string;
	email: string;
	password: string;
	token: string;
	userId: string;
	personas: Array<PersonaRecord>;
}

export interface SeedDataResult {
	apiUrl: string;
	alice: TestAccountInfo;
	bob: TestAccountInfo;
	carol: TestAccountInfo;
	guildId: string;
	channelId: string;
}
