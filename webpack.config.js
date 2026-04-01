const fs = require( 'fs' );
const path = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );

const STATIC_ARTIFACT_FILENAMES = new Set( [
	'render.php',
	'typia.manifest.json',
	'typia-validator.php',
] );
const ROOT_GENERATED_ARTIFACT_FILENAMES = new Set( [
	...STATIC_ARTIFACT_FILENAMES,
	'typia.schema.json',
	'typia.openapi.json',
] );
const SCRIPT_MODULE_ASSET_FILENAMES = new Set( [
	'interactivity.asset.php',
	'view.asset.php',
] );

function isGeneratedArtifact( filename ) {
	return (
		STATIC_ARTIFACT_FILENAMES.has( filename ) ||
		filename.endsWith( '.openapi.json' ) ||
		filename.endsWith( '.schema.json' )
	);
}

function normalizeScriptModuleAssetSource( source ) {
	return String( source ).replace(
		/'dependencies'\s*=>\s*array\([^)]*\)/,
		"'dependencies' => array()"
	);
}

class TypiaArtifactAssetPlugin {
	apply( compiler ) {
		compiler.hooks.thisCompilation.tap(
			'TypiaArtifactAssetPlugin',
			( compilation ) => {
				compilation.hooks.processAssets.tap(
					{
						name: 'TypiaArtifactAssetPlugin',
						stage: compiler.webpack.Compilation
							.PROCESS_ASSETS_STAGE_ADDITIONS,
					},
					() => {
						for ( const entry of getArtifactEntries() ) {
							if ( compilation.getAsset( entry.outputPath ) ) {
								continue;
							}

							compilation.emitAsset(
								entry.outputPath,
								new compiler.webpack.sources.RawSource(
									fs.readFileSync( entry.inputPath )
								)
							);
						}

						for ( const assetName of SCRIPT_MODULE_ASSET_FILENAMES ) {
							const asset = compilation.getAsset( assetName );
							if ( ! asset ) {
								continue;
							}

							compilation.updateAsset(
								assetName,
								new compiler.webpack.sources.RawSource(
									normalizeScriptModuleAssetSource(
										asset.source.source()
									)
								)
							);
						}
					}
				);
			}
		);

		compiler.hooks.afterEmit.tap(
			'TypiaArtifactAssetPlugin',
			( compilation ) => {
				const outputPath = compilation.outputOptions.path;
				if ( ! outputPath ) {
					return;
				}

				for ( const assetName of SCRIPT_MODULE_ASSET_FILENAMES ) {
					const assetPath = path.join( outputPath, assetName );
					if ( ! fs.existsSync( assetPath ) ) {
						continue;
					}

					fs.writeFileSync(
						assetPath,
						normalizeScriptModuleAssetSource(
							fs.readFileSync( assetPath, 'utf8' )
						)
					);
				}
			}
		);
	}
}

function getArtifactEntries() {
	const entries = [];

	for ( const filename of ROOT_GENERATED_ARTIFACT_FILENAMES ) {
		const rootArtifactPath = path.resolve( process.cwd(), filename );
		if ( fs.existsSync( rootArtifactPath ) ) {
			entries.push( {
				inputPath: rootArtifactPath,
				outputPath: filename,
			} );
		}
	}

	const srcDir = path.resolve( process.cwd(), 'src' );
	if ( ! fs.existsSync( srcDir ) ) {
		return entries;
	}

	for ( const inputPath of findArtifactFiles( srcDir ) ) {
		entries.push( {
			inputPath,
			outputPath: path.relative( srcDir, inputPath ),
		} );
	}

	return entries;
}

function findArtifactFiles( directory ) {
	const artifactFiles = [];

	for ( const entry of fs.readdirSync( directory, {
		withFileTypes: true,
	} ) ) {
		const entryPath = path.join( directory, entry.name );

		if ( entry.isDirectory() ) {
			artifactFiles.push( ...findArtifactFiles( entryPath ) );
			continue;
		}
		if ( entry.isFile() && isGeneratedArtifact( entry.name ) ) {
			artifactFiles.push( entryPath );
		}
	}

	return artifactFiles;
}

function toWebpackConfigs( config ) {
	return Array.isArray( config ) ? config : [ config ];
}

function resolveOptionalEntry( name, candidates ) {
	for ( const candidate of candidates ) {
		const entryPath = path.resolve( process.cwd(), candidate );
		if ( fs.existsSync( entryPath ) ) {
			return [ name, entryPath ];
		}
	}

	return null;
}

function isModuleConfig( config ) {
	return config?.output?.module === true;
}

module.exports = async () => {
	const { default: UnpluginTypia } = await import(
		'@typia/unplugin/webpack'
	);
	const resolvedDefaultConfig =
		typeof defaultConfig === 'function'
			? await defaultConfig()
			: defaultConfig;
	const optionalModuleEntries = Object.fromEntries(
		[
			resolveOptionalEntry( 'interactivity', [
				'src/interactivity.ts',
				'src/interactivity.js',
			] ),
			resolveOptionalEntry( 'view', [ 'src/view.ts', 'src/view.js' ] ),
		].filter( Boolean )
	);
	const configs = toWebpackConfigs( resolvedDefaultConfig ).map(
		( config ) => ( {
			...config,
			entry: async () => ( {
				...( typeof config.entry === 'function'
					? await config.entry()
					: config.entry || {} ),
				...( isModuleConfig( config ) ? optionalModuleEntries : {} ),
			} ),
			plugins: [
				UnpluginTypia(),
				...( config.plugins || [] ),
				new TypiaArtifactAssetPlugin(),
			],
		} )
	);
	return configs.length === 1 ? configs[ 0 ] : configs;
};
