// SPDX-License-Identifier: AGPL-3.0-or-later

import {computed} from 'mobx';
import {type DependencyList, useMemo} from 'react';

/**
 * Memoizes `factory` across unrelated renders like `useMemo`, while wrapping it in a
 * MobX `computed` so observable reads inside loops or dynamic lookups invalidate and
 * trigger `observer()` re-renders when those observables mutate (tyne-chat/tyne#937, #948).
 */
export function useMobxMemo<T>(factory: () => T, deps: DependencyList): T {
	return useMemo(() => computed(factory), deps).get();
}
