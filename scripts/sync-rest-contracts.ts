/* eslint-disable no-console */
import { syncTypeSchemas } from '@wp-typia/create/metadata-core';

const CONTRACTS = [
	{
		baseName: 'counter-query',
		sourceTypeName: 'AbTestBlockCounterQuery',
	},
	{
		baseName: 'increment-request',
		sourceTypeName: 'AbTestBlockIncrementRequest',
	},
	{
		baseName: 'counter-response',
		sourceTypeName: 'AbTestBlockCounterResponse',
	},
] as const;

async function main() {
	for ( const contract of CONTRACTS ) {
		await syncTypeSchemas( {
			jsonSchemaFile: `src/api-schemas/${ contract.baseName }.schema.json`,
			openApiFile: `src/api-schemas/${ contract.baseName }.openapi.json`,
			openApiInfo: {
				title: `${ contract.sourceTypeName }`,
				version: '1.0.0',
			},
			sourceTypeName: contract.sourceTypeName,
			typesFile: 'src/api-types.ts',
		} );
	}

	console.log( '✅ REST schemas and OpenAPI documents were generated from TypeScript contracts!' );
}

main().catch( ( error ) => {
	console.error( '❌ REST contract sync failed:', error );
	process.exit( 1 );
} );
