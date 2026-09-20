// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildMember} from '@app/features/member/models/GuildMember';
import type {User} from '@app/features/user/models/User';
import type {MessageSubprofileResponse} from '@fluxer/schema/src/domains/persona/PersonaSchemas';
import {makeAutoObservable} from 'mobx';

class PersonaProfileMobile {
	subprofile: MessageSubprofileResponse | null = null;
	user: User | null = null;
	guildId: string | undefined = undefined;
	guildMember: GuildMember | null = null;

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	get isOpen(): boolean {
		return Boolean(this.subprofile && this.user);
	}

	open(subprofile: MessageSubprofileResponse, user: User, guildId?: string, guildMember?: GuildMember | null): void {
		this.subprofile = subprofile;
		this.user = user;
		this.guildId = guildId;
		this.guildMember = guildMember ?? null;
	}

	close(): void {
		this.subprofile = null;
		this.user = null;
		this.guildId = undefined;
		this.guildMember = null;
	}
}

export default new PersonaProfileMobile();
