import {
	callEndpoint,
	createEndpoint,
	resolveRestRouteUrl,
} from '@wp-typia/rest';

import {
	type AbTestBlockCounterQuery,
	type AbTestBlockCounterResponse,
	type AbTestBlockIncrementRequest,
} from './api-types';
import { apiValidators } from './api-validators';

const COUNTER_PATH = '/create-block/v1/ab-test-block/counter';

function resolveRestNonce( fallback?: string ): string | undefined {
	if ( typeof fallback === 'string' && fallback.length > 0 ) {
		return fallback;
	}

	const wpApiSettings = ( window as typeof window & {
		wpApiSettings?: { nonce?: string };
	} ).wpApiSettings;

	return typeof wpApiSettings?.nonce === 'string' && wpApiSettings.nonce.length > 0
		? wpApiSettings.nonce
		: undefined;
}

export const counterEndpoint = createEndpoint<
	AbTestBlockCounterQuery,
	AbTestBlockCounterResponse
>( {
	buildRequestOptions: () => ( {
		url: resolveRestRouteUrl( COUNTER_PATH ),
	} ),
	method: 'GET',
	path: COUNTER_PATH,
	validateRequest: apiValidators.counterQuery,
	validateResponse: apiValidators.counterResponse,
} );

export const incrementCounterEndpoint = createEndpoint<
	AbTestBlockIncrementRequest,
	AbTestBlockCounterResponse
>( {
	buildRequestOptions: () => ( {
		url: resolveRestRouteUrl( COUNTER_PATH ),
	} ),
	method: 'POST',
	path: COUNTER_PATH,
	validateRequest: apiValidators.incrementRequest,
	validateResponse: apiValidators.counterResponse,
} );

export function fetchCounter(
	request: AbTestBlockCounterQuery
) {
	return callEndpoint( counterEndpoint, request );
}

export function incrementCounter(
	request: AbTestBlockIncrementRequest,
	restNonce?: string
) {
	const nonce = resolveRestNonce( restNonce );

	return callEndpoint( incrementCounterEndpoint, request, {
		requestOptions: nonce
			? {
					headers: {
						'X-WP-Nonce': nonce,
					},
				}
			: undefined,
	} );
}
