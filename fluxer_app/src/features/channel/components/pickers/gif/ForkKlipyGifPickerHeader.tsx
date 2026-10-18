// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the GIF picker header with the "Powered by KLIPY" mark beside it, kept
// visible in every picker view, as KLIPY's attribution guidelines ask for.

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import styles from '@app/features/channel/components/pickers/gif/ForkKlipyGifPickerHeader.module.css';
import {GifPickerHeader} from '@app/features/channel/components/pickers/gif/GifPickerHeader';
import KlipyPoweredByAsset from '@app/media/images/klipy-powered-by.svg?react';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import type React from 'react';

const POWERED_BY_KLIPY_DESCRIPTOR = msg({
	message: 'Powered by KLIPY',
	comment: 'Accessible name of the KLIPY attribution mark in the GIF picker; KLIPY is a brand name',
});

export const ForkKlipyGifPickerHeader = observer((props: React.ComponentProps<typeof GifPickerHeader>) => {
	const {i18n} = useLingui();
	if (RuntimeConfig.gifProvider !== 'klipy') {
		return <GifPickerHeader data-flx="channel.pickers.gif.fork-klipy-gif-picker-header.gif-picker-header" {...props} />;
	}
	return (
		<div className={styles.row} data-flx="channel.pickers.gif.fork-klipy-gif-picker-header.row">
			<div className={styles.header} data-flx="channel.pickers.gif.fork-klipy-gif-picker-header.header">
				<GifPickerHeader data-flx="channel.pickers.gif.fork-klipy-gif-picker-header.gif-picker-header--2" {...props} />
			</div>
			<KlipyPoweredByAsset
				className={styles.poweredBy}
				role="img"
				aria-label={i18n._(POWERED_BY_KLIPY_DESCRIPTOR)}
				data-flx="channel.pickers.gif.fork-klipy-gif-picker-header.powered-by"
			/>
		</div>
	);
});
