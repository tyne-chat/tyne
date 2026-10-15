// SPDX-License-Identifier: AGPL-3.0-or-later

import {AutocompleteOption} from '@app/features/channel/components/message_search_bar/AutocompleteOption';
import styles from '@app/features/channel/components/message_search_bar/MessageSearchBar.module.css';
import type {AutocompleteOption as AutocompleteOptionValue} from '@app/features/channel/components/message_search_bar/MessageSearchBarTypes';
import {
	isSearchPersonaOption,
	type PersonaSuggestionRow,
	type SearchPersonaOption,
} from '@app/features/channel/components/message_search_bar/PersonaSearchSuggestions';
import {PersonaAvatar} from '@app/features/persona/components/PersonaAvatar';
import {remFromPx} from '@app/features/theme/layout/RemFromPx';
import {BaseAvatar} from '@app/features/ui/components/BaseAvatar';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import type {ChannelPersonaMentionItem} from '@fluxer/schema/src/domains/persona/PersonaApiSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {MagnifyingGlassIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';

const PERSONAS_DESCRIPTOR = msg({
	message: 'Personas',
	comment: 'Section header in the message search popout listing matching personas for from: / mentions: filters.',
});

function ownerTag(persona: ChannelPersonaMentionItem): string {
	const owner = Users.getUser(persona.owner_user_id);
	if (owner != null) return NicknameUtils.formatUserTagForStreamerMode(owner);
	return NicknameUtils.formatTagForStreamerMode(
		persona.owner_discriminator ? `${persona.owner_username}#${persona.owner_discriminator}` : persona.owner_username,
	);
}

/** A persona's avatar, name and owner, as one search suggestion row shows it. */
export const PersonaSuggestionLabel: React.FC<{persona: ChannelPersonaMentionItem}> = observer(({persona}) => {
	const owner = Users.getUser(persona.owner_user_id);
	return (
		<span className={`${styles.userRow} ${styles.gap1}`} data-flx="channel.message-search-bar.persona-suggestion.row">
			<span
				className={`${styles.userRow} ${styles.gap2}`}
				data-flx="channel.message-search-bar.persona-suggestion.name-row"
			>
				{owner != null ? (
					<PersonaAvatar
						user={owner}
						persona={{avatar: persona.avatar_hash ?? null}}
						size={16}
						showOffline={false}
						disableStatusTooltip={true}
						data-flx="channel.message-search-bar.persona-suggestion.avatar"
					/>
				) : (
					<BaseAvatar
						size={16}
						avatarUrl={
							(persona.avatar_hash
								? AvatarUtils.getPersonaAvatarURL({userId: persona.owner_user_id, avatar: persona.avatar_hash})
								: null) ?? AvatarUtils.getDefaultAvatarURL(persona.id)
						}
						disableStatusTooltip={true}
						data-flx="channel.message-search-bar.persona-suggestion.avatar"
					/>
				)}
				<span
					className={`${styles.minW0} ${styles.overflowHidden}`}
					data-flx="channel.message-search-bar.persona-suggestion.name"
				>
					{persona.name}
				</span>
			</span>
			<span className={styles.userTag} data-flx="channel.message-search-bar.persona-suggestion.owner">
				{ownerTag(persona)}
			</span>
		</span>
	);
});

interface PersonaOptionRowProps {
	persona: ChannelPersonaMentionItem;
	index: number;
	selectedIndex: number;
	hoverIndex: number;
	onSelect: () => void;
	onMouseEnter: (index: number) => void;
	onMouseLeave?: () => void;
	listboxId: string;
}

const PersonaOptionRow: React.FC<PersonaOptionRowProps> = ({
	persona,
	index,
	selectedIndex,
	hoverIndex,
	onSelect,
	onMouseEnter,
	onMouseLeave,
	listboxId,
}) => (
	<AutocompleteOption
		index={index}
		isSelected={index === selectedIndex}
		isHovered={index === hoverIndex}
		onSelect={onSelect}
		onMouseEnter={() => onMouseEnter(index)}
		onMouseLeave={onMouseLeave}
		listboxId={listboxId}
		data-flx="channel.message-search-bar.persona-suggestion.select"
	>
		<div className={styles.optionLabel} data-flx="channel.message-search-bar.persona-suggestion.option-label">
			<div className={styles.optionContent} data-flx="channel.message-search-bar.persona-suggestion.option-content">
				<div className={styles.optionText} data-flx="channel.message-search-bar.persona-suggestion.option-text">
					<div className={styles.optionTitle} data-flx="channel.message-search-bar.persona-suggestion.option-title">
						<PersonaSuggestionLabel
							persona={persona}
							data-flx="channel.message-search-bar.personas-section.persona-option-row.persona-suggestion-label"
						/>
					</div>
				</div>
			</div>
		</div>
	</AutocompleteOption>
);

interface PersonasSectionProps {
	/** Every option of the `from:`/`mentions:` list; the personas follow the accounts, and keep their index in it. */
	options: ReadonlyArray<AutocompleteOptionValue>;
	selectedIndex: number;
	hoverIndex: number;
	onSelect: (option: SearchPersonaOption) => void;
	onMouseEnter: (index: number) => void;
	onMouseLeave?: () => void;
	listboxId: string;
}

/** The personas section below the accounts in the `from:` / `mentions:` suggestions. */
export const PersonasSection: React.FC<PersonasSectionProps> = observer(
	({options, selectedIndex, hoverIndex, onSelect, onMouseEnter, onMouseLeave, listboxId}) => {
		const {i18n} = useLingui();
		const entries = options.flatMap((option, index) => (isSearchPersonaOption(option) ? [{option, index}] : []));
		if (entries.length === 0) return null;
		return (
			<div className={styles.popoutSection} data-flx="channel.message-search-bar.personas-section.popout-section">
				<div
					className={styles.popoutSectionHeader}
					data-flx="channel.message-search-bar.personas-section.popout-section-header"
				>
					<span
						className={`${styles.flex} ${styles.itemsCenter} ${styles.gap2}`}
						data-flx="channel.message-search-bar.personas-section.flex"
					>
						<MagnifyingGlassIcon
							weight="regular"
							size={remFromPx(14)}
							data-flx="channel.message-search-bar.personas-section.magnifying-glass-icon"
						/>
						{i18n._(PERSONAS_DESCRIPTOR)}
					</span>
				</div>
				{entries.map(({option, index}) => (
					<PersonaOptionRow
						key={option.persona.id}
						persona={option.persona}
						index={index}
						selectedIndex={selectedIndex}
						hoverIndex={hoverIndex}
						onSelect={() => onSelect(option)}
						onMouseEnter={onMouseEnter}
						onMouseLeave={onMouseLeave}
						listboxId={listboxId}
						data-flx="channel.message-search-bar.personas-section.persona-option-row.select"
					/>
				))}
			</div>
		);
	},
);

/** A persona row among the plain-word suggestions (PlaintextSection hands these over). */
export const PlaintextPersonaRow: React.FC<{
	row: PersonaSuggestionRow;
	index: number;
	selectedIndex: number;
	hoverIndex: number;
	onSelect: (row: PersonaSuggestionRow) => void;
	onMouseEnter: (index: number) => void;
	onMouseLeave?: () => void;
	listboxId: string;
}> = ({row, index, selectedIndex, hoverIndex, onSelect, onMouseEnter, onMouseLeave, listboxId}) => (
	<PersonaOptionRow
		persona={row.persona}
		index={index}
		selectedIndex={selectedIndex}
		hoverIndex={hoverIndex}
		onSelect={() => onSelect(row)}
		onMouseEnter={onMouseEnter}
		onMouseLeave={onMouseLeave}
		listboxId={listboxId}
		data-flx="channel.message-search-bar.personas-section.plaintext-persona-row.persona-option-row.select"
	/>
);
