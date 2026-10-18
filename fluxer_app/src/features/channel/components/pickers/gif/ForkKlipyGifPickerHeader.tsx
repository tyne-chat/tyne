// SPDX-License-Identifier: AGPL-3.0-or-later

// Fork: the GIF picker header with the "Powered by KLIPY" mark beside it, kept
// visible in every picker view, as KLIPY's attribution guidelines ask for.

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import styles from '@app/features/channel/components/pickers/gif/ForkKlipyGifPickerHeader.module.css';
import {GifPickerHeader} from '@app/features/channel/components/pickers/gif/GifPickerHeader';
import KlipyPoweredByAsset from '@app/media/images/klipy-powered-by.svg?react';
import {observer} from 'mobx-react-lite';
import type React from 'react';

export const ForkKlipyGifPickerHeader = observer((props: React.ComponentProps<typeof GifPickerHeader>) => {
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
				aria-label="Powered by KLIPY"
				data-flx="channel.pickers.gif.fork-klipy-gif-picker-header.powered-by"
			/>
		</div>
	);
});
