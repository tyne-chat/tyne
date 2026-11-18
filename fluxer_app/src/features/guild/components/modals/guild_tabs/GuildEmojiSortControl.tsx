// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildEmojiListPrefs} from '@app/features/emoji/state/GuildEmojiListPrefs';
import forumStyles from '@app/features/forum/components/Forum.module.css';
import {remFromPx} from '@app/features/theme/layout/RemFromPx';
import {BottomSheet} from '@app/features/ui/bottom_sheet/BottomSheet';
import {Button} from '@app/features/ui/button/Button';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {RadioGroup} from '@app/features/ui/radio_group/RadioGroup';
import MobileLayout from '@app/features/ui/state/MobileLayout';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CaretDownIcon, SortAscendingIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import {useState} from 'react';

const SORT_AND_GROUP_DESCRIPTOR = msg({
	message: 'Sort and group',
	comment: 'Title of the menu that orders the emoji list in community emoji settings.',
});
const SORT_BY_DESCRIPTOR = msg({
	message: 'Sort by',
	comment: 'Heading of the sort choices in the community emoji settings sort menu.',
});
const SORT_NAME_DESCRIPTOR = msg({
	message: 'Name (A–Z)',
	comment: 'Sort choice in community emoji settings: emojis in alphabetical order.',
});
const SORT_RECENT_DESCRIPTOR = msg({
	message: 'Recently added',
	comment: 'Sort choice in community emoji settings: the newest uploaded emojis first.',
});
const GROUP_DESCRIPTOR = msg({
	message: 'Grouping',
	comment: 'Heading of the grouping choices in the community emoji settings sort menu.',
});
const GROUP_SPLIT_DESCRIPTOR = msg({
	message: 'Non-animated and animated apart',
	comment: 'Grouping choice in community emoji settings: two sections, non-animated emojis and animated emojis.',
});
const GROUP_TOGETHER_DESCRIPTOR = msg({
	message: 'All in one list',
	comment: 'Grouping choice in community emoji settings: non-animated and animated emojis in one section.',
});
/** The heading of the one section when every emoji is in one list. */
export const ALL_EMOJI_SECTION_TITLE_DESCRIPTOR = msg({
	message: 'Emoji ({emojiCount})',
	comment: 'Section heading in community emoji settings when non-animated and animated emojis are listed together.',
});

const SortGroupPanel = observer(({sheet = false}: {sheet?: boolean}) => {
	const {i18n} = useLingui();
	return (
		<div
			className={clsx(forumStyles.sortPanel, sheet && forumStyles.sortPanelSheet)}
			data-flx="guild.guild-tabs.guild-emoji-sort.panel"
		>
			<section className={forumStyles.sortSection} data-flx="guild.guild-tabs.guild-emoji-sort.sort">
				<h3 className={forumStyles.sortHeading} data-flx="guild.guild-tabs.guild-emoji-sort.sort-heading">
					{i18n._(SORT_BY_DESCRIPTOR)}
				</h3>
				<RadioGroup
					aria-label={i18n._(SORT_BY_DESCRIPTOR)}
					optionAlign="center"
					value={GuildEmojiListPrefs.currentSort}
					onChange={GuildEmojiListPrefs.setSort}
					options={[
						{value: 'name' as const, name: i18n._(SORT_NAME_DESCRIPTOR)},
						{value: 'recent' as const, name: i18n._(SORT_RECENT_DESCRIPTOR)},
					]}
					data-flx="guild.guild-tabs.guild-emoji-sort.sort-radio-group"
				/>
			</section>
			<section className={forumStyles.sortSection} data-flx="guild.guild-tabs.guild-emoji-sort.group">
				<h3 className={forumStyles.sortHeading} data-flx="guild.guild-tabs.guild-emoji-sort.group-heading">
					{i18n._(GROUP_DESCRIPTOR)}
				</h3>
				<RadioGroup
					aria-label={i18n._(GROUP_DESCRIPTOR)}
					optionAlign="center"
					value={GuildEmojiListPrefs.currentGrouping}
					onChange={GuildEmojiListPrefs.setGrouping}
					options={[
						{value: 'split' as const, name: i18n._(GROUP_SPLIT_DESCRIPTOR)},
						{value: 'together' as const, name: i18n._(GROUP_TOGETHER_DESCRIPTOR)},
					]}
					data-flx="guild.guild-tabs.guild-emoji-sort.group-radio-group"
				/>
			</section>
		</div>
	);
});

/**
 * The sort and grouping menu of a community's emoji settings (tyne-chat/tyne#775), shaped like the
 * forum's "Sort & view" and the persona gallery's sort: a button naming the current order that opens a
 * popout, or a bottom sheet on the phone layout.
 */
export const GuildEmojiSortControl = observer(() => {
	const {i18n} = useLingui();
	const [sheetOpen, setSheetOpen] = useState(false);
	const mobile = MobileLayout.enabled;
	const sortLabel = i18n._(
		GuildEmojiListPrefs.currentSort === 'recent' ? SORT_RECENT_DESCRIPTOR : SORT_NAME_DESCRIPTOR,
	);
	const button = (
		<Button
			variant="secondary"
			small
			fitContent
			leftIcon={
				<SortAscendingIcon size={remFromPx(16)} weight="bold" data-flx="guild.guild-tabs.guild-emoji-sort.icon" />
			}
			rightIcon={
				<CaretDownIcon size={remFromPx(12)} weight="bold" data-flx="guild.guild-tabs.guild-emoji-sort.caret" />
			}
			className={forumStyles.filterPill}
			aria-haspopup="menu"
			aria-label={`${i18n._(SORT_AND_GROUP_DESCRIPTOR)}: ${sortLabel}`}
			onClick={mobile ? () => setSheetOpen(true) : undefined}
			data-flx="guild.guild-tabs.guild-emoji-sort.button"
		>
			{sortLabel}
		</Button>
	);
	if (!mobile) {
		return (
			<Popout
				position="bottom-start"
				render={() => <SortGroupPanel data-flx="guild.guild-tabs.guild-emoji-sort.popout-panel" />}
				data-flx="guild.guild-tabs.guild-emoji-sort.popout"
			>
				{button}
			</Popout>
		);
	}
	return (
		<>
			{button}
			<BottomSheet
				isOpen={sheetOpen}
				onClose={() => setSheetOpen(false)}
				title={i18n._(SORT_AND_GROUP_DESCRIPTOR)}
				snapPoints={[0, 1]}
				initialSnap={1}
				data-flx="guild.guild-tabs.guild-emoji-sort.sheet"
			>
				<SortGroupPanel sheet data-flx="guild.guild-tabs.guild-emoji-sort.sheet-panel" />
			</BottomSheet>
		</>
	);
});
