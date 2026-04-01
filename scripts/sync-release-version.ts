/* eslint-disable no-console */
import fs from 'node:fs';

type JsonRecord = Record< string, unknown >;

const ROOT_PACKAGE_JSON = 'package.json';
const VERSION_TARGETS = [
	{
		path: 'src/blocks/test/block.json',
		type: 'json',
	},
	{
		path: 'src/blocks/variant/block.json',
		type: 'json',
	},
	{
		path: 'ab-test-block.php',
		type: 'plugin-header',
	},
	{
		path: 'readme.txt',
		type: 'stable-tag',
	},
] as const;

function readPackageVersion() {
	const packageJson = JSON.parse(
		fs.readFileSync( ROOT_PACKAGE_JSON, 'utf8' )
	) as JsonRecord;
	const version = packageJson.version;

	if ( typeof version !== 'string' || version.length === 0 ) {
		throw new Error( 'package.json is missing a valid version.' );
	}

	return version;
}

function updateJsonVersion( path: string, version: string ) {
	const current = fs.readFileSync( path, 'utf8' );
	const json = JSON.parse( current ) as JsonRecord;
	json.version = version;
	const next = `${ JSON.stringify( json, null, '\t' ) }\n`;

	if ( current === next ) {
		return;
	}

	fs.writeFileSync( path, next );
}

function updatePluginHeaderVersion( path: string, version: string ) {
	const current = fs.readFileSync( path, 'utf8' );
	const next = current.replace( /^( \* Version:\s*).+$/m, `$1${ version }` );

	if ( current === next ) {
		return;
	}

	fs.writeFileSync( path, next );
}

function updateStableTag( path: string, version: string ) {
	const current = fs.readFileSync( path, 'utf8' );
	const next = current.replace( /^(Stable tag:\s*).+$/m, `$1${ version }` );

	if ( current === next ) {
		return;
	}

	fs.writeFileSync( path, next );
}

function main() {
	const version = readPackageVersion();

	for ( const target of VERSION_TARGETS ) {
		switch ( target.type ) {
			case 'json':
				updateJsonVersion( target.path, version );
				break;
			case 'plugin-header':
				updatePluginHeaderVersion( target.path, version );
				break;
			case 'stable-tag':
				updateStableTag( target.path, version );
				break;
			default:
				throw new Error( `Unsupported target type: ${ target }` );
		}
	}

	console.log(
		`✅ Synced release version ${ version } across plugin files.`
	);
}

main();
