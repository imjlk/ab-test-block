import {
	callEndpoint,
	createEndpoint,
	resolveRestRouteUrl,
} from '@wp-typia/rest';

import {
	type AbTestBlockRecordEventRequest,
	type AbTestBlockRecordEventResponse,
	type AbTestBlockReevaluateRequest,
	type AbTestBlockReevaluateResponse,
	type AbTestBlockStatsRequest,
	type AbTestBlockStatsResponse,
} from './api-types';
import { apiValidators } from './api-validators';

const EVENT_PATH = '/abtest-block/v1/event';
const REEVALUATE_PATH = '/abtest-block/v1/reevaluate';
const STATS_PATH = '/abtest-block/v1/stats';

function resolveRestNonce( fallback?: string ): string | undefined {
	if ( typeof fallback === 'string' && fallback.length > 0 ) {
		return fallback;
	}

	const wpApiSettings = (
		window as typeof window & {
			wpApiSettings?: { nonce?: string };
		}
	 ).wpApiSettings;

	return typeof wpApiSettings?.nonce === 'string' &&
		wpApiSettings.nonce.length > 0
		? wpApiSettings.nonce
		: undefined;
}

export const recordEventEndpoint = createEndpoint<
	AbTestBlockRecordEventRequest,
	AbTestBlockRecordEventResponse
>( {
	buildRequestOptions: () => ( {
		url: resolveRestRouteUrl( EVENT_PATH ),
	} ),
	method: 'POST',
	path: EVENT_PATH,
	validateRequest: apiValidators.recordEventRequest,
	validateResponse: apiValidators.recordEventResponse,
} );

export const reevaluateExperimentEndpoint = createEndpoint<
	AbTestBlockReevaluateRequest,
	AbTestBlockReevaluateResponse
>( {
	buildRequestOptions: () => ( {
		url: resolveRestRouteUrl( REEVALUATE_PATH ),
	} ),
	method: 'POST',
	path: REEVALUATE_PATH,
	validateRequest: apiValidators.reevaluateRequest,
	validateResponse: apiValidators.reevaluateResponse,
} );

export const statsEndpoint = createEndpoint<
	AbTestBlockStatsRequest,
	AbTestBlockStatsResponse
>( {
	buildRequestOptions: () => ( {
		url: resolveRestRouteUrl( STATS_PATH ),
	} ),
	method: 'GET',
	path: STATS_PATH,
	validateRequest: apiValidators.statsRequest,
	validateResponse: apiValidators.statsResponse,
} );

export function recordEvent(
	request: AbTestBlockRecordEventRequest,
	restNonce?: string
) {
	const nonce = resolveRestNonce( restNonce );

	return callEndpoint( recordEventEndpoint, request, {
		requestOptions: nonce
			? {
					headers: {
						'X-WP-Nonce': nonce,
					},
			  }
			: undefined,
	} );
}

export function reevaluateExperiment(
	request: AbTestBlockReevaluateRequest,
	restNonce?: string
) {
	const nonce = resolveRestNonce( restNonce );

	return callEndpoint( reevaluateExperimentEndpoint, request, {
		requestOptions: nonce
			? {
					headers: {
						'X-WP-Nonce': nonce,
					},
			  }
			: undefined,
	} );
}

export function fetchStats(
	request: AbTestBlockStatsRequest,
	restNonce?: string
) {
	const nonce = resolveRestNonce( restNonce );

	return callEndpoint( statsEndpoint, request, {
		requestOptions: nonce
			? {
					headers: {
						'X-WP-Nonce': nonce,
					},
			  }
			: undefined,
	} );
}
