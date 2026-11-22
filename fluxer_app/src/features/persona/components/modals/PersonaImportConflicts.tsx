// SPDX-License-Identifier: AGPL-3.0-or-later

// The import review's clash box (tyne-chat/tyne#862): each tag or signature emoji two choices would give
// to two personas, with each holder said to be new from the file, the file's version, or already in
// Tyne, and a button on each that the review can show (opening its folded section and focusing it).

import {PRODUCT_NAME} from '@app/features/app/config/ProductConstants';
import type {ConflictHolder, ReviewConflict} from '@app/features/persona/utils/PersonaImportReview';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import styles from './PersonaImportReview.module.css';

const HOLDER_NEW_DESCRIPTOR = msg({
	message: '{name} (new, from your file)',
	comment:
		'A persona named in a clash in the import review: a member of the import file that the import adds. {name} is its name',
});
const HOLDER_FILE_DESCRIPTOR = msg({
	message: "{name} (your file's version)",
	comment:
		"A persona named in a clash in the import review: one the import changes to the import file's version. {name} is its name",
});
const HOLDER_TYNE_DESCRIPTOR = msg({
	message: '{name} (already in {productName})',
	comment:
		'A persona named in a clash in the import review: one the account already has, which the import leaves as it is. {name} is its name, {productName} the app name',
});

/** The holders as one list in the locale's words ("A, B and C"), each a button where it can be shown. */
function HolderList({
	holders,
	canShow,
	onShow,
}: {
	holders: ReadonlyArray<ConflictHolder>;
	canShow: (holder: ConflictHolder) => boolean;
	onShow: (holder: ConflictHolder) => void;
}) {
	const {i18n} = useLingui();
	const labels = holders.map((holder) => {
		if (holder.side === 'new') return i18n._(HOLDER_NEW_DESCRIPTOR, {name: holder.name});
		if (holder.side === 'file') return i18n._(HOLDER_FILE_DESCRIPTOR, {name: holder.name});
		return i18n._(HOLDER_TYNE_DESCRIPTOR, {name: holder.name, productName: PRODUCT_NAME});
	});
	const item = (index: number) => {
		const holder = holders[index]!;
		const label = labels[index]!;
		if (!canShow(holder))
			return (
				<span key={`holder-${index}`} data-flx="persona.persona-import-conflicts.item.span">
					{label}
				</span>
			);
		return (
			<FocusRing key={`holder-${index}`} offset={-1} data-flx="persona.persona-import-conflicts.holder-focus-ring">
				<button
					type="button"
					className={styles.conflictHolder}
					onClick={() => onShow(holder)}
					data-flx="persona.persona-import-conflicts.holder"
				>
					{label}
				</button>
			</FocusRing>
		);
	};
	// Placeholders stand for the holders, so the locale's list words sit between the buttons.
	const placeholders = holders.map((_, index) => `\u{E000}${index}\u{E000}`);
	let parts: Array<{type: string; value: string}>;
	try {
		parts = new Intl.ListFormat(i18n.locale, {type: 'conjunction', style: 'narrow'}).formatToParts(placeholders);
	} catch {
		parts = placeholders.flatMap((value, index) => [
			...(index > 0 ? [{type: 'literal', value: ', '}] : []),
			{type: 'element', value},
		]);
	}
	return (
		<>
			{parts.map((part, position) => {
				const index = part.type === 'element' ? placeholders.indexOf(part.value) : -1;
				return index >= 0 ? (
					item(index)
				) : (
					<span key={`literal-${position}`} data-flx="persona.persona-import-conflicts.holder-list.span">
						{part.value}
					</span>
				);
			})}
		</>
	);
}

export function PersonaImportConflicts({
	conflicts,
	canShow,
	onShow,
}: {
	conflicts: ReadonlyArray<ReviewConflict>;
	canShow: (holder: ConflictHolder) => boolean;
	onShow: (holder: ConflictHolder) => void;
}) {
	if (conflicts.length === 0) return null;
	return (
		<div className={styles.conflicts} role="alert" data-flx="persona.persona-import-review.conflicts">
			{conflicts.map((conflict) => {
				const label = conflict.label;
				const names = (
					<HolderList
						holders={conflict.holders}
						canShow={canShow}
						onShow={onShow}
						data-flx="persona.persona-import-conflicts.holders"
					/>
				);
				return (
					<div key={label} data-flx="persona.persona-import-review.conflict">
						<Trans comment="A clash in the import review. {label} is a proxy tag or emoji, {names} a list of persona names">
							{names} would all have {label}. Change one of the choices.
						</Trans>
					</div>
				);
			})}
		</div>
	);
}
