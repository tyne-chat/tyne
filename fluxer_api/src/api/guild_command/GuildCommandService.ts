// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	type ChannelID,
	createChannelID,
	createPersonaID,
	createUserID,
	type GuildID,
	type UserID,
} from '@app/api/BrandedTypes';
import type {MessageRequestService} from '@app/api/channel/services/message/MessageRequestService';
import type {GuildCommandRow} from '@app/api/database/types/GuildCommandTypes';
import type {ThreadViewer} from '@app/api/experiment/ChannelThreadsGate';
import type {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import {
	GuildCommandBrokenError,
	GuildCommandInputError,
	GuildCommandLimitReachedError,
	GuildCommandNameTakenError,
	GuildCommandTemplateError,
	UnknownGuildCommandError,
} from '@app/api/guild_command/GuildCommandErrors';
import type {GuildCommandRepository} from '@app/api/guild_command/GuildCommandRepository';
import {
	escapeGuildCommandName,
	GuildCommandChannelDrop,
	GuildCommandMentionDrop,
	type GuildCommandScope,
	type GuildCommandTemplateEngine,
} from '@app/api/guild_command/GuildCommandTemplateEngine';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {RequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import type {Channel} from '@app/api/models/Channel';
import type {User} from '@app/api/models/User';
import type {IPersonaRepository} from '@app/api/persona/IPersonaRepository';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import {
	classifyGuildCommandTemplate,
	type GuildCommandCreateRequest,
	type GuildCommandKind,
	type GuildCommandPreviewRequest,
	type GuildCommandPreviewResponse,
	type GuildCommandResponse,
	type GuildCommandRunRequest,
	type GuildCommandUpdateRequest,
	MAX_GUILD_COMMANDS,
	RESERVED_GUILD_COMMAND_NAMES,
} from '@fluxer/schema/src/domains/guild_command/GuildCommandSchemas';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';

// Fork: server commands (docs/design/server-commands.md). Defined per community, usable by its
// members wherever its custom emoji would be, and filled in here before an ordinary send.

interface GuildCommandServiceDeps {
	repository: GuildCommandRepository;
	engine: GuildCommandTemplateEngine;
	gatewayService: IGatewayService;
	guildRepository: GuildRepository;
	personaRepository: IPersonaRepository;
	messageRequestService: () => MessageRequestService;
	findUser: (userId: UserID) => Promise<User | null>;
	findChannel: (channelId: ChannelID) => Promise<Channel | null>;
	getUserGuildIds: (userId: UserID) => Promise<Array<GuildID>>;
	nextId: () => Promise<bigint>;
	now?: () => Date;
}

/** `<@user>` or `<@user:persona>`, the first mention in a command's input. */
const FIRST_MENTION = /<@!?(\d+)(?::(\d+))?>/;

function toResponse(row: GuildCommandRow, includeTemplate: boolean): GuildCommandResponse {
	return {
		id: row.command_id.toString(),
		guild_id: row.guild_id.toString(),
		name: row.name,
		description: row.description,
		kind: row.kind === 'script' ? 'script' : 'basic',
		input_mode: row.input_mode === 'none' || row.input_mode === 'optional' ? row.input_mode : 'required',
		input_type: 'text',
		input_hint: row.input_hint,
		creator_id: row.creator_id.toString(),
		created_at: row.created_at.toISOString(),
		updated_at: row.updated_at.toISOString(),
		...(includeTemplate ? {template: row.template} : {}),
	};
}

export class GuildCommandService {
	constructor(private readonly deps: GuildCommandServiceDeps) {}

	private now(): Date {
		return this.deps.now?.() ?? new Date();
	}

	private async hasPermission(guildId: GuildID, userId: UserID, permission: bigint): Promise<boolean> {
		try {
			return await this.deps.gatewayService.checkPermission({guildId, userId, permission});
		} catch {
			return false;
		}
	}

	private async canEdit(guildId: GuildID, userId: UserID): Promise<boolean> {
		const [create, manage] = await Promise.all([
			this.hasPermission(guildId, userId, Permissions.CREATE_COMMANDS),
			this.hasPermission(guildId, userId, Permissions.MANAGE_COMMANDS),
		]);
		return create || manage;
	}

	/** The creator needs Create commands; anyone else Manage commands (emoji's rule). */
	private async assertCanModify(row: GuildCommandRow, userId: UserID): Promise<void> {
		const permission = row.creator_id === userId ? Permissions.CREATE_COMMANDS : Permissions.MANAGE_COMMANDS;
		if (!(await this.hasPermission(row.guild_id, userId, permission))) throw new MissingPermissionsError();
	}

	private async assertMember(guildId: GuildID, userId: UserID): Promise<void> {
		const member = await this.deps.guildRepository.getMember(guildId, userId);
		if (!member) throw new UnknownGuildCommandError();
	}

	private assertName(name: string, rows: ReadonlyArray<GuildCommandRow>, ownId: bigint | null): void {
		if (RESERVED_GUILD_COMMAND_NAMES.has(name)) throw new GuildCommandNameTakenError();
		if (rows.some((row) => row.name === name && row.command_id !== ownId)) throw new GuildCommandNameTakenError();
	}

	private checkTemplate(template: string): GuildCommandKind {
		this.deps.engine.validate(template);
		return classifyGuildCommandTemplate(template);
	}

	private async announce(guildId: GuildID): Promise<void> {
		await this.deps.gatewayService.dispatchGuild({
			guildId,
			event: 'GUILD_COMMANDS_UPDATE',
			data: {guild_id: guildId.toString()},
		});
	}

	async listForGuild(userId: UserID, guildId: GuildID): Promise<Array<GuildCommandResponse>> {
		await this.assertMember(guildId, userId);
		const [rows, canEdit] = await Promise.all([
			this.deps.repository.listByGuild(guildId),
			this.canEdit(guildId, userId),
		]);
		return rows.map((row) => toResponse(row, canEdit));
	}

	/** Every command of every community the user belongs to, without templates, for the composer. */
	async listForUser(userId: UserID): Promise<Array<GuildCommandResponse>> {
		const guildIds = await this.deps.getUserGuildIds(userId);
		const lists = await Promise.all(guildIds.map((guildId) => this.deps.repository.listByGuild(guildId)));
		return lists.flat().map((row) => toResponse(row, false));
	}

	async create(userId: UserID, guildId: GuildID, request: GuildCommandCreateRequest): Promise<GuildCommandResponse> {
		if (!(await this.hasPermission(guildId, userId, Permissions.CREATE_COMMANDS))) {
			throw new MissingPermissionsError();
		}
		const rows = await this.deps.repository.listByGuild(guildId);
		if (rows.length >= MAX_GUILD_COMMANDS) throw new GuildCommandLimitReachedError(MAX_GUILD_COMMANDS);
		this.assertName(request.name, rows, null);
		const kind = this.checkTemplate(request.template);
		const now = this.now();
		const row: GuildCommandRow = {
			guild_id: guildId,
			command_id: await this.deps.nextId(),
			name: request.name,
			description: request.description ?? '',
			template: request.template,
			kind,
			input_mode: request.input_mode,
			input_type: request.input_type,
			input_hint: request.input_hint ?? null,
			creator_id: userId,
			created_at: now,
			updated_at: now,
		};
		await this.deps.repository.save(row);
		await this.announce(guildId);
		return toResponse(row, true);
	}

	async update(
		userId: UserID,
		guildId: GuildID,
		commandId: bigint,
		request: GuildCommandUpdateRequest,
	): Promise<GuildCommandResponse> {
		const existing = await this.deps.repository.get(guildId, commandId);
		if (!existing) throw new UnknownGuildCommandError();
		await this.assertCanModify(existing, userId);
		if (request.name !== undefined && request.name !== existing.name) {
			this.assertName(request.name, await this.deps.repository.listByGuild(guildId), commandId);
		}
		const template = request.template ?? existing.template;
		const row: GuildCommandRow = {
			...existing,
			name: request.name ?? existing.name,
			description: request.description !== undefined ? (request.description ?? '') : existing.description,
			template,
			kind: request.template !== undefined ? this.checkTemplate(template) : existing.kind,
			input_mode: request.input_mode ?? existing.input_mode,
			input_type: request.input_type ?? existing.input_type,
			input_hint: request.input_hint !== undefined ? request.input_hint : existing.input_hint,
			updated_at: this.now(),
		};
		await this.deps.repository.save(row);
		await this.announce(guildId);
		return toResponse(row, true);
	}

	async delete(userId: UserID, guildId: GuildID, commandId: bigint): Promise<void> {
		const existing = await this.deps.repository.get(guildId, commandId);
		if (!existing) throw new UnknownGuildCommandError();
		await this.assertCanModify(existing, userId);
		await this.deps.repository.delete(guildId, commandId);
		await this.announce(guildId);
	}

	async run(params: {
		user: User;
		viewer: ThreadViewer;
		channelId: ChannelID;
		commandId: bigint;
		request: GuildCommandRunRequest;
		requestCache: RequestCache;
	}): Promise<MessageResponse> {
		const {user, channelId, commandId, request} = params;
		const guildId = await this.deps.repository.findGuildId(commandId);
		const command = guildId ? await this.deps.repository.get(guildId, commandId) : null;
		if (!guildId || !command) throw new UnknownGuildCommandError();
		await this.assertMember(guildId, user.id);

		const channel = await this.deps.findChannel(channelId);
		if (channel?.guildId && channel.guildId !== guildId) {
			const allowed = await this.deps.gatewayService
				.checkPermission({
					guildId: channel.guildId,
					userId: user.id,
					permission: Permissions.USE_EXTERNAL_COMMANDS,
					channelId,
				})
				.catch(() => false);
			if (!allowed) throw new MissingPermissionsError();
		}

		const input = request.input ?? '';
		if (command.input_mode === 'none' && input.trim() !== '') {
			throw new GuildCommandInputError('This command takes no input');
		}
		if (command.input_mode === 'required' && input.trim() === '') {
			throw new GuildCommandInputError('This command needs input');
		}

		const scope = await this.buildScope({user, guildId, channel, input, personaId: request.persona_id ?? null});
		let content: string;
		try {
			content = this.deps.engine.render(command.template, scope);
		} catch (error) {
			throw error instanceof GuildCommandTemplateError ? new GuildCommandBrokenError() : error;
		}
		if (content === '') throw new GuildCommandBrokenError();

		return this.deps.messageRequestService().sendMessage({
			user,
			viewer: params.viewer,
			channelId,
			data: {content, persona_id: request.persona_id ? BigInt(request.persona_id) : undefined, nonce: request.nonce},
			requestCache: params.requestCache,
			fork: {guildCommandUse: {guildId, commandId, commandName: command.name}},
		});
	}

	/**
	 * Fills in a template without posting anything, for the script editor. A template with a problem is
	 * an answer here, not a failed request: the editor shows it where the message would be.
	 */
	async preview(params: {
		user: User;
		guildId: GuildID;
		request: GuildCommandPreviewRequest;
	}): Promise<GuildCommandPreviewResponse> {
		const {user, guildId, request} = params;
		if (!(await this.canEdit(guildId, user.id))) throw new MissingPermissionsError();
		const channel = await this.previewChannel(guildId, user.id, request.channel_id ?? null);
		const scope = await this.buildScope({user, guildId, channel, input: request.input ?? '', personaId: null});
		try {
			return {content: this.deps.engine.render(request.template, scope), issue: null};
		} catch (error) {
			if (error instanceof GuildCommandTemplateError) return {content: null, issue: error.issue};
			throw error;
		}
	}

	/** The channel to preview in, when it is in this community and the member can see it. */
	private async previewChannel(guildId: GuildID, userId: UserID, channelId: bigint | null): Promise<Channel | null> {
		if (channelId === null) return null;
		const id = createChannelID(channelId);
		const channel = await this.deps.findChannel(id);
		if (channel?.guildId !== guildId) return null;
		const visible = await this.deps.gatewayService
			.checkPermission({guildId, userId, permission: Permissions.VIEW_CHANNEL, channelId: id})
			.catch(() => false);
		return visible ? channel : null;
	}

	private async displayName(userId: UserID, guildId: GuildID | null): Promise<string> {
		const [user, member] = await Promise.all([
			this.deps.findUser(userId),
			guildId ? this.deps.guildRepository.getMember(guildId, userId) : Promise.resolve(null),
		]);
		return member?.nickname ?? user?.globalName ?? user?.username ?? '';
	}

	/** A persona of `userId`, or null when it is not theirs or is deleted. */
	private async ownedPersona(userId: UserID, personaId: string): Promise<{name: string} | null> {
		const persona = await this.deps.personaRepository.findById(userId, createPersonaID(BigInt(personaId)));
		return persona && !persona.isDeleted ? persona : null;
	}

	private async buildScope(params: {
		user: User;
		guildId: GuildID;
		channel: Channel | null;
		input: string;
		personaId: string | null;
	}): Promise<GuildCommandScope> {
		const {user, guildId, channel, input, personaId} = params;
		const channelGuildId = channel?.guildId ?? null;

		const ownPersona = personaId && personaId !== '0' ? await this.ownedPersona(user.id, personaId) : null;
		const person = ownPersona
			? new GuildCommandMentionDrop(`<@${user.id}:${personaId}>`, ownPersona.name)
			: new GuildCommandMentionDrop(`<@${user.id}>`, await this.displayName(user.id, channelGuildId));

		let target: GuildCommandMentionDrop | null = null;
		const mention = FIRST_MENTION.exec(input);
		if (mention) {
			const targetUserId = createUserID(BigInt(mention[1]));
			const targetPersona = mention[2] ? await this.ownedPersona(targetUserId, mention[2]) : null;
			target = targetPersona
				? new GuildCommandMentionDrop(`<@${targetUserId}:${mention[2]}>`, targetPersona.name)
				: new GuildCommandMentionDrop(`<@${targetUserId}>`, await this.displayName(targetUserId, channelGuildId));
		}

		const [commandGuild, channelGuild] = await Promise.all([
			this.deps.guildRepository.findUnique(guildId),
			channelGuildId && channelGuildId !== guildId
				? this.deps.guildRepository.findUnique(channelGuildId)
				: Promise.resolve(null),
		]);
		const channelCommunityName = channelGuildId ? ((channelGuild ?? commandGuild)?.name ?? '') : null;
		const channelDrop = channel?.guildId
			? new GuildCommandChannelDrop(`<#${channel.id}>`, channel.name ?? '', channelCommunityName)
			: new GuildCommandChannelDrop('', channel?.name ?? '', null);

		return {
			person,
			input,
			target,
			channel: channelDrop,
			community: {name: escapeGuildCommandName(commandGuild?.name ?? '')},
		};
	}
}
