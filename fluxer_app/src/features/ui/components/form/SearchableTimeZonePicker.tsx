// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from '@app/features/ui/components/form/SearchableTimeZonePicker.module.css';
import {usePortalHost} from '@app/features/ui/overlay/PortalHostContext';
import {
	SearchableListPopout,
	type SearchableListPopoutItem,
	type SearchableListPopoutSection,
} from '@app/features/ui/popover/searchable_list_popout/SearchableListPopout';
import LayerManager from '@app/features/ui/state/LayerManager';
import {
	autoUpdate,
	FloatingFocusManager,
	FloatingPortal,
	flip,
	offset,
	shift,
	size,
	useClick,
	useDismiss,
	useFloating,
	useInteractions,
	useRole,
} from '@floating-ui/react';
import {getTimeZoneDisplayOptions} from '@fluxer/date_utils/src/TimeZoneUtils';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretDownIcon, CheckIcon, GlobeIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useId, useMemo, useState} from 'react';

const SEARCH_TIMEZONES_DESCRIPTOR = msg({
	message: 'Search time zones',
	comment: 'Placeholder in timezone combobox.',
});
const SUGGESTED_TIMEZONES_DESCRIPTOR = msg({
	message: 'Suggested',
	comment: 'Section header for suggested time zones in the timestamp modal.',
});
const ALL_TIMEZONES_DESCRIPTOR = msg({
	message: 'All time zones',
	comment: 'Section header for all time zones in the timestamp modal.',
});
const NO_RESULTS_FOUND_DESCRIPTOR = msg({
	message: 'No results found',
	comment: 'Empty state shown when a combobox search returns no matches.',
});
const NOT_SET_DESCRIPTOR = msg({
	message: 'Not set',
	comment: 'Option in the profile timezone picker. Means no timezone has been selected.',
});

interface TimeZoneOptionData {
	readonly value: string;
	readonly label: string;
	readonly searchText: string;
}

export interface SearchableTimeZonePickerProps {
	readonly value: string | null;
	readonly onChange: (timeZone: string | null) => void;
	readonly disabled?: boolean;
	readonly label?: React.ReactNode;
	readonly description?: React.ReactNode;
	readonly placeholder?: string;
	readonly allowClear?: boolean;
	readonly notSetLabel?: string;
	readonly className?: string;
	readonly 'data-flx'?: string;
	readonly triggerDataFlx?: string;
	readonly popoutDataFlx?: string;
}

export const SearchableTimeZonePicker: React.FC<SearchableTimeZonePickerProps> = observer(
	function SearchableTimeZonePicker({
		value,
		onChange,
		disabled = false,
		label,
		description,
		placeholder,
		allowClear = false,
		notSetLabel,
		className,
		'data-flx': dataFlx,
		triggerDataFlx,
		popoutDataFlx,
	}) {
		const {i18n} = useLingui();
		const [isOpen, setIsOpen] = useState(false);
		const popoutKey = useId();
		const portalHost = usePortalHost();

		const initialTimeZone = useMemo(() => {
			try {
				return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
			} catch {
				return 'UTC';
			}
		}, []);

		const timeZoneOptions = useMemo<ReadonlyArray<TimeZoneOptionData>>(
			() =>
				getTimeZoneDisplayOptions().map((opt) => ({
					value: opt.value,
					label: opt.label,
					searchText: opt.searchText,
				})),
			[],
		);

		const notSetText = notSetLabel ?? i18n._(NOT_SET_DESCRIPTOR);

		const currentLabel = useMemo(() => {
			if (!value) {
				return allowClear ? notSetText : initialTimeZone;
			}
			const directMatch = timeZoneOptions.find((opt) => opt.value === value);
			if (directMatch) {
				return directMatch.label;
			}
			return value;
		}, [value, allowClear, notSetText, initialTimeZone, timeZoneOptions]);

		const {refs, floatingStyles, context} = useFloating({
			open: isOpen,
			onOpenChange: setIsOpen,
			placement: 'bottom-start',
			whileElementsMounted: autoUpdate,
			middleware: [
				offset(4),
				flip({fallbackPlacements: ['top-start']}),
				shift({padding: 8}),
				size({
					apply({rects, elements}) {
						const width = Math.min(window.innerWidth - 32, Math.max(rects.reference.width, 280));
						Object.assign(elements.floating.style, {
							width: `${width}px`,
						});
					},
					padding: 8,
				}),
			],
		});

		const {getReferenceProps, getFloatingProps} = useInteractions([
			useClick(context),
			useDismiss(context, {escapeKey: false}),
			useRole(context, {role: 'listbox'}),
		]);

		useEffect(() => {
			const key = `searchable-timezone-picker-${popoutKey}`;
			if (isOpen) {
				LayerManager.addLayer('popout', key, () => setIsOpen(false));
			}
			return () => {
				LayerManager.removeLayer('popout', key);
			};
		}, [isOpen, popoutKey]);

		const handleSelect = useCallback(
			(nextZone: string | null) => {
				onChange(nextZone);
				setIsOpen(false);
			},
			[onChange],
		);

		const localOption = useMemo(() => {
			return timeZoneOptions.find(
				(opt) => opt.value === initialTimeZone || opt.searchText.toLowerCase().includes(initialTimeZone.toLowerCase()),
			);
		}, [timeZoneOptions, initialTimeZone]);

		const utcOption = useMemo(() => {
			return timeZoneOptions.find((opt) => opt.value === 'UTC');
		}, [timeZoneOptions]);

		const suggestedItems = useMemo<Array<SearchableListPopoutItem>>(() => {
			const items: Array<SearchableListPopoutItem> = [];
			if (allowClear) {
				items.push({
					id: 'clear-timezone',
					ariaLabel: notSetText,
					searchValues: [notSetText, 'not set', 'clear', 'none'],
					isSelected: !value,
					onSelect: () => handleSelect(null),
					render: ({isSelected}) => (
						<div className={styles.optionItem} data-flx="ui.searchable-timezone-picker.not-set-item">
							<span
								className={styles.optionLabel}
								data-flx="ui.form.searchable-time-zone-picker.suggested-items.option-label"
							>
								{notSetText}
							</span>
							{isSelected && (
								<CheckIcon
									size={16}
									weight="bold"
									className={styles.checkIcon}
									data-flx="ui.form.searchable-time-zone-picker.suggested-items.check-icon"
								/>
							)}
						</div>
					),
				});
			}
			if (localOption) {
				items.push({
					id: `suggested-${localOption.value}`,
					ariaLabel: localOption.label,
					searchValues: [localOption.label, localOption.value, localOption.searchText],
					isSelected: value === localOption.value,
					onSelect: () => handleSelect(localOption.value),
					render: ({isSelected}) => (
						<div className={styles.optionItem} data-flx="ui.searchable-timezone-picker.suggested-item">
							<span
								className={styles.optionLabel}
								data-flx="ui.form.searchable-time-zone-picker.suggested-items.option-label--2"
							>
								{localOption.label}
							</span>
							{isSelected && (
								<CheckIcon
									size={16}
									weight="bold"
									className={styles.checkIcon}
									data-flx="ui.form.searchable-time-zone-picker.suggested-items.check-icon--2"
								/>
							)}
						</div>
					),
				});
			}
			if (utcOption && utcOption.value !== localOption?.value) {
				items.push({
					id: `suggested-${utcOption.value}`,
					ariaLabel: utcOption.label,
					searchValues: [utcOption.label, utcOption.value, utcOption.searchText],
					isSelected: value === utcOption.value,
					onSelect: () => handleSelect(utcOption.value),
					render: ({isSelected}) => (
						<div className={styles.optionItem} data-flx="ui.searchable-timezone-picker.suggested-utc-item">
							<span
								className={styles.optionLabel}
								data-flx="ui.form.searchable-time-zone-picker.suggested-items.option-label--3"
							>
								{utcOption.label}
							</span>
							{isSelected && (
								<CheckIcon
									size={16}
									weight="bold"
									className={styles.checkIcon}
									data-flx="ui.form.searchable-time-zone-picker.suggested-items.check-icon--3"
								/>
							)}
						</div>
					),
				});
			}
			return items;
		}, [allowClear, notSetText, localOption, utcOption, value, handleSelect]);

		const allItems = useMemo<Array<SearchableListPopoutItem>>(() => {
			return timeZoneOptions.map((opt) => ({
				id: `all-${opt.value}`,
				ariaLabel: opt.label,
				searchValues: [opt.label, opt.value, opt.searchText],
				isSelected: value === opt.value,
				onSelect: () => handleSelect(opt.value),
				render: ({isSelected}) => (
					<div className={styles.optionItem} data-flx="ui.searchable-timezone-picker.timezone-item">
						<span className={styles.optionLabel} data-flx="ui.form.searchable-time-zone-picker.all-items.option-label">
							{opt.label}
						</span>
						{isSelected && (
							<CheckIcon
								size={16}
								weight="bold"
								className={styles.checkIcon}
								data-flx="ui.form.searchable-time-zone-picker.all-items.check-icon"
							/>
						)}
					</div>
				),
			}));
		}, [timeZoneOptions, value, handleSelect]);

		const sections = useMemo<Array<SearchableListPopoutSection>>(() => {
			const res: Array<SearchableListPopoutSection> = [];
			if (suggestedItems.length > 0) {
				res.push({
					id: 'suggested',
					heading: i18n._(SUGGESTED_TIMEZONES_DESCRIPTOR),
					items: suggestedItems,
					showOnlyWhenEmpty: true,
				});
			}
			res.push({
				id: 'all',
				heading: i18n._(ALL_TIMEZONES_DESCRIPTOR),
				items: allItems,
			});
			return res;
		}, [i18n.locale, suggestedItems, allItems]);

		return (
			<div className={clsx(styles.container, className)} data-flx={dataFlx}>
				{label && (
					<span className={styles.label} data-flx="ui.form.searchable-time-zone-picker.label">
						{label}
					</span>
				)}
				{description && (
					<span className={styles.description} data-flx="ui.form.searchable-time-zone-picker.description">
						{description}
					</span>
				)}
				<button
					ref={refs.setReference}
					type="button"
					disabled={disabled}
					className={styles.trigger}
					aria-expanded={isOpen}
					aria-haspopup="listbox"
					data-flx={triggerDataFlx ?? 'ui.searchable-timezone-picker.trigger'}
					{...getReferenceProps()}
				>
					<GlobeIcon size={18} className={styles.globeIcon} data-flx="ui.searchable-timezone-picker.globe-icon" />
					<span className={styles.triggerLabel} data-flx="ui.searchable-timezone-picker.trigger-label">
						{currentLabel}
					</span>
					<CaretDownIcon size={14} className={styles.caret} data-flx="ui.searchable-timezone-picker.caret" />
				</button>
				{isOpen && (
					<FloatingPortal root={portalHost ?? undefined} data-flx="ui.form.searchable-time-zone-picker.floating-portal">
						<FloatingFocusManager
							context={context}
							modal={false}
							initialFocus={-1}
							data-flx="ui.form.searchable-time-zone-picker.floating-focus-manager"
						>
							<div
								ref={refs.setFloating}
								style={{
									...floatingStyles,
									zIndex: 99999,
								}}
								{...getFloatingProps()}
								data-flx={popoutDataFlx ?? 'ui.searchable-timezone-picker.popout-wrapper'}
							>
								<SearchableListPopout
									className={styles.popout}
									scrollerClassName={styles.scroller}
									placeholder={placeholder ?? i18n._(SEARCH_TIMEZONES_DESCRIPTOR)}
									searchInputAriaLabel={placeholder ?? i18n._(SEARCH_TIMEZONES_DESCRIPTOR)}
									listAriaLabel={i18n._(SEARCH_TIMEZONES_DESCRIPTOR)}
									noResultsLabel={i18n._(NO_RESULTS_FOUND_DESCRIPTOR)}
									sections={sections}
									onRequestClose={() => setIsOpen(false)}
									data-flx="ui.form.searchable-time-zone-picker.popout"
								/>
							</div>
						</FloatingFocusManager>
					</FloatingPortal>
				)}
			</div>
		);
	},
);

SearchableTimeZonePicker.displayName = 'SearchableTimeZonePicker';
