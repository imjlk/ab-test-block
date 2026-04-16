/* eslint-disable no-console */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PLUGIN_SLUG = 'ab-test-block';
export const ZIP_PATH = 'ab-test-block.zip';
export const DEFAULT_STAGE_ROOT = path.join(
	'.wordpress-org-dist',
	PLUGIN_SLUG
);

export const PUBLISHABLE_ASSET_MAP = [
	{
		source: path.join( '.wordpress-org', 'banner-772x250.png' ),
		target: 'banner-772x250.png',
	},
	{
		source: path.join( '.wordpress-org', 'icon-256x256.png' ),
		target: 'icon-256x256.png',
	},
	{
		source: path.join( '.wordpress-org', 'screenshot-1.png' ),
		target: 'screenshot-1.png',
	},
	{
		source: path.join( '.wordpress-org', 'screenshot-2.png' ),
		target: 'screenshot-2.png',
	},
	{
		source: path.join( '.wordpress-org', 'blueprints', 'blueprint.json' ),
		target: path.join( 'blueprints', 'blueprint.json' ),
	},
] as const;

type JsonRecord = Record< string, unknown >;

export type ReleaseVersionInfo = {
	packageVersion: string;
	pluginVersion: string;
	stableTag: string;
};

export function getArgValue( flag: string ) {
	const direct = process.argv.find( ( arg ) =>
		arg.startsWith( `${ flag }=` )
	);
	if ( direct ) {
		return direct.slice( flag.length + 1 );
	}

	const index = process.argv.indexOf( flag );
	if ( index >= 0 ) {
		return process.argv[ index + 1 ];
	}

	return undefined;
}

export function ensureDirectory( dirPath: string ) {
	fs.mkdirSync( dirPath, { recursive: true } );
}

export function resetDirectory( dirPath: string ) {
	fs.rmSync( dirPath, { recursive: true, force: true } );
	ensureDirectory( dirPath );
}

function removePath( targetPath: string ) {
	fs.rmSync( targetPath, { recursive: true, force: true } );
}

export function copyDirectory( sourceDir: string, targetDir: string ) {
	ensureDirectory( targetDir );

	for ( const entry of fs.readdirSync( sourceDir, {
		withFileTypes: true,
	} ) ) {
		const sourcePath = path.join( sourceDir, entry.name );
		const targetPath = path.join( targetDir, entry.name );

		if ( entry.isDirectory() ) {
			copyDirectory( sourcePath, targetPath );
			continue;
		}

		if ( entry.isFile() ) {
			ensureDirectory( path.dirname( targetPath ) );
			fs.copyFileSync( sourcePath, targetPath );
		}
	}
}

export function syncDirectory( sourceDir: string, targetDir: string ) {
	ensureDirectory( targetDir );

	const sourceEntries = new Map(
		fs
			.readdirSync( sourceDir, { withFileTypes: true } )
			.map( ( entry ) => [ entry.name, entry ] )
	);
	const targetEntries = new Map(
		fs
			.readdirSync( targetDir, { withFileTypes: true } )
			.map( ( entry ) => [ entry.name, entry ] )
	);

	for ( const [ entryName ] of targetEntries ) {
		if ( ! sourceEntries.has( entryName ) ) {
			removePath( path.join( targetDir, entryName ) );
		}
	}

	for ( const [ entryName, entry ] of sourceEntries ) {
		const sourcePath = path.join( sourceDir, entryName );
		const targetPath = path.join( targetDir, entryName );
		const targetEntry = targetEntries.get( entryName );

		if ( entry.isDirectory() ) {
			if ( targetEntry && ! targetEntry.isDirectory() ) {
				removePath( targetPath );
			}

			syncDirectory( sourcePath, targetPath );
			continue;
		}

		if ( targetEntry && ! targetEntry.isFile() ) {
			removePath( targetPath );
		}

		ensureDirectory( path.dirname( targetPath ) );
		fs.copyFileSync( sourcePath, targetPath );
	}
}

function readPackageVersion() {
	const packageJson = JSON.parse(
		fs.readFileSync( 'package.json', 'utf8' )
	) as JsonRecord;
	const version = packageJson.version;

	if ( typeof version !== 'string' || version.length === 0 ) {
		throw new Error( 'package.json is missing a valid version.' );
	}

	return version;
}

function readPluginVersion() {
	const pluginHeader = fs.readFileSync( 'ab-test-block.php', 'utf8' );
	const version = pluginHeader
		.match( /^ \* Version:\s*(.+)$/m )?.[ 1 ]
		?.trim();

	if ( ! version ) {
		throw new Error(
			'ab-test-block.php is missing a valid plugin header version.'
		);
	}

	return version;
}

function readStableTag() {
	const readme = fs.readFileSync( 'readme.txt', 'utf8' );
	const stableTag = readme.match( /^Stable tag:\s*(.+)$/m )?.[ 1 ]?.trim();

	if ( ! stableTag ) {
		throw new Error( 'readme.txt is missing a valid Stable tag.' );
	}

	return stableTag;
}

export function getReleaseVersionInfo(): ReleaseVersionInfo {
	return {
		packageVersion: readPackageVersion(),
		pluginVersion: readPluginVersion(),
		stableTag: readStableTag(),
	};
}

export function assertReleaseVersionConsistency() {
	const info = getReleaseVersionInfo();

	if (
		info.packageVersion !== info.pluginVersion ||
		info.packageVersion !== info.stableTag
	) {
		throw new Error(
			`Version mismatch detected: package.json=${ info.packageVersion }, ab-test-block.php=${ info.pluginVersion }, readme.txt=${ info.stableTag }`
		);
	}

	return info.packageVersion;
}

export function assertPublishableAssetsExist() {
	for ( const asset of PUBLISHABLE_ASSET_MAP ) {
		if ( ! fs.existsSync( asset.source ) ) {
			throw new Error(
				`Missing WordPress.org asset source: ${ asset.source }`
			);
		}
	}
}

export function assertZipExists() {
	if ( ! fs.existsSync( ZIP_PATH ) ) {
		throw new Error(
			`Missing ${ ZIP_PATH }. Run bun run plugin-zip before WordPress.org staging.`
		);
	}
}

export function listZipEntries() {
	assertZipExists();

	return execFileSync( 'unzip', [ '-Z1', ZIP_PATH ], {
		encoding: 'utf8',
	} )
		.split( /\r?\n/ )
		.map( ( entry ) => entry.trim() )
		.filter( Boolean );
}

function extractZipTo( destinationRoot: string ) {
	resetDirectory( destinationRoot );

	execFileSync(
		'unzip',
		[ '-q', path.resolve( ZIP_PATH ), '-d', destinationRoot ],
		{
			stdio: 'inherit',
		}
	);
}

export function copyPublishableAssets( targetDir: string ) {
	const tempAssetsRoot = fs.mkdtempSync(
		path.join( os.tmpdir(), 'ab-test-block-wordpress-org-assets-' )
	);

	try {
		for ( const asset of PUBLISHABLE_ASSET_MAP ) {
			const targetPath = path.join( tempAssetsRoot, asset.target );
			ensureDirectory( path.dirname( targetPath ) );
			fs.copyFileSync( asset.source, targetPath );
		}

		syncDirectory( tempAssetsRoot, targetDir );
	} finally {
		fs.rmSync( tempAssetsRoot, { recursive: true, force: true } );
	}
}

export function stageWordPressOrgLayout( targetRoot: string ) {
	const version = assertReleaseVersionConsistency();
	assertPublishableAssetsExist();
	assertZipExists();

	const absoluteTargetRoot = path.resolve( targetRoot );
	const tempRoot = fs.mkdtempSync(
		path.join( os.tmpdir(), 'ab-test-block-wordpress-org-' )
	);

	try {
		extractZipTo( tempRoot );

		const extractedPluginRoot = path.join( tempRoot, PLUGIN_SLUG );
		if ( ! fs.existsSync( extractedPluginRoot ) ) {
			throw new Error(
				`Expected extracted plugin root at ${ extractedPluginRoot }`
			);
		}

		const readmeMarkdownPath = path.join(
			extractedPluginRoot,
			'README.md'
		);
		if ( fs.existsSync( readmeMarkdownPath ) ) {
			fs.rmSync( readmeMarkdownPath, { force: true } );
		}

		const trunkDir = path.join( absoluteTargetRoot, 'trunk' );
		const tagDir = path.join( absoluteTargetRoot, 'tags', version );
		const assetsDir = path.join( absoluteTargetRoot, 'assets' );

		syncDirectory( extractedPluginRoot, trunkDir );

		syncDirectory( extractedPluginRoot, tagDir );

		copyPublishableAssets( assetsDir );

		return {
			assetsDir,
			tagDir,
			targetRoot: absoluteTargetRoot,
			trunkDir,
			version,
		};
	} finally {
		fs.rmSync( tempRoot, { recursive: true, force: true } );
	}
}
