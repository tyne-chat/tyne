// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import {useInlineEditFilePaste} from '@app/features/channel/components/InlineEditFiles';
import type {Channel} from '@app/features/channel/models/Channel';
import type {LexicalRichInputHandle} from '@app/features/lexical/composer/LexicalRichInput';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {act, useRef} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
	handleFileUpload: vi.fn(),
	readClipboardImageFiles: vi.fn(),
	isPlainPasteEvent: vi.fn(),
	canAttach: vi.fn(),
	denied: vi.fn(),
	trackAdding: vi.fn(),
	pending: [] as Array<unknown>,
}));

vi.mock('@app/features/app/utils/UserLimits', () => ({Limits: {getMaxAttachmentsPerMessage: () => 10}}));
vi.mock('@app/features/messaging/components/alerts/AttachmentPermissionDeniedModal', () => ({
	showAttachmentPermissionDeniedModal: mocks.denied,
}));
vi.mock('@app/features/messaging/components/alerts/FileSizeTooLargeModal', () => ({FileSizeTooLargeModal: () => null}));
vi.mock('@app/features/messaging/components/alerts/TooManyAttachmentsModal', () => ({
	TooManyAttachmentsModal: () => null,
}));
vi.mock('@app/features/messaging/state/InlineEditUploads', () => ({
	default: {attachmentKey: (id: string) => `inline-edit:${id}`, trackAdding: mocks.trackAdding},
}));
vi.mock('@app/features/messaging/upload/CloudUpload', () => ({
	CloudUpload: {getTextareaAttachments: () => mocks.pending},
}));
vi.mock('@app/features/messaging/utils/AttachmentPermissionUtils', () => ({canAttachFilesInChannel: mocks.canAttach}));
vi.mock('@app/features/messaging/utils/ClipboardFilePasteUtils', () => ({
	getClipboardDataFiles: (data: {files: Array<File>}) => data.files,
	readClipboardImageFiles: mocks.readClipboardImageFiles,
}));
vi.mock('@app/features/messaging/utils/FileUploadUtils', () => ({handleFileUpload: mocks.handleFileUpload}));
vi.mock('@app/features/messaging/utils/PlainPasteUtils', () => ({isPlainPasteEvent: mocks.isPlainPasteEvent}));
vi.mock('@app/features/ui/commands/ModalCommands', () => ({push: vi.fn(), modal: vi.fn()}));

const channel = {id: 'channel-1'} as Channel;
const message = {id: 'message-1', attachments: [{id: 'existing'}]} as unknown as Message;
const screenshot = new File(['x'], 'screenshot.png', {type: 'image/png'});

function pasteEvent(data: {files?: Array<File>; text?: string}): ClipboardEvent {
	const event = new ClipboardEvent('paste', {cancelable: true});
	Object.defineProperty(event, 'clipboardData', {
		value: {files: data.files ?? [], getData: () => data.text ?? ''},
	});
	return event;
}

function Host({editor, disabled = false}: {editor: unknown; disabled?: boolean}) {
	const composerRef = useRef({getEditor: () => editor} as unknown as LexicalRichInputHandle);
	useInlineEditFilePaste({channel, message, disabled, composerRef});
	return null;
}

describe('useInlineEditFilePaste', () => {
	let root: Root;
	let paste: ((event: unknown) => boolean) | undefined;
	const unregister = vi.fn();
	const editor = {
		registerCommand: (_command: unknown, listener: (event: unknown) => boolean) => {
			paste = listener;
			return unregister;
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		paste = undefined;
		root = createRoot(document.createElement('div'));
		mocks.pending = [];
		mocks.canAttach.mockReturnValue(true);
		mocks.isPlainPasteEvent.mockReturnValue(false);
		mocks.handleFileUpload.mockResolvedValue({success: true});
		mocks.readClipboardImageFiles.mockResolvedValue([]);
		act(() => root.render(<Host editor={editor} data-flx="channel.inline-edit-files-test.host" />));
	});

	afterEach(() => {
		act(() => root.unmount());
	});

	it('adds a pasted file to the edit, counting the files it already has', async () => {
		mocks.pending = [{id: 1}];
		const event = pasteEvent({files: [screenshot]});

		expect(paste?.(event)).toBe(true);

		expect(event.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(mocks.handleFileUpload).toHaveBeenCalledTimes(1));
		expect(mocks.handleFileUpload).toHaveBeenCalledWith('channel-1', [screenshot], 2, 10, 'inline-edit:message-1');
		expect(mocks.trackAdding).toHaveBeenCalledTimes(1);
	});

	it('takes the file when the clipboard holds text as well', () => {
		expect(paste?.(pasteEvent({files: [screenshot], text: 'caption'}))).toBe(true);
	});

	it('leaves plain text to the editor', () => {
		const event = pasteEvent({text: 'just words'});

		expect(paste?.(event)).toBe(false);

		expect(event.defaultPrevented).toBe(false);
		expect(mocks.readClipboardImageFiles).not.toHaveBeenCalled();
		expect(mocks.handleFileUpload).not.toHaveBeenCalled();
	});

	it('does not take a file on a plain paste', () => {
		mocks.isPlainPasteEvent.mockReturnValue(true);

		expect(paste?.(pasteEvent({files: [screenshot]}))).toBe(false);

		expect(mocks.handleFileUpload).not.toHaveBeenCalled();
	});

	it('reads the clipboard for an image when the paste carries neither files nor text', async () => {
		mocks.readClipboardImageFiles.mockResolvedValue([screenshot]);

		expect(paste?.(pasteEvent({}))).toBe(false);

		await vi.waitFor(() => expect(mocks.handleFileUpload).toHaveBeenCalledTimes(1));
	});

	it('tracks the clipboard read, so Enter straight after it waits for the file', async () => {
		mocks.readClipboardImageFiles.mockResolvedValue([]);

		paste?.(pasteEvent({}));

		expect(mocks.trackAdding).toHaveBeenCalledTimes(1);
	});

	it('refuses a file where the channel forbids it', async () => {
		mocks.canAttach.mockReturnValue(false);

		paste?.(pasteEvent({files: [screenshot]}));

		await vi.waitFor(() => expect(mocks.denied).toHaveBeenCalledTimes(1));
		expect(mocks.handleFileUpload).not.toHaveBeenCalled();
	});

	it('registers nothing while editing is disabled', () => {
		paste = undefined;
		act(() => root.render(<Host editor={editor} disabled={true} data-flx="channel.inline-edit-files-test.host--2" />));

		expect(paste).toBeUndefined();
		expect(unregister).toHaveBeenCalledTimes(1);
	});
});
