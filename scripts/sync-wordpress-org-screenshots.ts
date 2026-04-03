/* eslint-disable no-console */
import fs from 'node:fs';

const SCREENSHOT_MAP = [
	{
		source: 'tests/visual-baselines/ab-test-block/front-a.png',
		target: '.wordpress-org/screenshot-1.png',
	},
	{
		source: 'tests/visual-baselines/ab-test-block/editor-parent-selected.png',
		target: '.wordpress-org/screenshot-2.png',
	},
] as const;

for ( const file of SCREENSHOT_MAP ) {
	if ( ! fs.existsSync( file.source ) ) {
		throw new Error(
			`Missing baseline screenshot: ${ file.source }. Run bun run visual:e2e:update first.`
		);
	}

	fs.copyFileSync( file.source, file.target );
	console.log( `✅ Synced ${ file.target }` );
}
