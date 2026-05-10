/* eslint-disable no-console */
import { execFileSync } from 'node:child_process';
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

function readVersionFromPluginHeader( contents: string ) {
	return contents.match( /^ \* Version:\s*(.+)$/m )?.[ 1 ]?.trim() ?? '';
}

function readStableTag( contents: string ) {
	return contents.match( /^Stable tag:\s*(.+)$/m )?.[ 1 ]?.trim() ?? '';
}

function readJsonVersion( contents: string ) {
	const json = JSON.parse( contents ) as { version?: unknown };
	return typeof json.version === 'string' ? json.version : '';
}

function readZipEntry( entryPath: string ) {
	return execFileSync( 'unzip', [ '-p', 'ab-test-block.zip', entryPath ], {
		encoding: 'utf8',
	} );
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

	const packagedPackageVersion = readJsonVersion(
		readZipEntry( `${ PLUGIN_SLUG }/package.json` )
	);
	const packagedPluginVersion = readVersionFromPluginHeader(
		readZipEntry( `${ PLUGIN_SLUG }/ab-test-block.php` )
	);
	const packagedStableTag = readStableTag(
		readZipEntry( `${ PLUGIN_SLUG }/readme.txt` )
	);
	const packagedTestBlockVersion = readJsonVersion(
		readZipEntry( `${ PLUGIN_SLUG }/build/blocks/test/block.json` )
	);
	const packagedVariantBlockVersion = readJsonVersion(
		readZipEntry( `${ PLUGIN_SLUG }/build/blocks/variant/block.json` )
	);

	assert(
		packagedPackageVersion === version,
		`Zip preflight failed: packaged package.json version ${ packagedPackageVersion } does not match ${ version }.`
	);
	assert(
		packagedPluginVersion === version,
		`Zip preflight failed: packaged plugin header version ${ packagedPluginVersion } does not match ${ version }.`
	);
	assert(
		packagedStableTag === version,
		`Zip preflight failed: packaged Stable tag ${ packagedStableTag } does not match ${ version }.`
	);
	assert(
		packagedTestBlockVersion === version,
		`Zip preflight failed: packaged test block.json version ${ packagedTestBlockVersion } does not match ${ version }.`
	);
	assert(
		packagedVariantBlockVersion === version,
		`Zip preflight failed: packaged variant block.json version ${ packagedVariantBlockVersion } does not match ${ version }.`
	);

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

		const stagedTrunkPluginVersion = readVersionFromPluginHeader(
			fs.readFileSync(
				path.join( staged.trunkDir, 'ab-test-block.php' ),
				'utf8'
			)
		);
		const stagedTrunkStableTag = readStableTag(
			fs.readFileSync(
				path.join( staged.trunkDir, 'readme.txt' ),
				'utf8'
			)
		);
		const stagedTrunkBlockVersion = readJsonVersion(
			fs.readFileSync(
				path.join(
					staged.trunkDir,
					'build',
					'blocks',
					'test',
					'block.json'
				),
				'utf8'
			)
		);
		const stagedTagPluginVersion = readVersionFromPluginHeader(
			fs.readFileSync(
				path.join( staged.tagDir, 'ab-test-block.php' ),
				'utf8'
			)
		);

		assert(
			stagedTrunkPluginVersion === version &&
				stagedTrunkStableTag === version &&
				stagedTrunkBlockVersion === version &&
				stagedTagPluginVersion === version,
			`WordPress.org staging preflight failed: staged payload versions are not fully aligned with ${ version }.`
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
