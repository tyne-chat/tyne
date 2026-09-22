// SPDX-License-Identifier: AGPL-3.0-or-later

import {openTimestampModal} from '@app/features/channel/components/modals/TimestampModal';
import {ComposerTimestampContextMenu} from '@app/features/lexical/composer/nodes/ComposerTimestampContextMenu';
import styles from '@app/features/lexical/composer/nodes/ComposerTimestampPill.module.css';
import {
	type ComposerTimestampFormat,
	getTimestampDisplay,
	normalizeTimestampFormat,
} from '@app/features/lexical/composer/nodes/ComposerTimestampUtils';
import {getDateFromUnixTimestampSeconds} from '@app/features/messaging/utils/markdown/TimestampValidation';
import timestampRendererStyles from '@app/features/theme/styles/TimestampRenderer.module.css';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import Tick from '@app/features/ui/state/Tick';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {getCurrentLocale} from '@app/features/user/utils/LocaleUtils';
import {getFormattedDateTimeWithSeconds} from '@fluxer/date_utils/src/DateFormatting';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {$getNodeByKey, type NodeKey} from 'lexical';
import {DateTime} from 'luxon';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useMemo} from 'react';
import {$isComposerTimestampNode} from './ComposerTimestampNode';

const DOUBLE_CLICK_TO_EDIT_DESCRIPTOR = msg({
	message: 'Double-click to edit',
	comment: 'Tooltip hint on timestamp pill in message composer.',
});

export interface ComposerTimestampPillProps {
	nodeKey: NodeKey;
	epoch: number;
	format: ComposerTimestampFormat;
	wire: string;
	'data-flx'?: string;
}

export const ComposerTimestampPill = observer(function ComposerTimestampPill({
	nodeKey,
	epoch,
	format,
	wire,
	'data-flx': dataFlx,
}: ComposerTimestampPillProps) {
	const [editor] = useLexicalComposerContext();
	const {i18n} = useLingui();
	const locale = getCurrentLocale();
	const date = getDateFromUnixTimestampSeconds(epoch);
	const isValid = date !== null;

	const isRelative = format === 'relative' || format === 'combo';
	const _tick = isRelative ? Tick.nowSecond : 0;

	const fullDateTime = isValid ? getFormattedDateTimeWithSeconds(date, locale) : null;
	const relativeTime = isValid ? DateTime.fromJSDate(date).setLocale(locale).toRelative() : null;

	const displayTime = useMemo(() => {
		return getTimestampDisplay(epoch, format, i18n);
	}, [epoch, format, i18n, _tick]);

	const handleOpenEdit = useCallback(() => {
		openTimestampModal({
			initialEpoch: epoch,
			initialFormat: format,
			onInsert: (_markdown, meta) => {
				if (meta) {
					editor.update(() => {
						const node = $getNodeByKey(nodeKey);
						if ($isComposerTimestampNode(node)) {
							node.setEpoch(meta.epoch);
							node.setFormat(normalizeTimestampFormat(meta.format));
						}
					});
				}
			},
		});
	}, [editor, epoch, format, nodeKey]);

	const handleContextMenu = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			ContextMenuCommands.openFromEvent(event, ({onClose}) => (
				<ComposerTimestampContextMenu
					onClose={onClose}
					wire={wire}
					onEdit={handleOpenEdit}
					onDelete={() => {
						editor.update(() => {
							const node = $getNodeByKey(nodeKey);
							if (node != null) {
								node.remove();
							}
						});
					}}
					data-flx="lexical.composer.nodes.composer-timestamp-pill.handle-context-menu.composer-timestamp-context-menu"
				/>
			));
		},
		[editor, handleOpenEdit, nodeKey, wire],
	);

	if (!isValid || fullDateTime === null) {
		return (
			<span
				className={styles.timestamp}
				contentEditable={false}
				data-lexical-composer-timestamp-pill="true"
				data-flx={dataFlx}
			>
				{String(epoch)}
			</span>
		);
	}

	const tooltipContent = (
		<div
			className={timestampRendererStyles.tooltipContainer}
			data-flx="lexical.composer.nodes.composer-timestamp-pill.div"
		>
			<div
				className={timestampRendererStyles.tooltipFullDateTime}
				data-flx="lexical.composer.nodes.composer-timestamp-pill.div--2"
			>
				{fullDateTime}
			</div>
			{relativeTime != null && (
				<div
					className={timestampRendererStyles.tooltipRelativeTime}
					data-flx="lexical.composer.nodes.composer-timestamp-pill.div--3"
				>
					{relativeTime}
				</div>
			)}
			<div className={styles.tooltipHint} data-flx="lexical.composer.nodes.composer-timestamp-pill.tooltip-hint">
				{i18n._(DOUBLE_CLICK_TO_EDIT_DESCRIPTOR)}
			</div>
		</div>
	);

	return (
		<Tooltip
			text={() => tooltipContent}
			position="top"
			delay={200}
			maxWidth="xl"
			data-flx="lexical.composer.nodes.composer-timestamp-pill.tooltip"
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcuts on a token inside the editable composer, which cannot take focus there; it is deleted and retyped like any other text. */}
			<span
				className={styles.timestamp}
				contentEditable={false}
				onDoubleClick={handleOpenEdit}
				onContextMenu={handleContextMenu}
				data-lexical-composer-timestamp-pill="true"
				data-flx={dataFlx}
			>
				{displayTime}
			</span>
		</Tooltip>
	);
});
