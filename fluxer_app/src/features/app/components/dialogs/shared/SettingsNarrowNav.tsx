// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: settings in a narrow window (tyne-chat/tyne#232). Upstream shows the list of sections beside
// the open one and leaves narrow windows to the mobile layout, which a computer never gets in Tyne.
// A narrow settings dialog shows one of the two at a time: the open section, whose header gains a
// "Settings" button that brings up the list, or the list, where choosing a section or subsection
// opens it. The list is the desktop one, with its search, the Keybinds tab and the subsection trees.
// Wider, nothing changes.

import styles from '@app/features/app/components/dialogs/shared/SettingsNarrowNav.module.css';
import {CLOSE_DESCRIPTOR, SETTINGS_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {useLingui} from '@lingui/react/macro';
import {CaretLeftIcon, XIcon} from '@phosphor-icons/react';
import type React from 'react';
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';

type SettingsNarrowView = 'section' | 'list';

interface SettingsNarrowNavValue {
	showList: () => void;
	setClose: (close: () => void) => void;
}

const SettingsNarrowNavContext = createContext<SettingsNarrowNavValue | null>(null);

const isShown = (element: Element): boolean => element.checkVisibility({visibilityProperty: true});

// The dialog's width in rem, so that app zoom counts, decides. Each switch has two marks: the dialog
// turns narrow below the first and wide again above the second, and in between keeps its layout. A
// single line made it flip back and forth while a window was resized across it, because upstream
// widens the dialog's margins at 768 px and other window widths, so the dialog narrows there as the
// window widens. (In the desktop app, upstream's useModalResizePin also lets the dialog take those
// margins while a window is being resized; the band is wider than that at 100% zoom.)
const NARROW_BELOW_REM = 42;
const WIDE_ABOVE_REM = 47;
// Narrower still, the "Settings" button keeps its arrow only.
const TIGHT_BELOW_REM = 25;
const ROOMY_ABOVE_REM = 27;

// Wraps the sidebar and the open section of a settings dialog.
export const SettingsNarrowNav: React.FC<{children: React.ReactNode}> = ({children}) => {
	const {i18n} = useLingui();
	const [view, setView] = useState<SettingsNarrowView>('section');
	const [narrow, setNarrow] = useState(false);
	const [tight, setTight] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const remProbeRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<(() => void) | null>(null);
	const movedRef = useRef(false);
	const show = useCallback((next: SettingsNarrowView) => {
		movedRef.current = true;
		setView(next);
	}, []);
	// The probe is 1rem wide, so it reports zoom changes, which need not change the dialog's px width.
	useLayoutEffect(() => {
		const root = rootRef.current;
		const probe = remProbeRef.current;
		if (root == null || probe == null) return;
		const measure = () => {
			const remPx = probe.getBoundingClientRect().width;
			if (remPx <= 0) return;
			const rem = root.getBoundingClientRect().width / remPx;
			setNarrow((was) => (was ? rem < WIDE_ABOVE_REM : rem < NARROW_BELOW_REM));
			setTight((was) => (was ? rem < ROOMY_ABOVE_REM : rem < TIGHT_BELOW_REM));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		observer.observe(probe);
		return () => observer.disconnect();
	}, []);
	// Wide again, the dialog shows the open section beside the list; narrowed later, it starts there.
	useEffect(() => {
		if (!narrow) setView('section');
	}, [narrow]);
	// Focus left on something the switch hid goes to what took its place: the open section's entry in
	// the list, or the open section.
	useLayoutEffect(() => {
		if (!movedRef.current) return;
		movedRef.current = false;
		const root = rootRef.current;
		const active = document.activeElement;
		if (root == null || (active != null && root.contains(active) && isShown(active))) return;
		const next =
			view === 'list'
				? (root.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ??
					root.querySelector<HTMLElement>('[role="treeitem"]'))
				: root.querySelector<HTMLElement>('[role="region"]');
		next?.focus();
	}, [view]);
	// In the list, a click on a section, a subsection or another action in the sidebar opens the
	// section, but not a click in the search. Arrow keys still move through the list without leaving
	// it, and still fold and unfold subsections.
	const handleClickCapture = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (view !== 'list' || !(event.target instanceof Element)) return;
			const button = event.target.closest('button');
			if (button == null || button.closest('[role="region"], [role="search"], [data-settings-narrow-list-header]')) {
				return;
			}
			// The open section's own entry would fold its subsections, which leaves the list looking
			// unchanged; here it goes back to the section, with the subsections still listed.
			if (button.getAttribute('aria-selected') === 'true' && button.hasAttribute('aria-expanded')) {
				event.stopPropagation();
			}
			show('section');
		},
		[show, view],
	);
	// Enter in the search shows the matching settings, which appear where the section does.
	const handleKeyDownCapture = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (view !== 'list' || event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
			if (event.target.closest('[role="search"]')) show('section');
		},
		[show, view],
	);
	const value = useMemo<SettingsNarrowNavValue>(
		() => ({
			showList: () => show('list'),
			setClose: (close) => {
				closeRef.current = close;
			},
		}),
		[show],
	);
	return (
		<SettingsNarrowNavContext.Provider value={value}>
			<div
				ref={rootRef}
				className={styles.root}
				data-settings-narrow={narrow || undefined}
				data-settings-tight={tight || undefined}
				data-settings-narrow-view={view}
				onClickCapture={handleClickCapture}
				onKeyDownCapture={handleKeyDownCapture}
				data-flx="app.settings-narrow-nav.root"
			>
				<div
					className={styles.listHeader}
					data-settings-narrow-list-header
					data-flx="app.settings-narrow-nav.list-header"
				>
					<h1 className={styles.listTitle} data-flx="app.settings-narrow-nav.list-title">
						{i18n._(SETTINGS_DESCRIPTOR)}
					</h1>
					<button
						type="button"
						aria-label={i18n._(CLOSE_DESCRIPTOR)}
						onClick={() => closeRef.current?.()}
						className={styles.closeButton}
						data-flx="app.settings-narrow-nav.close-button.current"
					>
						<XIcon weight="bold" className={styles.closeIcon} data-flx="app.settings-narrow-nav.close-icon" />
					</button>
				</div>
				<div ref={remProbeRef} className={styles.remProbe} aria-hidden data-flx="app.settings-narrow-nav.rem-probe" />
				{children}
			</div>
		</SettingsNarrowNavContext.Provider>
	);
};

// The "Settings" button at the start of the open section's header, shown in a narrow dialog. It
// also hands the header's close action to the list's own close button.
export const SettingsNarrowNavButton: React.FC<{onClose: () => void}> = ({onClose}) => {
	const {i18n} = useLingui();
	const nav = useContext(SettingsNarrowNavContext);
	useEffect(() => {
		nav?.setClose(onClose);
	}, [nav, onClose]);
	if (nav == null) return null;
	return (
		<button
			type="button"
			onClick={nav.showList}
			className={styles.backButton}
			data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-button.show-list"
		>
			<CaretLeftIcon
				weight="bold"
				className={styles.backIcon}
				data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-icon"
			/>
			<span className={styles.backLabel} data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-label">
				{i18n._(SETTINGS_DESCRIPTOR)}
			</span>
		</button>
	);
};
