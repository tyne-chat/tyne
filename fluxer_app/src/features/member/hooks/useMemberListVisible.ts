// SPDX-License-Identifier: AGPL-3.0-or-later

import MemberList from '@app/features/member/state/MemberList';

interface UseMemberListVisibleOptions {
	channelId?: string | null;
	defaultHiddenForChannel?: boolean;
}

// Screen width gating has been removed to let users control their own panels at any window width.
export const useCanFitMemberList = (): boolean => true;

export const useMemberListVisible = (options: UseMemberListVisibleOptions = {}): boolean => {
	return MemberList.isMembersVisible(options);
};
