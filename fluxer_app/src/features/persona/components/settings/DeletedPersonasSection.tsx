// SPDX-License-Identifier: AGPL-3.0-or-later

// Deleted personas, with Restore (tyne-chat/tyne#243). A deleted persona still shows on its old
// messages; restoring brings the same persona back with its history. The list is asked for once,
// when the person opens it, and a failure waits for Retry: never a request per render.

import {SettingsSection} from '@app/features/app/components/dialogs/shared/SettingsSection';
import * as PersonaCommands from '@app/features/persona/commands/PersonaCommands';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {Button} from '@app/features/ui/button/Button';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import Users from '@app/features/user/state/Users';
import type {PersonaResponse, PersonaTag} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useState} from 'react';
import styles from '../modals/PersonaImportReview.module.css';

const SECTION_TITLE_DESCRIPTOR = msg({
	message: 'Deleted personas',
	comment: 'Title of the section in Settings › Personas that lists deleted personas',
});
const DELETED_META_DESCRIPTOR = msg({
	message: 'Deleted {date}',
	comment: 'When a persona was deleted, in the import review. {date} is a date',
});
const USED_TIMES_DESCRIPTOR = msg({
	message: '{count, plural, one {Used once} other {Used # times}}',
	comment: 'How often a persona has been used, shown in the import review',
});
const RESTORED_DESCRIPTOR = msg({
	message: '{name} is back.',
	comment: 'Toast after a deleted persona was restored',
});
const RESTORED_WITHOUT_DESCRIPTOR = msg({
	message: 'Came back without {items}: another persona has them now.',
	comment: 'Import warning for a restored persona whose proxy tags or signature emojis another persona took meanwhile',
});
const LOAD_FAILED_DESCRIPTOR = msg({
	message: 'The deleted personas could not be loaded.',
	comment: 'Error in Settings › Personas when the list of deleted personas fails to load',
});
const RESTORE_FAILED_DESCRIPTOR = msg({
	message: 'The persona could not be restored.',
	comment: 'Error toast when restoring a deleted persona fails',
});

function tagText(tag: PersonaTag): string {
	return `${(tag.prefix ?? '').trim()}text${(tag.suffix ?? '').trim()}`;
}

export const DeletedPersonasSection = observer(() => {
	const {i18n} = useLingui();
	const user = Users.currentUser;
	const [state, setState] = useState<'closed' | 'loading' | 'failed' | 'ready'>('closed');
	const [personas, setPersonas] = useState<Array<PersonaResponse>>([]);
	const [restoring, setRestoring] = useState<string | null>(null);

	const load = async () => {
		setState('loading');
		try {
			setPersonas(await PersonaCommands.fetchDeletedPersonas());
			setState('ready');
		} catch {
			setState('failed');
		}
	};

	const restore = async (persona: PersonaResponse) => {
		setRestoring(persona.id);
		try {
			const result = await PersonaCommands.restorePersona(persona.id);
			setPersonas((current) => current.filter((p) => p.id !== persona.id));
			const lost = [...result.dropped_tags.map(tagText), ...result.dropped_signature_emojis.map((e) => e.name)];
			ToastCommands.success(
				lost.length > 0
					? `${i18n._(RESTORED_DESCRIPTOR, {name: persona.name})} ${i18n._(RESTORED_WITHOUT_DESCRIPTOR, {items: lost.join(', ')})}`
					: i18n._(RESTORED_DESCRIPTOR, {name: persona.name}),
			);
		} catch (err: unknown) {
			const message = PersonaCommands.personaErrorMessage(err, i18n._(RESTORE_FAILED_DESCRIPTOR));
			if (message) ToastCommands.error(message);
		} finally {
			setRestoring(null);
		}
	};

	return (
		<SettingsSection
			id="deleted_personas"
			title={i18n._(SECTION_TITLE_DESCRIPTOR)}
			linkable={false}
			data-flx="persona.settings.deleted-personas-section.deleted-personas"
		>
			<p className={styles.explanation} data-flx="persona.settings.deleted-personas-section.explanation">
				<Trans comment="Explanation of the deleted personas section in Settings › Personas">
					Deleted personas still show on their old messages, but nobody can pick them and they don't count towards your
					limit. Restoring one brings the same persona back, with its history.
				</Trans>
			</p>
			{state === 'closed' && (
				<div className={styles.groupButtons} data-flx="persona.settings.deleted-personas-section.group-buttons">
					<Button
						variant="secondary"
						small
						onClick={() => void load()}
						data-flx="persona.settings.deleted-personas-section.button"
					>
						<Trans comment="Button that loads the list of deleted personas in Settings › Personas">
							Show deleted personas
						</Trans>
					</Button>
				</div>
			)}
			{state === 'loading' && (
				<p className={styles.explanation} data-flx="persona.settings.deleted-personas-section.explanation--2">
					<Trans comment="Status while the deleted personas load">Loading...</Trans>
				</p>
			)}
			{state === 'failed' && (
				<div className={styles.groupButtons} data-flx="persona.settings.deleted-personas-section.group-buttons--2">
					<span className={styles.explanation} data-flx="persona.settings.deleted-personas-section.explanation--3">
						{i18n._(LOAD_FAILED_DESCRIPTOR)}
					</span>
					<Button
						variant="secondary"
						small
						onClick={() => void load()}
						data-flx="persona.settings.deleted-personas-section.button--2"
					>
						<Trans comment="Button that tries loading the deleted personas again">Retry</Trans>
					</Button>
				</div>
			)}
			{state === 'ready' &&
				(personas.length === 0 ? (
					<p className={styles.explanation} data-flx="persona.settings.deleted-personas-section.explanation--4">
						<Trans comment="Shown in Settings › Personas when there are no deleted personas">
							No deleted personas.
						</Trans>
					</p>
				) : (
					<div className={styles.rows} data-flx="persona.settings.deleted-personas-section.rows">
						{personas.map((persona) => {
							const deletedAt = persona.deleted_at ? new Date(persona.deleted_at) : null;
							const tags = persona.persona_tags.map(tagText).join(' ');
							return (
								<div key={persona.id} className={styles.row} data-flx="persona.settings.deleted-personas-section.row">
									<div className={styles.rowMain} data-flx="persona.settings.deleted-personas-section.row-main">
										{user && (
											<PersonaAvatar
												user={user}
												persona={{avatar: persona.avatar_hash ?? null}}
												size={36}
												data-flx="persona.settings.deleted-personas-section.persona-avatar"
											/>
										)}
										<div className={styles.rowText} data-flx="persona.settings.deleted-personas-section.row-text">
											<span className={styles.rowName} data-flx="persona.settings.deleted-personas-section.row-name">
												{persona.name}
											</span>
											<span className={styles.rowMeta} data-flx="persona.settings.deleted-personas-section.row-meta">
												{[
													deletedAt
														? i18n._(DELETED_META_DESCRIPTOR, {date: deletedAt.toLocaleDateString(i18n.locale)})
														: null,
													tags || null,
													i18n._(USED_TIMES_DESCRIPTOR, {count: persona.use_count ?? 0}),
												]
													.filter(Boolean)
													.join(' · ')}
											</span>
										</div>
										<Button
											variant="secondary"
											small
											disabled={restoring !== null}
											onClick={() => void restore(persona)}
											data-flx="persona.settings.deleted-personas-section.button--3"
										>
											<Trans comment="Button that brings back a deleted persona">Restore</Trans>
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				))}
		</SettingsSection>
	);
});
