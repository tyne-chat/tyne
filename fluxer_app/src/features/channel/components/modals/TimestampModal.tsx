// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import styles from '@app/features/channel/components/modals/TimestampModal.module.css';
import {CANCEL_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Combobox, type ComboboxOption} from '@app/features/ui/components/form/FormCombobox';
import {SearchableTimeZonePicker} from '@app/features/ui/components/form/SearchableTimeZonePicker';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {RadioGroup, type RadioOption} from '@app/features/ui/radio_group/RadioGroup';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import Users from '@app/features/user/state/Users';
import {shouldUse12HourFormat} from '@app/features/user/utils/DateFormatting';
import {getCurrentLocale} from '@app/features/user/utils/LocaleUtils';
import {formatTimestampWithStyle} from '@fluxer/date_utils/src/DateTimestampStyle';
import {isSupportedTimeZoneId} from '@fluxer/date_utils/src/TimeZoneUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {LightningIcon} from '@phosphor-icons/react';
import * as chrono from 'chrono-node';
import {DateTime} from 'luxon';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useId, useMemo, useState} from 'react';

const INSERT_TIMESTAMP_TITLE_DESCRIPTOR = msg({
	message: 'Insert timestamp',
	comment: 'Title of the timestamp insertion modal.',
});
const EDIT_TIMESTAMP_TITLE_DESCRIPTOR = msg({
	message: 'Edit timestamp',
	comment: 'Title of the timestamp modal when editing an existing timestamp.',
});
const NLP_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'e.g. tomorrow at 3pm, in 2 hours, now',
	comment: 'Placeholder text for natural language timestamp input.',
});
const DATE_LABEL_DESCRIPTOR = msg({
	message: 'Date',
	comment: 'Label for date input in timestamp modal.',
});
const TIME_LABEL_DESCRIPTOR = msg({
	message: 'Time',
	comment: 'Label for time input in timestamp modal.',
});
const TIMEZONE_LABEL_DESCRIPTOR = msg({
	message: 'Time zone',
	comment: 'Label for time zone input in timestamp modal.',
});
const FORMAT_PREVIEW_DESCRIPTOR = msg({
	message: 'Format preview',
	comment: 'Label for format preview selection in timestamp modal.',
});
const INSERT_BUTTON_DESCRIPTOR = msg({
	message: 'Insert',
	comment: 'Button to insert timestamp into message composer.',
});

export interface TimestampModalProps {
	initialEpoch?: number;
	initialFormat?: string;
	onInsert: (markdown: string, meta?: {epoch: number; format: string}) => void;
}

function formatRelativePreview(targetEpoch: number, locale: string): string {
	const nowEpoch = Math.floor(Date.now() / 1000);
	const rtf = new Intl.RelativeTimeFormat(locale, {numeric: 'auto'});
	const diffSeconds = targetEpoch - nowEpoch;
	const absSeconds = Math.abs(diffSeconds);
	const direction = diffSeconds >= 0 ? 1 : -1;

	// For very small differences (< 5 seconds), show "now"
	if (absSeconds < 5) {
		return rtf.format(0, 'second');
	}

	if (absSeconds < 60) {
		return rtf.format(direction * absSeconds, 'second');
	}

	const absMinutes = Math.round(absSeconds / 60);
	if (absMinutes < 60) {
		return rtf.format(direction * absMinutes, 'minute');
	}

	const absHours = Math.round(absSeconds / 3600);
	if (absHours < 24) {
		return rtf.format(direction * absHours, 'hour');
	}

	const absDays = Math.round(absSeconds / 86400);
	if (absDays < 7) {
		return rtf.format(direction * absDays, 'day');
	}

	const absWeeks = Math.round(absDays / 7);
	if (absDays < 30) {
		return rtf.format(direction * absWeeks, 'week');
	}

	const absMonths = Math.round(absDays / 30);
	if (absDays < 365) {
		return rtf.format(direction * absMonths, 'month');
	}

	const years = Math.round(absDays / 365);
	return rtf.format(direction * years, 'year');
}

function getTimestampMarkdown(format: string, epoch: number): string {
	switch (format) {
		case 'combo':
			return `<t:${epoch}:f> (<t:${epoch}:R>)`;
		case 'shortTime':
			return `<t:${epoch}:t>`;
		case 'longTime':
			return `<t:${epoch}:T>`;
		case 'shortDate':
			return `<t:${epoch}:d>`;
		case 'longDate':
			return `<t:${epoch}:D>`;
		case 'shortDateTime':
			return `<t:${epoch}:f>`;
		case 'longDateTime':
			return `<t:${epoch}:F>`;
		case 'relative':
			return `<t:${epoch}:R>`;
		default:
			return `<t:${epoch}:f> (<t:${epoch}:R>)`;
	}
}

function useIsCompactLayout(): boolean {
	const checkCompact = useCallback(() => {
		if (typeof window === 'undefined') {
			return false;
		}
		const matchesHeight =
			typeof window.matchMedia === 'function'
				? window.matchMedia('(max-height: 680px)').matches
				: window.innerHeight < 680;
		const matchesWidth =
			typeof window.matchMedia === 'function'
				? window.matchMedia('(max-width: 520px)').matches
				: window.innerWidth < 520;
		return matchesHeight || matchesWidth || MobileLayout.isMobileLayout();
	}, []);

	const [isCompact, setIsCompact] = useState(checkCompact);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const handleResize = () => {
			setIsCompact(checkCompact());
		};
		window.addEventListener('resize', handleResize);
		let heightQuery: MediaQueryList | null = null;
		let widthQuery: MediaQueryList | null = null;
		if (typeof window.matchMedia === 'function') {
			heightQuery = window.matchMedia('(max-height: 680px)');
			widthQuery = window.matchMedia('(max-width: 520px)');
			heightQuery.addEventListener('change', handleResize);
			widthQuery.addEventListener('change', handleResize);
		}
		return () => {
			window.removeEventListener('resize', handleResize);
			heightQuery?.removeEventListener('change', handleResize);
			widthQuery?.removeEventListener('change', handleResize);
		};
	}, [checkCompact]);

	return isCompact;
}

export const TimestampModal = observer(({initialEpoch, initialFormat, onInsert}: TimestampModalProps) => {
	const {i18n} = useLingui();
	const locale = getCurrentLocale();
	const hour12 = shouldUse12HourFormat(locale);
	const dateInputId = useId();
	const timeInputId = useId();

	const currentUser = Users.getCurrentUser();

	const initialTimeZone = useMemo(() => {
		const profileTz = currentUser?.timezone;
		if (profileTz && isSupportedTimeZoneId(profileTz)) {
			return profileTz;
		}
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		} catch {
			return 'UTC';
		}
	}, [currentUser?.timezone]);

	const initialNow = useMemo(() => {
		if (initialEpoch != null && Number.isFinite(initialEpoch)) {
			return DateTime.fromSeconds(initialEpoch).setZone(initialTimeZone);
		}
		return DateTime.now().setZone(initialTimeZone);
	}, [initialEpoch, initialTimeZone]);

	const [nlpInput, setNlpInput] = useState('');
	const [selectedDate, setSelectedDate] = useState(() => initialNow.toFormat('yyyy-MM-dd'));
	const [selectedTime, setSelectedTime] = useState(() => initialNow.toFormat('HH:mm'));
	const [selectedSecond, setSelectedSecond] = useState(() => initialNow.second);
	const [selectedTimeZone, setSelectedTimeZone] = useState(initialTimeZone);
	const [selectedFormat, setSelectedFormat] = useState(() => initialFormat ?? 'combo');
	const isCompact = useIsCompactLayout();

	const handleNlpChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const text = e.target.value;
			setNlpInput(text);
			if (!text.trim()) {
				return;
			}

			try {
				const parsedResults = chrono.parse(text, new Date(), {forwardDate: true});
				if (parsedResults.length > 0) {
					const parsedDate = parsedResults[0].date();
					const dt = DateTime.fromJSDate(parsedDate, {zone: selectedTimeZone});
					if (dt.isValid) {
						setSelectedDate(dt.toFormat('yyyy-MM-dd'));
						setSelectedTime(dt.toFormat('HH:mm'));
						setSelectedSecond(dt.second);
					}
				}
			} catch {
				// Ignore parse errors as user is typing
			}
		},
		[selectedTimeZone],
	);

	const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		setSelectedDate(e.target.value);
		setNlpInput('');
	}, []);

	const handleTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		setSelectedTime(e.target.value);
		setSelectedSecond(0);
		setNlpInput('');
	}, []);

	const handleTimeZoneChange = useCallback((newZone: string) => {
		setSelectedTimeZone(newZone);
		setNlpInput('');
	}, []);

	const targetDateTime = useMemo(() => {
		const iso = `${selectedDate}T${selectedTime}:${String(selectedSecond).padStart(2, '0')}`;
		const parsed = DateTime.fromISO(iso, {zone: selectedTimeZone});
		return parsed.isValid ? parsed : DateTime.now().setZone(selectedTimeZone);
	}, [selectedDate, selectedTime, selectedSecond, selectedTimeZone]);

	const epoch = useMemo(() => {
		return targetDateTime.toUnixInteger();
	}, [targetDateTime]);

	const formatOptions = useMemo<ReadonlyArray<RadioOption<string>>>(() => {
		const shortTime = formatTimestampWithStyle(epoch, 'ShortTime', locale, hour12, selectedTimeZone);
		const longTime = formatTimestampWithStyle(epoch, 'LongTime', locale, hour12, selectedTimeZone);
		const shortDate = formatTimestampWithStyle(epoch, 'ShortDate', locale, hour12, selectedTimeZone);
		const longDate = formatTimestampWithStyle(epoch, 'LongDate', locale, hour12, selectedTimeZone);
		const shortDateTime = formatTimestampWithStyle(epoch, 'ShortDateTime', locale, hour12, selectedTimeZone);
		const longDateTime = formatTimestampWithStyle(epoch, 'LongDateTime', locale, hour12, selectedTimeZone);
		const relative = formatRelativePreview(epoch, locale);

		return [
			{
				value: 'combo',
				name: `${shortDateTime} (${relative})`,
			},
			{
				value: 'shortTime',
				name: shortTime,
			},
			{
				value: 'longTime',
				name: longTime,
			},
			{
				value: 'shortDate',
				name: shortDate,
			},
			{
				value: 'longDate',
				name: longDate,
			},
			{
				value: 'shortDateTime',
				name: shortDateTime,
			},
			{
				value: 'longDateTime',
				name: longDateTime,
			},
			{
				value: 'relative',
				name: relative,
			},
		];
	}, [epoch, locale, hour12, selectedTimeZone]);

	const comboboxFormatOptions = useMemo<ReadonlyArray<ComboboxOption<string>>>(() => {
		return formatOptions.map((opt) => ({
			value: opt.value,
			label: typeof opt.name === 'string' ? opt.name : String(opt.value),
		}));
	}, [formatOptions]);

	const handleFormatChange = useCallback((newFormat: string) => {
		setSelectedFormat(newFormat);
	}, []);

	const handleSubmit = useCallback(
		(e?: React.FormEvent) => {
			if (e) {
				e.preventDefault();
			}
			const markdown = getTimestampMarkdown(selectedFormat, epoch);
			onInsert(markdown, {epoch, format: selectedFormat});
			ModalCommands.pop();
		},
		[selectedFormat, epoch, onInsert],
	);

	const modalTitle =
		initialEpoch != null ? i18n._(EDIT_TIMESTAMP_TITLE_DESCRIPTOR) : i18n._(INSERT_TIMESTAMP_TITLE_DESCRIPTOR);

	return (
		<Modal.Root size="medium" centered className={styles.modalRoot} data-flx="channel.timestamp-modal.modal-root">
			<form onSubmit={handleSubmit} style={{display: 'contents'}} data-flx="channel.timestamp-modal.form">
				<Modal.Header title={modalTitle} data-flx="channel.timestamp-modal.modal-header" />
				<Modal.Content padding="none" className={styles.modalContent} data-flx="channel.timestamp-modal.modal-content">
					<div className={styles.content} data-flx="channel.timestamp-modal.content">
						<div className={styles.nlpContainer} data-flx="channel.timestamp-modal.nlp-container">
							<LightningIcon
								size={18}
								weight="fill"
								className={styles.nlpIcon}
								data-flx="channel.timestamp-modal.nlp-icon"
							/>
							<input
								type="text"
								value={nlpInput}
								onChange={handleNlpChange}
								placeholder={i18n._(NLP_PLACEHOLDER_DESCRIPTOR)}
								className={styles.nlpInput}
								data-flx="channel.timestamp-modal.nlp-input"
							/>
						</div>

						<div className={styles.pickersGrid} data-flx="channel.timestamp-modal.pickers-grid">
							<div className={styles.pickerField} data-flx="channel.timestamp-modal.picker-field.date">
								<label
									htmlFor={dateInputId}
									className={styles.fieldLabel}
									data-flx="channel.timestamp-modal.field-label.date"
								>
									{i18n._(DATE_LABEL_DESCRIPTOR)}
								</label>
								<FocusRing offset={-2} data-flx="channel.timestamp-modal.focus-ring.date">
									<input
										id={dateInputId}
										type="date"
										value={selectedDate}
										onChange={handleDateChange}
										className={styles.nativeInput}
										data-flx="channel.timestamp-modal.native-input.date"
									/>
								</FocusRing>
							</div>

							<div className={styles.pickerField} data-flx="channel.timestamp-modal.picker-field.time">
								<label
									htmlFor={timeInputId}
									className={styles.fieldLabel}
									data-flx="channel.timestamp-modal.field-label.time"
								>
									{i18n._(TIME_LABEL_DESCRIPTOR)}
								</label>
								<FocusRing offset={-2} data-flx="channel.timestamp-modal.focus-ring.time">
									<input
										id={timeInputId}
										type="time"
										value={selectedTime}
										onChange={handleTimeChange}
										className={styles.nativeInput}
										data-flx="channel.timestamp-modal.native-input.time"
									/>
								</FocusRing>
							</div>

							<div className={styles.pickerFieldFull} data-flx="channel.timestamp-modal.picker-field.timezone">
								<span className={styles.fieldLabel} data-flx="channel.timestamp-modal.field-label.timezone">
									{i18n._(TIMEZONE_LABEL_DESCRIPTOR)}
								</span>
								<SearchableTimeZonePicker
									value={selectedTimeZone}
									onChange={(zone) => handleTimeZoneChange(zone || 'UTC')}
									allowClear={false}
									triggerDataFlx="channel.timestamp-modal.timezone-trigger"
									popoutDataFlx="channel.timestamp-modal.timezone-popout-wrapper"
									data-flx="channel.timestamp-modal.searchable-timezone-picker"
								/>
							</div>
						</div>

						<div className={styles.formatSection} data-flx="channel.timestamp-modal.format-section">
							<span className={styles.fieldLabel} data-flx="channel.timestamp-modal.field-label.format">
								{i18n._(FORMAT_PREVIEW_DESCRIPTOR)}
							</span>
							{isCompact ? (
								<Combobox
									value={selectedFormat}
									options={comboboxFormatOptions}
									onChange={handleFormatChange}
									isSearchable={false}
									menuPlacement="auto"
									density="compact"
									data-flx="channel.timestamp-modal.combobox.format"
								/>
							) : (
								<div className={styles.formatList} data-flx="channel.timestamp-modal.format-list">
									<RadioGroup
										value={selectedFormat}
										onChange={setSelectedFormat}
										options={formatOptions}
										className={styles.radioGroup}
										data-flx="channel.timestamp-modal.radio-group.format"
									/>
								</div>
							)}
						</div>
					</div>
				</Modal.Content>
				<Modal.Footer data-flx="channel.timestamp-modal.modal-footer">
					<Button onClick={ModalCommands.pop} variant="secondary" data-flx="channel.timestamp-modal.button.cancel">
						{i18n._(CANCEL_DESCRIPTOR)}
					</Button>
					<Button
						type="submit"
						onClick={handleSubmit}
						variant="primary"
						data-flx="channel.timestamp-modal.button.insert"
					>
						{i18n._(INSERT_BUTTON_DESCRIPTOR)}
					</Button>
				</Modal.Footer>
			</form>
		</Modal.Root>
	);
});

TimestampModal.displayName = 'TimestampModal';

export function openTimestampModal(props: TimestampModalProps): void {
	ModalCommands.push(
		ModalCommands.modal(() => <TimestampModal {...props} data-flx="channel.timestamp-modal.open.timestamp-modal" />),
	);
}
