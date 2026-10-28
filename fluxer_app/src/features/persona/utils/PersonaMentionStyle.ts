// SPDX-License-Identifier: AGPL-3.0-or-later

import {type PersonaColorSource, personaColor} from '@app/features/persona/utils/PersonaColor';
import * as ColorUtils from '@app/features/theme/utils/ColorUtils';
import type React from 'react';

// A persona mention in the persona's colour (`personaColor`), as in the mobile app: the text in it,
// the fill a tenth of it. Setting `--text-link` on the pill keeps upstream's rules working: the hover
// keeps the colour, and a failed message's `--markup-mention-color` still turns it red. Without a
// colour, the mention looks like any other.
export function personaMentionStyle(persona: PersonaColorSource | null | undefined): React.CSSProperties | undefined {
	const color = personaColor(persona);
	if (color == null) return undefined;
	return {
		'--text-link': ColorUtils.int2hex(color),
		'--markup-mention-fill': ColorUtils.int2rgba(color, 0.1),
		'--markup-interactive-hover-fill': ColorUtils.int2rgba(color, 0.2),
	} as React.CSSProperties;
}
