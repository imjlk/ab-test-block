/* eslint-disable no-console */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	assertPublishableAssetsExist,
	assertReleaseVersionConsistency,
	assertZipExists,
	listZipEntries,
	PLUGIN_SLUG,
	stageWordPressOrgLayout,
} from './wordpress-org-utils';

function assert( condition: unknown, message: string ): asserts condition {
	if ( ! condition ) {
		throw new Error( message );
	}
}

function main() {
	const version = assertReleaseVersionConsistency();
	assertPublishableAssetsExist();
	assertZipExists();

	const zipEntries = listZipEntries();
	const requiredZipEntries = [
		`${ PLUGIN_SLUG }/ab-test-block.php`,
		`${ PLUGIN_SLUG }/readme.txt`,
		`${ PLUGIN_SLUG }/build/blocks/test/block.json`,
		`${ PLUGIN_SLUG }/build/blocks/test/view.js`,
	];

	for ( const entry of requiredZipEntries ) {
		assert(
			zipEntries.includes( entry ),
			`Zip preflight failed: missing ${ entry } in ${ PLUGIN_SLUG }.zip`
		);
	}

	const stageRoot = fs.mkdtempSync(
		path.join( os.tmpdir(), 'ab-test-block-wordpress-org-preflight-' )
	);

	try {
		const staged = stageWordPressOrgLayout( stageRoot );
		const requiredStagedPaths = [
			path.join( staged.trunkDir, 'ab-test-block.php' ),
			path.join( staged.trunkDir, 'readme.txt' ),
			path.join(
				staged.trunkDir,
				'build',
				'blocks',
				'test',
				'block.json'
			),
			path.join( staged.tagDir, 'ab-test-block.php' ),
			path.join( staged.tagDir, 'readme.txt' ),
			path.join( staged.assetsDir, 'banner-772x250.png' ),
			path.join( staged.assetsDir, 'icon-256x256.png' ),
			path.join( staged.assetsDir, 'screenshot-1.png' ),
			path.join( staged.assetsDir, 'screenshot-2.png' ),
			path.join( staged.assetsDir, 'blueprints', 'blueprint.json' ),
		];

		for ( const stagedPath of requiredStagedPaths ) {
			assert(
				fs.existsSync( stagedPath ),
				`WordPress.org staging preflight failed: missing ${ stagedPath }`
			);
		}

		assert(
			! fs.existsSync( path.join( staged.trunkDir, 'README.md' ) ),
			'WordPress.org trunk should not contain README.md; readme.txt must remain the source of truth.'
		);

		console.log(
			`✅ WordPress.org preflight passed for version ${ version }.`
		);
		console.log( `   trunk: ${ staged.trunkDir }` );
		console.log( `   tag:   ${ staged.tagDir }` );
		console.log( `   assets:${ staged.assetsDir }` );
	} finally {
		fs.rmSync( stageRoot, { recursive: true, force: true } );
	}
}

main();
