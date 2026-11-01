// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import type {Channel} from '@app/features/channel/models/Channel';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
	pending: new Map<string, Array<{id: number; flags?: number; filename?: string; description?: string | null}>>(),
	claim: vi.fn(),
	prepare: vi.fn(),
	canPresign: vi.fn(),
	requestPlans: vi.fn(),
	uploadViaPlans: vi.fn(),
	completeMultipart: vi.fn(),
	editWithFiles: vi.fn(),
	showFailure: vi.fn(),
	getMessage: vi.fn(),
	isEditing: vi.fn(),
	editingContent: vi.fn(),
	editingMessageId: vi.fn(),
	onEditChange: undefined as (() => void) | undefined,
	onBoxChange: undefined as (() => void) | undefined,
	picks: new Map<string, unknown>(),
}));

vi.mock('@app/features/messaging/upload/CloudUpload', () => ({
	CloudUpload: {
		getTextareaAttachments: (key: string) => mocks.pending.get(key) ?? [],
		clearTextarea: (key: string) => mocks.pending.delete(key),
		removeAttachment: (key: string, id: number) =>
			mocks.pending.set(
				key,
				(mocks.pending.get(key) ?? []).filter((attachment) => attachment.id !== id),
			),
		claimAttachmentsForMessage: mocks.claim,
		removeMessageUpload: vi.fn(),
		subscribeToTextarea: (_key: string, listener: () => void) => {
			mocks.onBoxChange = listener;
			return () => {
				mocks.onBoxChange = undefined;
			};
		},
	},
}));
vi.mock('@app/features/messaging/utils/MessageAttachmentUtils', () => ({prepareAttachmentsForNonce: mocks.prepare}));
vi.mock('@app/features/messaging/upload/AttachmentUploadPlan', () => ({
	canUsePresignedAttachmentUploads: mocks.canPresign,
	requestPresignedAttachmentUploads: mocks.requestPlans,
	uploadAttachmentsViaPlans: mocks.uploadViaPlans,
	completeMultipartAttachmentUploads: mocks.completeMultipart,
}));
vi.mock('@app/features/messaging/commands/MessageCommands', () => ({
	editWithFiles: mocks.editWithFiles,
	showEditWithFilesFailure: mocks.showFailure,
}));
vi.mock('@app/features/messaging/utils/MessageEditContentUtils', () => ({
	buildExistingAttachmentEditReferences: (message: Message) =>
		message.attachments.map((attachment) => ({id: attachment.id})),
}));
vi.mock('@app/features/messaging/state/MessagingMessages', () => ({default: {getMessage: mocks.getMessage}}));
vi.mock('@app/features/messaging/state/MessageChangePersona', () => ({
	default: {
		resolveEditSubprofile: (id: string, typed: unknown) => (typed !== undefined ? typed : mocks.picks.get(id)),
		clearPendingSubprofile: (id: string) => mocks.picks.delete(id),
	},
}));
vi.mock('@app/features/messaging/state/MessageEdit', () => ({
	default: {
		isEditing: mocks.isEditing,
		getEditingContent: mocks.editingContent,
		getEditingMessageId: mocks.editingMessageId,
		subscribe: (callback: () => void) => {
			mocks.onEditChange = callback;
			return () => {};
		},
	},
}));
vi.mock('@app/features/persona/state/PersonaStore', () => ({
	PersonaStore: {matchEditMessage: (content: string) => ({finalContent: content, subprofile: undefined})},
}));

import InlineEditUploads from '@app/features/messaging/state/InlineEditUploads';

const channel = {id: 'channel-1'} as Channel;
const message = {id: 'message-1', attachments: [{id: 'kept'}], content: 'text', subprofile: null} as unknown as Message;
const key = InlineEditUploads.attachmentKey(message.id);
const file = new File(['x'], 'a.png');
const metadata = [{id: '0', filename: 'a.png'}];

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return {promise, resolve};
}

describe('InlineEditUploads', () => {
	const onSaved = vi.fn();
	const save = () => InlineEditUploads.save({channel, message, content: 'text', onSaved});

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.pending.clear();
		mocks.pending.set(key, [{id: 1}]);
		mocks.prepare.mockResolvedValue({attachments: metadata, files: [file]});
		mocks.canPresign.mockReturnValue(true);
		mocks.requestPlans.mockResolvedValue([{id: '0'}]);
		mocks.uploadViaPlans.mockResolvedValue([{id: '0', filename: 'a.png', upload_filename: 'stored.png'}]);
		mocks.editWithFiles.mockResolvedValue(true);
		mocks.getMessage.mockReturnValue(undefined);
		mocks.isEditing.mockReturnValue(true);
		mocks.editingContent.mockReturnValue('text');
		mocks.editingMessageId.mockReturnValue(null);
		mocks.picks.clear();
		InlineEditUploads.trackEdit(channel.id, message.id);
	});

	const holdUpload = () => {
		const upload = deferred<Array<unknown>>();
		mocks.uploadViaPlans.mockReturnValue(upload.promise);
		return upload;
	};

	it('sends one edit that keeps the existing attachments first, then closes', async () => {
		await save();

		expect(mocks.requestPlans).toHaveBeenCalledTimes(1);
		expect(mocks.uploadViaPlans).toHaveBeenCalledTimes(1);
		expect(mocks.editWithFiles).toHaveBeenCalledTimes(1);
		const [, , payload, files] = mocks.editWithFiles.mock.calls[0];
		expect(payload.attachments).toEqual([{id: 'kept'}, {id: '0', filename: 'a.png', upload_filename: 'stored.png'}]);
		expect(files).toBeUndefined();
		expect(onSaved).toHaveBeenCalledTimes(1);
		expect(InlineEditUploads.hasFiles(message.id)).toBe(false);
	});

	it('keeps what the message has when the upload ends, not when it started', async () => {
		const addedElsewhere = {...message, attachments: [{id: 'kept'}, {id: 'from-another-device'}]};
		mocks.getMessage.mockReturnValue(addedElsewhere);

		await save();

		expect(mocks.editWithFiles.mock.calls[0][2].attachments.slice(0, 2)).toEqual([
			{id: 'kept'},
			{id: 'from-another-device'},
		]);
	});

	it('claims the files without taking them out of the box', async () => {
		await save();

		const [claimedKey, , claimed] = mocks.claim.mock.calls[0];
		expect(claimedKey).toBe(key);
		expect(claimed).toEqual([{id: 1, previewURL: null, thumbnailURL: null}]);
	});

	it('leaves text typed during the upload in an open edit', async () => {
		const upload = holdUpload();
		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());

		mocks.editingContent.mockReturnValue('text and more');
		upload.resolve(metadata);
		await running;

		expect(mocks.editWithFiles).toHaveBeenCalledTimes(1);
		expect(mocks.editWithFiles.mock.calls[0][2].content).toBe('text');
		expect(onSaved).not.toHaveBeenCalled();
	});

	it('removes only the files it saved, and leaves one added during the upload', async () => {
		const upload = holdUpload();
		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());

		mocks.pending.set(key, [{id: 1}, {id: 2}]);
		upload.resolve(metadata);
		await running;

		expect(mocks.pending.get(key)).toEqual([{id: 2}]);
		expect(onSaved).not.toHaveBeenCalled();
	});

	it('stops without saving when a file it is uploading is removed from the box', async () => {
		mocks.uploadViaPlans.mockImplementation(
			({signal}: {signal: AbortSignal}) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
				}),
		);
		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());
		expect(InlineEditUploads.isSaving(message.id)).toBe(true);

		mocks.pending.set(key, []);
		mocks.onBoxChange?.();
		await running;

		expect(mocks.editWithFiles).not.toHaveBeenCalled();
		expect(mocks.showFailure).not.toHaveBeenCalled();
		expect(onSaved).not.toHaveBeenCalled();
		expect(InlineEditUploads.isSaving(message.id)).toBe(false);
		expect(mocks.onBoxChange).toBeUndefined();
	});

	it('stops without saving when a file it is uploading is marked as a spoiler', async () => {
		mocks.pending.set(key, [{id: 1, flags: 0, filename: 'a.png', description: null}]);
		mocks.uploadViaPlans.mockImplementation(
			({signal}: {signal: AbortSignal}) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
				}),
		);
		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());

		mocks.pending.set(key, [{id: 1, flags: 8, filename: 'SPOILER_a.png', description: null}]);
		mocks.onBoxChange?.();
		await running;

		expect(mocks.editWithFiles).not.toHaveBeenCalled();
		expect(InlineEditUploads.hasFiles(message.id)).toBe(true);
	});

	it('stops watching the box before an edit whose files are already in storage', async () => {
		let watchingDuringEdit: boolean | undefined;
		mocks.editWithFiles.mockImplementation(async () => {
			watchingDuringEdit = mocks.onBoxChange !== undefined;
			return true;
		});

		await save();

		expect(watchingDuringEdit).toBe(false);
	});

	it('can still stop an edit that carries its files', async () => {
		mocks.canPresign.mockReturnValue(false);
		let watchingDuringEdit: boolean | undefined;
		mocks.editWithFiles.mockImplementation(async () => {
			watchingDuringEdit = mocks.onBoxChange !== undefined;
			return true;
		});

		await save();

		expect(watchingDuringEdit).toBe(true);
		expect(mocks.onBoxChange).toBeUndefined();
	});

	it('carries on when a file is added to the box during the upload', async () => {
		const upload = holdUpload();
		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());

		mocks.pending.set(key, [{id: 1}, {id: 2}]);
		mocks.onBoxChange?.();
		upload.resolve(metadata);
		await running;

		expect(mocks.editWithFiles).toHaveBeenCalledTimes(1);
	});

	it('leaves a persona picked during the upload, and clears the one it saved', async () => {
		mocks.picks.set(message.id, 'first');
		const upload = holdUpload();
		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());

		mocks.picks.set(message.id, 'second');
		upload.resolve(metadata);
		await running;

		expect(mocks.editWithFiles.mock.calls[0][2].subprofile).toBe('first');
		expect(mocks.picks.get(message.id)).toBe('second');
		expect(onSaved).not.toHaveBeenCalled();
	});

	it('finishes the save when another edit opens meanwhile, and does not close that edit', async () => {
		mocks.picks.set(message.id, 'picked');
		const upload = holdUpload();
		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());

		mocks.isEditing.mockReturnValue(false);
		mocks.editingMessageId.mockReturnValue('another-message');
		mocks.onEditChange?.();
		expect(InlineEditUploads.hasFiles(message.id)).toBe(true);

		upload.resolve(metadata);
		await running;

		expect(mocks.editWithFiles).toHaveBeenCalledTimes(1);
		expect(onSaved).not.toHaveBeenCalled();
		expect(InlineEditUploads.hasFiles(message.id)).toBe(false);
		expect(mocks.picks.has(message.id)).toBe(false);
	});

	it('clears what an edit left behind when it closes with its row unmounted', () => {
		mocks.picks.set(message.id, 'picked');

		mocks.isEditing.mockReturnValue(false);
		mocks.onEditChange?.();

		expect(InlineEditUploads.hasFiles(message.id)).toBe(false);
		expect(mocks.picks.has(message.id)).toBe(false);
	});

	it('waits for a file still being read, and saves it', async () => {
		mocks.pending.delete(key);
		const reading = deferred<unknown>();
		InlineEditUploads.trackAdding(message.id, reading.promise);
		expect(InlineEditUploads.hasFiles(message.id)).toBe(true);

		const running = save();
		await Promise.resolve();
		expect(mocks.claim).not.toHaveBeenCalled();

		mocks.pending.set(key, [{id: 1}]);
		reading.resolve(undefined);
		await running;

		expect(mocks.claim).toHaveBeenCalledTimes(1);
		expect(mocks.editWithFiles).toHaveBeenCalledTimes(1);
	});

	it('saves the rest when a file being read turns out to be unusable', async () => {
		mocks.pending.delete(key);
		const reading = deferred<unknown>();
		InlineEditUploads.trackAdding(message.id, reading.promise);

		const running = save();
		reading.resolve(undefined);
		await running;

		expect(mocks.claim).not.toHaveBeenCalled();
		expect(mocks.prepare).not.toHaveBeenCalled();
		expect(mocks.editWithFiles.mock.calls[0][2].attachments).toEqual([{id: 'kept'}]);
		expect(onSaved).toHaveBeenCalledTimes(1);
	});

	it('drops a file that finishes being read after the edit closed', async () => {
		mocks.pending.delete(key);
		const reading = deferred<unknown>();
		InlineEditUploads.trackAdding(message.id, reading.promise);
		mocks.isEditing.mockReturnValue(false);
		mocks.onEditChange?.();

		mocks.pending.set(key, [{id: 1}]);
		reading.resolve(undefined);
		await vi.waitFor(() => expect(mocks.pending.has(key)).toBe(false));
	});

	it('sends the files with the edit when the instance has no presigned uploads', async () => {
		mocks.canPresign.mockReturnValue(false);

		await save();

		expect(mocks.requestPlans).not.toHaveBeenCalled();
		expect(mocks.editWithFiles.mock.calls[0][3]).toEqual([file]);
	});

	it('falls back to sending the files with the edit when asking for upload plans fails', async () => {
		mocks.requestPlans.mockRejectedValue(new Error('unreachable'));

		await save();

		expect(mocks.requestPlans).toHaveBeenCalledTimes(1);
		expect(mocks.uploadViaPlans).not.toHaveBeenCalled();
		expect(mocks.editWithFiles.mock.calls[0][3]).toEqual([file]);
	});

	it('keeps the edit open and the files in it when the edit fails, without retrying', async () => {
		mocks.editWithFiles.mockResolvedValue(false);

		await save();

		expect(mocks.editWithFiles).toHaveBeenCalledTimes(1);
		expect(onSaved).not.toHaveBeenCalled();
		expect(InlineEditUploads.hasFiles(message.id)).toBe(true);
		expect(InlineEditUploads.uploadingCount(message.id)).toBe(0);
	});

	it('shows a failed upload once, and keeps the files', async () => {
		mocks.uploadViaPlans.mockRejectedValue(new Error('storage down'));

		await save();

		expect(mocks.showFailure).toHaveBeenCalledTimes(1);
		expect(mocks.editWithFiles).not.toHaveBeenCalled();
		expect(onSaved).not.toHaveBeenCalled();
		expect(InlineEditUploads.hasFiles(message.id)).toBe(true);
	});

	it('ignores a second save while the first is running', async () => {
		const upload = deferred<Array<unknown>>();
		mocks.uploadViaPlans.mockReturnValue(upload.promise);

		const first = save();
		await save();
		expect(InlineEditUploads.uploadingCount(message.id)).toBe(1);

		upload.resolve(metadata);
		await first;
		expect(mocks.editWithFiles).toHaveBeenCalledTimes(1);
	});

	it('aborts a running upload when the edit is cancelled, without showing a failure', async () => {
		mocks.uploadViaPlans.mockImplementation(
			({signal}: {signal: AbortSignal}) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
				}),
		);

		const running = save();
		await vi.waitFor(() => expect(mocks.uploadViaPlans).toHaveBeenCalled());
		mocks.isEditing.mockReturnValue(false);
		mocks.onEditChange?.();
		await running;

		expect(mocks.showFailure).not.toHaveBeenCalled();
		expect(mocks.editWithFiles).not.toHaveBeenCalled();
		expect(onSaved).not.toHaveBeenCalled();
		expect(InlineEditUploads.hasFiles(message.id)).toBe(false);
	});
});
