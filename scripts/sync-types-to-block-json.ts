/* eslint-disable no-console */
import fs from 'node:fs';

import { syncBlockMetadata } from '@wp-typia/create/metadata-core';

import {
	getCanonicalExperimentExample,
	getCanonicalVariantExample,
} from './canonical-demo';

async function main() {
	const blocks = [
		{
			blockJsonFile: 'src/blocks/test/block.json',
			jsonSchemaFile: 'src/blocks/test/typia.schema.json',
			manifestFile: 'src/blocks/test/typia.manifest.json',
			openApiFile: 'src/blocks/test/typia.openapi.json',
			sourceTypeName: 'AbTestExperimentAttributes',
		},
		{
			blockJsonFile: 'src/blocks/variant/block.json',
			jsonSchemaFile: 'src/blocks/variant/typia.schema.json',
			manifestFile: 'src/blocks/variant/typia.manifest.json',
			openApiFile: 'src/blocks/variant/typia.openapi.json',
			sourceTypeName: 'AbTestVariantAttributes',
		},
	] as const;

	for ( const block of blocks ) {
		const previousMetadata = JSON.parse(
			fs.readFileSync( block.blockJsonFile, 'utf8' )
		) as Record< string, unknown >;
		const result = await syncBlockMetadata( {
			...block,
			typesFile: 'src/types.ts',
		} );
		const nextMetadata = JSON.parse(
			fs.readFileSync( block.blockJsonFile, 'utf8' )
		) as Record< string, unknown >;

		if ( block.sourceTypeName === 'AbTestExperimentAttributes' ) {
			nextMetadata.example = getCanonicalExperimentExample();
		} else if ( block.sourceTypeName === 'AbTestVariantAttributes' ) {
			nextMetadata.example = getCanonicalVariantExample();
		} else if ( 'example' in previousMetadata ) {
			nextMetadata.example = previousMetadata.example;
		}

		fs.writeFileSync(
			block.blockJsonFile,
			`${ JSON.stringify( nextMetadata, null, '\t' ) }\n`
		);

		console.log(
			`✅ Generated block metadata for ${ block.sourceTypeName }`
		);
		console.log( '📝 Generated attributes:', result.attributeNames );

		if ( result.lossyProjectionWarnings.length > 0 ) {
			console.warn(
				'⚠️ Some Typia constraints were preserved only in typia.manifest.json:'
			);
			for ( const warning of result.lossyProjectionWarnings ) {
				console.warn( `   - ${ warning }` );
			}
		}

		if ( result.phpGenerationWarnings.length > 0 ) {
			console.warn(
				'⚠️ Some Typia constraints are not yet enforced by typia-validator.php:'
			);
			for ( const warning of result.phpGenerationWarnings ) {
				console.warn( `   - ${ warning }` );
			}
		}
	}
}

main().catch( ( error ) => {
	console.error( '❌ Type sync failed:', error );
	process.exit( 1 );
} );
