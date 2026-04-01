/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = '.wordpress-org';
const DEFAULT_TARGET_DIR = '.wordpress-org-dist/assets';

function getArgValue( flag: string ) {
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

function ensureDirectory( dirPath: string ) {
	fs.mkdirSync( dirPath, { recursive: true } );
}

function copyDirectory( sourceDir: string, targetDir: string ) {
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

function main() {
	const targetDir = getArgValue( '--target' ) ?? DEFAULT_TARGET_DIR;

	if ( ! fs.existsSync( SOURCE_DIR ) ) {
		throw new Error( `${ SOURCE_DIR } does not exist.` );
	}

	copyDirectory( SOURCE_DIR, targetDir );

	console.log(
		`✅ Copied ${ SOURCE_DIR } into WordPress.org assets layout at ${ targetDir }`
	);
}

main();
