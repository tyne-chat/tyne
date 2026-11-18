// SPDX-License-Identifier: AGPL-3.0-or-later

import {makePersistent} from '@app/features/platform/utils/MobXPersistence';
import {initializeStore} from '@app/features/platform/utils/StoreInitialization';
import {makeAutoObservable} from 'mobx';

export type GuildEmojiListSort = 'name' | 'recent';
export type GuildEmojiListGrouping = 'split' | 'together';

const SORTS: ReadonlyArray<GuildEmojiListSort> = ['name', 'recent'];
const GROUPINGS: ReadonlyArray<GuildEmojiListGrouping> = ['split', 'together'];

/**
 * How a community's emoji settings list its emojis (tyne-chat/tyne#775): by name or newest first, and
 * with non-animated and animated emojis apart or in one list. Kept in this device's storage
 * (`makePersistent`, key `GuildEmojiList`) for every community, like the persona gallery's view.
 */
class GuildEmojiListPrefsStore {
	sort: GuildEmojiListSort = 'name';
	grouping: GuildEmojiListGrouping = 'split';

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
		initializeStore(this, () => makePersistent(this, 'GuildEmojiList', ['sort', 'grouping']));
	}

	get currentSort(): GuildEmojiListSort {
		return SORTS.includes(this.sort) ? this.sort : 'name';
	}

	get currentGrouping(): GuildEmojiListGrouping {
		return GROUPINGS.includes(this.grouping) ? this.grouping : 'split';
	}

	setSort(sort: GuildEmojiListSort): void {
		this.sort = sort;
	}

	setGrouping(grouping: GuildEmojiListGrouping): void {
		this.grouping = grouping;
	}
}

export const GuildEmojiListPrefs = new GuildEmojiListPrefsStore();
