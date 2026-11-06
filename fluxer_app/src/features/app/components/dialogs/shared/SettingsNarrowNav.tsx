// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: settings in a narrow window (tyne-chat/tyne#232). Upstream shows the list of sections beside
// the open one and leaves narrow windows to the mobile layout, which a computer never gets in Tyne.
// A narrow settings dialog shows one of the two at a time: the open section, whose header gains a
// "Settings" button that brings up the list, or the list, where choosing a section or subsection
// opens it. The list is the desktop one, with its search, the Keybinds tab and the subsection trees.
// Wider, nothing changes.

import styles from '@app/features/app/components/dialogs/shared/SettingsNarrowNav.module.css';
import {CLOSE_DESCRIPTOR, SETTINGS_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretLeftIcon, XIcon} from '@phosphor-icons/react';
import type React from 'react';
import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';

type SettingsNarrowView = 'section' | 'list';

// A level below a section, such as one permission override's editor under Permissions: while a
// section shows one, the header's back button goes up to the section and the title ends with it.
export interface SettingsNarrowSubLevel {
	title: string;
	back: () => void;
}

interface SettingsNarrowNavValue {
	narrow: boolean;
	subLevel: SettingsNarrowSubLevel | null;
	setSubLevel: (level: SettingsNarrowSubLevel | null) => void;
	startOnList: () => void;
	showList: () => void;
	setClose: (close: () => void) => void;
}

const BACK_TO_SECTION_DESCRIPTOR = msg({
	message: 'Back to {section}',
	comment:
		'Accessible label of the arrow-only back button in a narrow settings dialog, shown while one permission override is open. {section} is the settings section it returns to, such as "Permissions".',
});

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
	const [subLevel, setSubLevel] = useState<SettingsNarrowSubLevel | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const remProbeRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<(() => void) | null>(null);
	const movedRef = useRef(false);
	const show = useCallback((next: SettingsNarrowView) => {
		movedRef.current = true;
		setView(next);
	}, []);
	// Null until the first measurement, which decides how a dialog opens.
	const narrowRef = useRef<boolean | null>(null);
	// Set by SettingsNarrowStartOnList, whose layout effect runs before this component's.
	const startOnListRef = useRef(false);
	// The probe is 1rem wide, so it reports zoom changes, which need not change the dialog's px width.
	// A dialog that opens narrow with no section asked for starts on the list; wide again, the dialog
	// shows the open section beside the list, and narrowed later it starts there.
	useLayoutEffect(() => {
		const root = rootRef.current;
		const probe = remProbeRef.current;
		if (root == null || probe == null) return;
		const measure = () => {
			const remPx = probe.getBoundingClientRect().width;
			if (remPx <= 0) return;
			const rem = root.getBoundingClientRect().width / remPx;
			const was = narrowRef.current;
			const now = was ? rem < WIDE_ABOVE_REM : rem < NARROW_BELOW_REM;
			if (was == null && now && startOnListRef.current) setView('list');
			if (!now) setView('section');
			narrowRef.current = now;
			setNarrow(now);
			setTight((tightWas) => (tightWas ? rem < ROOMY_ABOVE_REM : rem < TIGHT_BELOW_REM));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		observer.observe(probe);
		return () => observer.disconnect();
	}, []);
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
			narrow,
			subLevel,
			setSubLevel,
			startOnList: () => {
				startOnListRef.current = true;
			},
			showList: () => show('list'),
			setClose: (close) => {
				closeRef.current = close;
			},
		}),
		[narrow, subLevel, show],
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

// Put inside a settings dialog opened with no section asked for: when it opens narrow, it starts on
// the list of sections instead of the first section.
export const SettingsNarrowStartOnList: React.FC = () => {
	const startOnList = useContext(SettingsNarrowNavContext)?.startOnList;
	useLayoutEffect(() => {
		startOnList?.();
	}, [startOnList]);
	return null;
};

// Whether the settings dialog is narrow, for a section that lays itself out differently then.
export function useSettingsNarrow(): boolean {
	return useContext(SettingsNarrowNavContext)?.narrow ?? false;
}

// Shows a level below the open section while `level` is set (pass null otherwise).
export function useSettingsNarrowSubLevel(level: SettingsNarrowSubLevel | null): void {
	const setSubLevel = useContext(SettingsNarrowNavContext)?.setSubLevel;
	const title = level?.title;
	const back = level?.back;
	useEffect(() => {
		if (setSubLevel == null || title == null || back == null) return;
		setSubLevel({title, back});
		return () => setSubLevel(null);
	}, [setSubLevel, title, back]);
}

// The open section's title, ending with the level below it when a section shows one:
// "Permissions › @everyone".
export const SettingsNarrowTitle: React.FC<{title: React.ReactNode}> = ({title}) => {
	const subLevel = useContext(SettingsNarrowNavContext)?.subLevel;
	if (subLevel == null) return <>{title}</>;
	return (
		<>
			{title}
			<span className={styles.crumbSeparator} aria-hidden data-flx="app.settings-narrow-nav.crumb-separator">
				{' › '}
			</span>
			{subLevel.title}
		</>
	);
};

// The back button at the start of the open section's header, shown in a narrow dialog: "Settings",
// which brings up the list, or the section's title while it shows a level below it, which goes back
// up to the section. It also hands the header's close action to the list's own close button.
export const SettingsNarrowNavButton: React.FC<{onClose: () => void; title?: React.ReactNode}> = ({onClose, title}) => {
	const {i18n} = useLingui();
	const nav = useContext(SettingsNarrowNavContext);
	useEffect(() => {
		nav?.setClose(onClose);
	}, [nav, onClose]);
	if (nav == null) return null;
	const subLevel = nav.subLevel;
	// Below a section the title already names it ("Permissions › @everyone"): the button keeps its arrow.
	const sectionLabel = subLevel != null && typeof title === 'string' ? title : null;
	return (
		<button
			type="button"
			onClick={subLevel?.back ?? nav.showList}
			aria-label={sectionLabel != null ? i18n._(BACK_TO_SECTION_DESCRIPTOR, {section: sectionLabel}) : undefined}
			className={styles.backButton}
			data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-button.show-list"
		>
			<CaretLeftIcon
				weight="bold"
				className={styles.backIcon}
				data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-icon"
			/>
			{subLevel == null && (
				<span className={styles.backLabel} data-flx="app.settings-narrow-nav.settings-narrow-nav-button.back-label">
					{i18n._(SETTINGS_DESCRIPTOR)}
				</span>
			)}
		</button>
	);
};
