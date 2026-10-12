// SPDX-License-Identifier: AGPL-3.0-or-later

import {msg} from '@lingui/core/macro';
import type React from 'react';

export const APPLICATION_ICON_DESCRIPTOR = msg({
	message: '{productName} application icon',
	comment: 'Accessible label for the Fluxer application icon.',
});

// Fork: the mark is a placeholder for Tyne's artwork (a plain "T"), to be replaced by the real logo.
export const FluxerIconMark = (props: React.SVGProps<SVGSVGElement>) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 512 512"
		role="img"
		data-flx="ui.icons.fluxer-icon.img"
		{...props}
	>
		<rect fill="var(--brand-primary)" height={512} rx={256} width={512} data-flx="ui.icons.fluxer-icon.rect" />
		<path
			fill="var(--brand-primary-fill)"
			d="M136 136h240v56h-92v184h-56V192h-92z"
			data-flx="ui.icons.fluxer-icon.path"
		/>
	</svg>
);
