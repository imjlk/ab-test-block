/* eslint-disable no-console */
import path from 'node:path';

import {
	copyPublishableAssets,
	getArgValue,
	PLUGIN_SLUG,
} from './wordpress-org-utils';

const DEFAULT_TARGET_DIR = path.join(
	'.wordpress-org-dist',
	PLUGIN_SLUG,
	'assets'
);

function main() {
	const targetDir = getArgValue( '--target' ) ?? DEFAULT_TARGET_DIR;
	copyPublishableAssets( targetDir );

	console.log(
		`✅ Copied publishable WordPress.org assets into ${ targetDir }`
	);
}

main();
