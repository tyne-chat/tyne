// SPDX-License-Identifier: AGPL-3.0-or-later

import type {Channel} from '@app/features/channel/models/Channel';
import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import MessageChangePersona from '@app/features/messaging/state/MessageChangePersona';
import MessageEdit from '@app/features/messaging/state/MessageEdit';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {
	canUsePresignedAttachmentUploads,
	completeMultipartAttachmentUploads,
	type MultipartAttachmentUpload,
	requestPresignedAttachmentUploads,
	uploadAttachmentsViaPlans,
} from '@app/features/messaging/upload/AttachmentUploadPlan';
import {type CloudAttachment, CloudUpload} from '@app/features/messaging/upload/CloudUpload';
import {prepareAttachmentsForNonce} from '@app/features/messaging/utils/MessageAttachmentUtils';
import {buildExistingAttachmentEditReferences} from '@app/features/messaging/utils/MessageEditContentUtils';
import type {
	ApiAttachmentMetadata,
	ApiMessageEditAttachmentMetadata,
} from '@app/features/messaging/utils/MessageRequestUtils';
import {PersonaStore} from '@app/features/persona/state/PersonaStore';
import {isAbortError} from '@app/features/platform/utils/PlatformHelpers';
import {makeAutoObservable} from 'mobx';

interface PreparedUploads {
	attachments: Array<ApiAttachmentMetadata>;
	files?: Array<File>;
}

// Files for an edit wait in CloudUpload under a key of their own, as a thread draft's do. They stay
// there until the edit is saved, so a failed upload can be retried from the same box.
async function prepareUploads(channelId: string, nonce: string, signal: AbortSignal): Promise<PreparedUploads> {
	const {attachments: rawAttachments = [], files = []} = await prepareAttachmentsForNonce(nonce);
	if (!canUsePresignedAttachmentUploads(files)) {
		return {attachments: rawAttachments, files};
	}
	let plans: Awaited<ReturnType<typeof requestPresignedAttachmentUploads>>;
	try {
		plans = await requestPresignedAttachmentUploads(channelId, rawAttachments, files, signal);
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
		return {attachments: rawAttachments, files};
	}
	const multipartUploadsToComplete: Array<MultipartAttachmentUpload> = [];
	const attachments = await uploadAttachmentsViaPlans({
		nonce,
		attachments: rawAttachments,
		files,
		plans,
		planIndexById: new Map(plans.map((plan, index) => [String(plan.id), index])),
		multipartUploadsToComplete,
		signal,
	});
	if (multipartUploadsToComplete.length > 0) {
		await completeMultipartAttachmentUploads(channelId, multipartUploadsToComplete, signal);
	}
	return {attachments};
}

function isChangedOrGone(saving: CloudAttachment, inBox: CloudAttachment | undefined): boolean {
	return (
		inBox === undefined ||
		inBox.filename !== saving.filename ||
		inBox.description !== saving.description ||
		inBox.flags !== saving.flags
	);
}

const abortControllers = new Map<string, AbortController>();
const openEdits = new Map<string, string>();
const filesBeingAdded = new Map<string, Set<Promise<unknown>>>();

class InlineEditUploads {
	private uploadingCounts: Record<string, number> = {};

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
		MessageEdit.subscribe(this.dropClosedEdits);
	}

	attachmentKey(messageId: string): string {
		return `inline-edit:${messageId}`;
	}

	// An edit can close with its row unmounted (another channel is open), so what it left behind is
	// cleared from here and not by the row. Closing during a save waits for the save to end.
	trackEdit(channelId: string, messageId: string): void {
		openEdits.set(messageId, channelId);
	}

	// A file takes a moment to be read before the box shows it. Save waits for it, and one that
	// arrives after the edit closed is dropped, or it would turn up in that message's next edit.
	trackAdding(messageId: string, adding: Promise<unknown>): void {
		const pending = filesBeingAdded.get(messageId) ?? new Set();
		pending.add(adding);
		filesBeingAdded.set(messageId, pending);
		const settle = () => {
			pending.delete(adding);
			if (pending.size === 0) {
				filesBeingAdded.delete(messageId);
			}
			if (!openEdits.has(messageId)) {
				CloudUpload.clearTextarea(this.attachmentKey(messageId));
			}
		};
		adding.then(settle, settle);
	}

	hasFiles(messageId: string): boolean {
		return (
			filesBeingAdded.has(messageId) || CloudUpload.getTextareaAttachments(this.attachmentKey(messageId)).length > 0
		);
	}

	uploadingCount(messageId: string): number {
		return this.uploadingCounts[messageId] ?? 0;
	}

	isSaving(messageId: string): boolean {
		return abortControllers.has(messageId);
	}

	// Saves what the box holds now and stays out of the way until it lands: locking the editor would
	// take its focus, and typing would go to the channel composer. Text, new files or a persona changed
	// meanwhile stay in the box for the next Save. Removing, renaming or spoilering a file being saved
	// cannot wait for that, because it would publish as it was, so it stops the save. Unlike a text
	// edit, this keeps the edit open until the files have landed: closing first would lose them when
	// an upload fails.
	async save(params: {channel: Channel; message: Message; content: string; onSaved: () => void}): Promise<void> {
		const {channel, message, content, onSaved} = params;
		if (abortControllers.has(message.id)) {
			return;
		}
		const key = this.attachmentKey(message.id);
		const nonce = `${key}-${Date.now()}`;
		const abortController = new AbortController();
		abortControllers.set(message.id, abortController);
		const textAtSave = MessageEdit.getEditingContent(channel.id, message.id);
		const pickAtSave = MessageChangePersona.resolveEditSubprofile(message.id, undefined);
		this.setUploadingCount(message.id, Math.max(1, CloudUpload.getTextareaAttachments(key).length));
		let stopWatchingBox = () => {};
		try {
			await Promise.allSettled(filesBeingAdded.get(message.id) ?? []);
			const pending = CloudUpload.getTextareaAttachments(key);
			this.setUploadingCount(message.id, pending.length);
			stopWatchingBox = CloudUpload.subscribeToTextarea(key, () => {
				const inBox = new Map(CloudUpload.getTextareaAttachments(key).map((attachment) => [attachment.id, attachment]));
				if (pending.some((attachment) => isChangedOrGone(attachment, inBox.get(attachment.id)))) {
					abortController.abort();
				}
			});
			let prepared: PreparedUploads = {attachments: []};
			if (pending.length > 0) {
				// Without preview URLs, because removing the upload revokes them and the box still shows them.
				const claimed = pending.map((attachment) => ({...attachment, previewURL: null, thumbnailURL: null}));
				CloudUpload.claimAttachmentsForMessage(key, nonce, claimed);
				prepared = await prepareUploads(channel.id, nonce, abortController.signal);
			}
			const editMatch = PersonaStore.matchEditMessage(content, message.subprofile, {
				hasAttachments: true,
				originalContent: message.content,
			});
			// The server drops every attachment an edit leaves out, so the ones it has go first. They are
			// read now because an upload can be slow, and another device can change them meanwhile.
			const allAttachments: Array<ApiMessageEditAttachmentMetadata> = [
				...buildExistingAttachmentEditReferences(Messages.getMessage(channel.id, message.id) ?? message),
				...prepared.attachments,
			];
			// Files already in storage make this a quick request that cannot be recalled, and stopping it
			// halfway would leave them in the box to be added twice. Files sent with it can still stop.
			if (prepared.files === undefined) {
				stopWatchingBox();
			}
			const saved = await MessageCommands.editWithFiles(
				channel.id,
				message.id,
				{
					content: editMatch.finalContent,
					allowedMentions: message._allowedMentions,
					attachments: allAttachments,
					subprofile: editMatch.subprofile !== undefined ? editMatch.subprofile : pickAtSave,
				},
				prepared.files,
				abortController.signal,
			);
			stopWatchingBox();
			if (!saved) {
				return;
			}
			for (const attachment of pending) {
				CloudUpload.removeAttachment(key, attachment.id);
			}
			const pickUnchanged = MessageChangePersona.resolveEditSubprofile(message.id, undefined) === pickAtSave;
			if (pickUnchanged) {
				MessageChangePersona.clearPendingSubprofile(message.id);
			}
			const boxUnchanged =
				pickUnchanged &&
				!this.hasFiles(message.id) &&
				MessageEdit.getEditingContent(channel.id, message.id) === textAtSave;
			if (boxUnchanged && MessageEdit.isEditing(channel.id, message.id)) {
				onSaved();
			}
		} catch (error) {
			if (!isAbortError(error)) {
				MessageCommands.showEditWithFilesFailure(error);
			}
		} finally {
			stopWatchingBox();
			CloudUpload.removeMessageUpload(nonce);
			abortControllers.delete(message.id);
			this.setUploadingCount(message.id, 0);
			this.dropClosedEdits();
		}
	}

	private dropClosedEdits(): void {
		for (const [messageId, channelId] of openEdits) {
			if (MessageEdit.isEditing(channelId, messageId)) {
				continue;
			}
			const running = abortControllers.get(messageId);
			if (running === undefined) {
				openEdits.delete(messageId);
				CloudUpload.clearTextarea(this.attachmentKey(messageId));
				MessageChangePersona.clearPendingSubprofile(messageId);
			} else if (MessageEdit.getEditingMessageId(channelId) === null) {
				// Closing the edit cancels the save, by whichever way it closed. Opening another edit in the
				// channel does not: that person still expects this one to land.
				running.abort();
			}
		}
	}

	private setUploadingCount(messageId: string, count: number): void {
		if (count > 0) {
			this.uploadingCounts[messageId] = count;
		} else {
			delete this.uploadingCounts[messageId];
		}
	}
}

export default new InlineEditUploads();
