import type {
	AuthLoginRequest,
	AuthRegisterRequest,
	AuthTokenResponse,
	CreatePersonaParams,
	PersonaRecord,
	PersonaSettingsRecord,
} from './types.js';

export class FluxerApiClient {
	private baseUrl: string;
	private token: string | null = null;
	private sessionStarted: boolean = false;

	constructor(baseUrl: string, token?: string) {
		// Strip trailing slash if present
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		if (token) {
			this.token = token;
		}
	}

	public setToken(token: string) {
		this.token = token;
	}

	public getToken(): string | null {
		return this.token;
	}

	private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...((options.headers as Record<string, string>) || {}),
		};

		if (this.token && !headers['Authorization']) {
			headers['Authorization'] = this.token;
		}

		const response = await fetch(url, {
			...options,
			headers,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			throw new Error(`API ${options.method || 'GET'} ${url} failed (${response.status}): ${errorText}`);
		}

		if (response.status === 204) {
			return null as T;
		}

		return (await response.json()) as T;
	}

	// --- Auth Endpoints ---

	public async register(data: AuthRegisterRequest): Promise<AuthTokenResponse> {
		const payload = {
			consent: true,
			date_of_birth: '2000-01-01',
			...data,
		};
		const res = await this.request<AuthTokenResponse>('/api/auth/register', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
		if (res.token) {
			this.token = res.token;
		}
		return res;
	}

	public async login(data: AuthLoginRequest): Promise<AuthTokenResponse> {
		const res = await this.request<AuthTokenResponse>('/api/auth/login', {
			method: 'POST',
			body: JSON.stringify(data),
		});
		if (res.token) {
			this.token = res.token;
		}
		return res;
	}

	public async getMe(): Promise<{id: string; username: string; global_name?: string}> {
		return this.request<{id: string; username: string; global_name?: string}>('/api/v1/users/@me');
	}

	// --- Guild / Channel Endpoints ---

	public async getMyGuilds(): Promise<Array<{id: string; name: string}>> {
		return this.request<Array<{id: string; name: string}>>('/api/v1/users/@me/guilds');
	}

	public async createGuild(name: string): Promise<{id: string; name: string}> {
		return this.request<{id: string; name: string}>('/api/v1/guilds', {
			method: 'POST',
			body: JSON.stringify({name}),
		});
	}

	public async getGuildChannels(guildId: string): Promise<Array<{id: string; name: string; type: number}>> {
		return this.request<Array<{id: string; name: string; type: number}>>(`/api/v1/guilds/${guildId}/channels`);
	}

	public async createInvite(channelId: string): Promise<{code: string}> {
		return this.request<{code: string}>(`/api/v1/channels/${channelId}/invites`, {
			method: 'POST',
			body: JSON.stringify({max_age: 0, max_uses: 0}),
		});
	}

	public async acceptInvite(inviteCode: string): Promise<{guild?: {id: string}}> {
		return this.request<{guild?: {id: string}}>(`/api/v1/invites/${inviteCode}`, {
			method: 'POST',
		});
	}

	// --- Persona Endpoints ---

	public async getPersonas(): Promise<Array<PersonaRecord>> {
		return this.request<Array<PersonaRecord>>('/api/v1/users/@me/personas');
	}

	public async createPersona(persona: CreatePersonaParams): Promise<PersonaRecord> {
		return this.request<PersonaRecord>('/api/v1/users/@me/personas', {
			method: 'POST',
			body: JSON.stringify(persona),
		});
	}

	public async updatePersona(personaId: string, updates: Partial<CreatePersonaParams>): Promise<PersonaRecord> {
		return this.request<PersonaRecord>(`/api/v1/users/@me/personas/${personaId}`, {
			method: 'PATCH',
			body: JSON.stringify(updates),
		});
	}

	public async deletePersona(personaId: string): Promise<void> {
		await this.request<void>(`/api/v1/users/@me/personas/${personaId}`, {
			method: 'DELETE',
		});
	}

	public async uploadPersonaAvatar(dataUri: string): Promise<{avatar_url: string}> {
		return this.request<{avatar_url: string}>('/api/v1/users/@me/personas/avatar', {
			method: 'POST',
			body: JSON.stringify({avatar: dataUri}),
		});
	}

	public async uploadPersonaBanner(dataUri: string): Promise<{banner_url: string}> {
		return this.request<{banner_url: string}>('/api/v1/users/@me/personas/banner', {
			method: 'POST',
			body: JSON.stringify({banner: dataUri}),
		});
	}

	public async importPersonaBatchAvatars(urls: Array<string>): Promise<string> {
		const res = await fetch(`${this.baseUrl}/api/v1/users/@me/personas/import-batch-avatars`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.token}`,
			},
			body: JSON.stringify({urls}),
		});
		return res.text();
	}

	public async getPublicPersonas(userId: string): Promise<Array<any>> {
		return this.request<Array<any>>(`/api/v1/users/${userId}/personas`);
	}

	public async getPublicPersona(userId: string, personaId: string): Promise<any> {
		return this.request<any>(`/api/v1/users/${userId}/personas/${personaId}`);
	}

	public async getPersonaSettings(): Promise<PersonaSettingsRecord> {
		return this.request<PersonaSettingsRecord>('/api/v1/users/@me/personas/settings');
	}

	public async updatePersonaSettings(settings: Partial<PersonaSettingsRecord>): Promise<PersonaSettingsRecord> {
		return this.request<PersonaSettingsRecord>('/api/v1/users/@me/personas/settings', {
			method: 'PATCH',
			body: JSON.stringify(settings),
		});
	}

	public async startGatewaySession(timeoutMs = 10000): Promise<void> {
		if (!this.token) {
			throw new Error('Cannot start gateway session without an auth token');
		}
		const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/gateway?v=1&encoding=json&compress=none`;
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				try {
					ws.close();
				} catch {}
				reject(new Error(`Gateway session start timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			const ws = new WebSocket(wsUrl);
			ws.onmessage = (event: any) => {
				try {
					const data = JSON.parse(event.data.toString());
					if (data.op === 10) {
						// HELLO -> Send IDENTIFY
						ws.send(
							JSON.stringify({
								op: 2,
								d: {
									token: this.token,
									properties: {os: 'linux', browser: 'FluxerE2E', device: 'FluxerE2E'},
								},
							}),
						);
					} else if (data.t === 'READY') {
						clearTimeout(timer);
						this.sessionStarted = true;
						try {
							ws.close();
						} catch {}
						resolve();
					}
				} catch (err) {
					clearTimeout(timer);
					try {
						ws.close();
					} catch {}
					reject(err);
				}
			};

			ws.onerror = (err: any) => {
				clearTimeout(timer);
				try {
					ws.close();
				} catch {}
				reject(new Error(`Gateway WebSocket error: ${err.message || 'connection failed'}`));
			};
		});
	}

	public async ensureGatewaySession(): Promise<void> {
		if (this.sessionStarted) return;
		await this.startGatewaySession();
	}

	// --- Messaging Endpoints ---

	public async sendMessage(channelId: string, content: string, personaOrSubprofile?: any): Promise<any> {
		await this.ensureGatewaySession();
		const body: Record<string, any> = {content};
		if (personaOrSubprofile) {
			let sub = personaOrSubprofile;
			if (typeof sub === 'string') {
				const personas = await this.getPersonas();
				const found = personas.find((p) => p.id === sub);
				sub = found || {id: sub, name: sub};
			}
			if (typeof sub === 'object') {
				body.subprofile = {
					id: String(sub.id),
					name: sub.name,
					avatar: sub.avatar ?? sub.avatar_url ?? null,
					avatar_color: sub.avatar_color ?? sub.color ?? null,
					display_tag_text: sub.display_tag_text ?? sub.system_name ?? null,
					display_tag_icon: sub.display_tag_icon ?? null,
					system_name: sub.system_name ?? sub.display_tag_text ?? null,
					pronouns: sub.pronouns ?? null,
					color: sub.color ?? null,
				};
			}
		}
		return this.request(`/api/v1/channels/${channelId}/messages`, {
			method: 'POST',
			body: JSON.stringify(body),
		});
	}

	public async getMessages(channelId: string, limit = 50): Promise<Array<any>> {
		return this.request<Array<any>>(`/api/v1/channels/${channelId}/messages?limit=${limit}`);
	}

	public async editMessage(
		channelId: string,
		messageId: string,
		content: string,
		personaOrSubprofile?: any,
	): Promise<any> {
		const body: Record<string, any> = {content};
		if (personaOrSubprofile !== undefined) {
			let sub = personaOrSubprofile;
			if (typeof sub === 'string') {
				const personas = await this.getPersonas();
				const found = personas.find((p) => p.id === sub);
				sub = found || {id: sub, name: sub};
			}
			if (sub && typeof sub === 'object') {
				body.subprofile = {
					id: String(sub.id),
					name: sub.name,
					avatar: sub.avatar ?? sub.avatar_url ?? null,
					avatar_color: sub.avatar_color ?? sub.color ?? null,
					display_tag_text: sub.display_tag_text ?? sub.system_name ?? null,
					display_tag_icon: sub.display_tag_icon ?? null,
					system_name: sub.system_name ?? sub.display_tag_text ?? null,
					pronouns: sub.pronouns ?? null,
					color: sub.color ?? null,
				};
			} else {
				body.subprofile = sub;
			}
		}
		return this.request(`/api/v1/channels/${channelId}/messages/${messageId}`, {
			method: 'PATCH',
			body: JSON.stringify(body),
		});
	}

	public async deleteMessage(channelId: string, messageId: string): Promise<void> {
		await this.request<void>(`/api/v1/channels/${channelId}/messages/${messageId}`, {
			method: 'DELETE',
		});
	}
}
