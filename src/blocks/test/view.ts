import { getContext, getElement, store } from '@wordpress/interactivity';

import { recordEvent, reevaluateExperiment } from '../../api';
import {
	getVariantKeys,
	normalizeWeights,
	pickWeightedVariant,
	sanitizeWinnerSnapshot,
} from '../../lib/experiment';
import { isVariantKey } from '../../lib/ids';
import type {
	AbTestBrowserEventPayload,
	AbTestBrowserStatsPayload,
	AbTestStatsResponse,
	AbTestViewContext,
	AbTestViewState,
	AssignmentSource,
	BrowserLayerEventName,
	EventType,
	VariantKey,
} from '../../types';

const pendingPageEvents = new Set< string >();
const trackedPageEvents = new Set< string >();
const clickListenerControllers = new WeakMap< HTMLElement, AbortController >();
const impressionObservers = new WeakMap< HTMLElement, IntersectionObserver >();
const impressionTimeouts = new WeakMap< HTMLElement, number >();

const CTA_MARKER_SELECTOR =
	'.abtest-cta, [data-abtest-cta], [data-abtest-cta="true"]';
const CTA_FALLBACK_SELECTOR =
	'a, button, [role="button"], input[type="submit"]';
const VIEWABLE_IMPRESSION_THRESHOLD = 0.5;
const VIEWABLE_IMPRESSION_DWELL_MS = 1000;

const { state } = store( 'abtest-block', {
	state: {
		assignment: undefined,
		assignmentSource: undefined,
		debugLabel: undefined,
		error: undefined,
		isPreview: false,
		isReady: false,
		winner: undefined,
		winnerStatus: 'no-winner',
	} as AbTestViewState,

	callbacks: {
		init() {
			const context = getContext< AbTestViewContext >();
			context.variantKeys = getVariantKeys( context.variantCount );
			context.weights = normalizeWeights(
				context.weights,
				context.variantCount
			);
			context.winnerEvaluation = sanitizeWinnerSnapshot(
				context.winnerEvaluation,
				context.variantCount
			);
			state.winner = context.winnerEvaluation.winner;
			state.winnerStatus = context.winnerEvaluation.status;
		},
		async mounted() {
			const element = getElement().ref;

			if ( ! element ) {
				return;
			}

			const context = getContext< AbTestViewContext >();
			const assignment = resolveAssignment( context );
			state.assignment = assignment.variant;
			state.assignmentSource = assignment.source;
			state.isPreview = assignment.preview;
			state.debugLabel = buildDebugLabel(
				context,
				assignment.variant,
				assignment.source
			);
			state.isReady = true;
			element.dataset.abtestReady = 'true';
			const activeVariantElement = applyVariantVisibility(
				element,
				assignment.variant
			);
			attachClickListener( element, context );
			emitEventOutputs(
				context,
				'abtest:assigned',
				assignment.variant,
				assignment.source,
				assignment.preview
			);

			if (
				assignment.source === 'locked-winner' ||
				assignment.source === 'manual-winner' ||
				assignment.source === 'automatic-winner'
			) {
				emitEventOutputs(
					context,
					'abtest:winner_applied',
					assignment.variant,
					assignment.source,
					assignment.preview
				);
			}

			if (
				context.stickyAssignment &&
				( assignment.source === 'weighted-random' ||
					assignment.source === 'sticky' )
			) {
				persistStickyAssignment( context, assignment.variant );
			}

			if ( context.trackImpressions ) {
				observeViewableImpression(
					activeVariantElement ?? element,
					context,
					assignment.variant,
					assignment.source,
					assignment.preview
				);
			}
		},
	},
} );

function resolveAssignment( context: AbTestViewContext ): {
	preview: boolean;
	source: AssignmentSource;
	variant: VariantKey;
} {
	const previewVariant = resolvePreviewVariant( context );
	if ( previewVariant ) {
		return {
			preview: true,
			source: 'query-preview',
			variant: previewVariant,
		};
	}

	if (
		context.winnerEvaluation.status === 'winner-locked' &&
		context.winnerEvaluation.winner
	) {
		return {
			preview: false,
			source: 'locked-winner',
			variant: context.winnerEvaluation.winner,
		};
	}

	if ( context.winnerMode === 'manual' && context.manualWinner ) {
		return {
			preview: false,
			source: 'manual-winner',
			variant: context.manualWinner,
		};
	}

	if (
		context.winnerEvaluation.status === 'candidate' &&
		context.winnerEvaluation.winner
	) {
		return {
			preview: false,
			source: 'automatic-winner',
			variant: context.winnerEvaluation.winner,
		};
	}

	const stickyVariant = getStickyAssignment( context );
	if ( stickyVariant ) {
		return {
			preview: false,
			source: 'sticky',
			variant: stickyVariant,
		};
	}

	return {
		preview: false,
		source: 'weighted-random',
		variant: pickWeightedVariant( context.weights, context.variantCount ),
	};
}

function resolvePreviewVariant(
	context: AbTestViewContext
): VariantKey | undefined {
	if ( typeof window === 'undefined' ) {
		return undefined;
	}

	const searchParams = new URLSearchParams( window.location.search );
	const globalPreview = searchParams.get( 'abtest' );
	if ( globalPreview ) {
		const [ experimentId, variant ] = globalPreview.split( ':' );
		if (
			experimentId === context.experimentId &&
			isVariantKey( variant ) &&
			context.variantKeys.includes( variant )
		) {
			return variant;
		}
	}

	const scopedPreview = searchParams.get( context.previewQueryKey );
	if (
		isVariantKey( scopedPreview ) &&
		context.variantKeys.includes( scopedPreview )
	) {
		return scopedPreview;
	}

	return undefined;
}

function getStickyAssignment(
	context: AbTestViewContext
): VariantKey | undefined {
	if ( typeof window === 'undefined' || ! context.stickyStorageKey ) {
		return undefined;
	}

	try {
		const storedValue = window.localStorage.getItem(
			context.stickyStorageKey
		);
		if (
			isVariantKey( storedValue ) &&
			context.variantKeys.includes( storedValue )
		) {
			return storedValue;
		}
	} catch ( error ) {
		void error;
	}

	return undefined;
}

function persistStickyAssignment(
	context: AbTestViewContext,
	variant: VariantKey
) {
	if ( typeof window === 'undefined' || ! context.stickyStorageKey ) {
		return;
	}

	try {
		window.localStorage.setItem( context.stickyStorageKey, variant );
	} catch ( error ) {
		void error;
	}
}

function applyVariantVisibility(
	element: HTMLElement,
	activeVariant: VariantKey
): HTMLElement | undefined {
	const variantElements = Array.from(
		element.querySelectorAll< HTMLElement >( '[data-abtest-variant]' )
	);
	let activeVariantElement: HTMLElement | undefined;

	variantElements.forEach( ( variantElement ) => {
		const variantKey = variantElement.dataset.abtestVariant;
		const isActive = variantKey === activeVariant;

		if ( isActive ) {
			activeVariantElement = variantElement;
		}

		variantElement.hidden = ! isActive;
		variantElement.setAttribute( 'aria-hidden', String( ! isActive ) );
		variantElement.dataset.abtestActive = isActive ? 'true' : 'false';
	} );

	return activeVariantElement;
}

async function maybeTrackClick( event: Event, context: AbTestViewContext ) {
	const pageViewKey = getPageViewEventKey( context.blockInstanceId, 'click' );

	if (
		! context.trackClicks ||
		! state.assignment ||
		state.isPreview ||
		hasTrackedOrPendingPageEvent( pageViewKey )
	) {
		return;
	}

	const target = event.target;
	if ( ! ( target instanceof HTMLElement ) ) {
		return;
	}

	const activeVariant = state.assignment;
	const variantContainer = target.closest< HTMLElement >(
		'[data-abtest-variant]'
	);
	const trigger = variantContainer
		? findPrimaryCtaTrigger( target, variantContainer )
		: undefined;

	if (
		! variantContainer ||
		! trigger ||
		variantContainer.dataset.abtestVariant !== activeVariant
	) {
		return;
	}

	await trackEvent(
		context,
		activeVariant,
		state.assignmentSource ?? 'weighted-random',
		'click',
		false
	);
}

async function trackEvent(
	context: AbTestViewContext,
	variant: VariantKey,
	source: AssignmentSource,
	eventType: EventType,
	preview: boolean
) {
	if ( preview ) {
		return;
	}

	const pageViewKey = getPageViewEventKey(
		context.blockInstanceId,
		eventType
	);
	if ( hasTrackedOrPendingPageEvent( pageViewKey ) ) {
		return;
	}

	pendingPageEvents.add( pageViewKey );

	try {
		const result = await recordEvent(
			{
				blockInstanceId: context.blockInstanceId,
				evaluationWindowDays: context.evaluationWindowDays,
				eventType,
				experimentId: context.experimentId,
				postId: context.postId,
				preview: false,
				publicWriteToken:
					typeof context.publicWriteToken === 'string' &&
					context.publicWriteToken.length > 0
						? context.publicWriteToken
						: undefined,
				source,
				timestamp: Math.floor( Date.now() / 1000 ),
				variantCount: context.variantCount,
				variant,
			},
			context.restNonce
		);

		if ( ! result.isValid || ! result.data ) {
			pendingPageEvents.delete( pageViewKey );
			state.error =
				result.errors[ 0 ]?.expected ?? 'Unable to record event.';
			return;
		}

		if ( ! result.data.counted ) {
			pendingPageEvents.delete( pageViewKey );
			return;
		}

		pendingPageEvents.delete( pageViewKey );
		trackedPageEvents.add( pageViewKey );

		emitEventOutputs(
			context,
			toEventName( eventType ),
			variant,
			source,
			preview,
			eventType
		);
		if ( result.data.stats ) {
			emitStatsOutputs(
				context,
				variant,
				source,
				preview,
				eventType,
				result.data.stats
			);
		}

		if (
			eventType === 'impression' &&
			context.winnerMode === 'automatic' &&
			context.winnerEvaluation.status !== 'winner-locked'
		) {
			await reevaluateWinnerState( context, variant, source );
		}
	} catch ( error ) {
		pendingPageEvents.delete( pageViewKey );
		state.error =
			error instanceof Error ? error.message : 'Unknown tracking error.';
	}
}

function observeViewableImpression(
	element: HTMLElement,
	context: AbTestViewContext,
	variant: VariantKey,
	source: AssignmentSource,
	preview: boolean
) {
	const pageViewKey = getPageViewEventKey(
		context.blockInstanceId,
		'impression'
	);

	clearImpressionObservation( element );

	if (
		preview ||
		hasTrackedOrPendingPageEvent( pageViewKey ) ||
		typeof window === 'undefined'
	) {
		return;
	}

	if ( typeof window.IntersectionObserver !== 'function' ) {
		void trackEvent( context, variant, source, 'impression', preview );
		return;
	}

	let isViewable = false;

	const startDwellTimer = () => {
		if ( impressionTimeouts.has( element ) ) {
			return;
		}

		const timeoutId = window.setTimeout( async () => {
			impressionTimeouts.delete( element );

			if ( ! isViewable ) {
				return;
			}

			await trackEvent( context, variant, source, 'impression', preview );

			if ( trackedPageEvents.has( pageViewKey ) ) {
				clearImpressionObservation( element );
			}
		}, VIEWABLE_IMPRESSION_DWELL_MS );

		impressionTimeouts.set( element, timeoutId );
	};

	const stopDwellTimer = () => {
		const timeoutId = impressionTimeouts.get( element );

		if ( typeof timeoutId === 'number' ) {
			window.clearTimeout( timeoutId );
			impressionTimeouts.delete( element );
		}
	};

	const observer = new window.IntersectionObserver(
		( entries ) => {
			const entry = entries[ 0 ];

			if ( hasTrackedOrPendingPageEvent( pageViewKey ) ) {
				clearImpressionObservation( element );
				return;
			}

			isViewable = Boolean(
				entry?.isIntersecting &&
					entry.intersectionRatio >= VIEWABLE_IMPRESSION_THRESHOLD
			);

			if ( isViewable ) {
				startDwellTimer();
				return;
			}

			stopDwellTimer();
		},
		{
			threshold: [ 0, VIEWABLE_IMPRESSION_THRESHOLD, 1 ],
		}
	);

	impressionObservers.set( element, observer );
	observer.observe( element );
}

async function reevaluateWinnerState(
	context: AbTestViewContext,
	variant: VariantKey,
	source: AssignmentSource
) {
	try {
		const previousWinner = context.winnerEvaluation.winner;
		const previousStatus = context.winnerEvaluation.status;
		const result = await reevaluateExperiment(
			{
				blockInstanceId: context.blockInstanceId,
				evaluationWindowDays: context.winnerEvaluation.windowDays,
				experimentId: context.experimentId,
				lockWinnerAfterSelection: context.lockWinnerAfterSelection,
				metric: context.automaticMetric,
				minimumClicksPerVariant: context.minimumClicksPerVariant,
				minimumImpressionsPerVariant:
					context.minimumImpressionsPerVariant,
				postId: context.postId,
				publicWriteToken:
					typeof context.publicWriteToken === 'string' &&
					context.publicWriteToken.length > 0
						? context.publicWriteToken
						: undefined,
				variantCount: context.variantCount,
			},
			context.restNonce
		);

		if ( ! result.isValid || ! result.data ) {
			return;
		}

		context.winnerEvaluation = {
			evaluatedAt: result.data.evaluatedAt,
			lockedAt: result.data.lockedAt,
			metric: result.data.metric,
			status: result.data.status,
			variants: result.data.variants.map( ( aggregate ) => ( {
				clicks: aggregate.clicks,
				ctr: aggregate.ctr,
				impressions: aggregate.impressions,
				variantKey: aggregate.variant,
			} ) ),
			winner: result.data.winner,
			windowDays: context.winnerEvaluation.windowDays,
		};
		state.winner = result.data.winner;
		state.winnerStatus = result.data.status;

		if (
			previousWinner !== result.data.winner ||
			previousStatus !== result.data.status
		) {
			emitEventOutputs(
				context,
				'abtest:winner_changed',
				result.data.winner ?? variant,
				source,
				false
			);
		}
	} catch ( error ) {
		void error;
	}
}

function emitEventOutputs(
	context: AbTestViewContext,
	eventName: BrowserLayerEventName,
	variant: VariantKey,
	source: AssignmentSource,
	preview: boolean,
	eventType?: EventType
) {
	const payload: AbTestBrowserEventPayload = {
		blockInstanceId: context.blockInstanceId,
		eventType,
		experimentId: context.experimentId,
		postId: context.postId,
		preview,
		source,
		timestamp: Math.floor( Date.now() / 1000 ),
		variant,
		variantCount: context.variantCount,
		weights: context.weights,
		winner: context.winnerEvaluation.winner,
		winnerMode: context.winnerMode,
	};

	if ( context.emitBrowserEvents && typeof window !== 'undefined' ) {
		window.dispatchEvent(
			new CustomEvent( eventName, { detail: payload } )
		);
	}

	if ( context.emitKexpLayer && typeof window !== 'undefined' ) {
		const kexpLayer = (
			window as Window & {
				kexpLayer?: Array< unknown >;
			}
		 ).kexpLayer;
		if ( Array.isArray( kexpLayer ) ) {
			kexpLayer.push( payload );
		}
	}

	if ( context.emitDataLayer && typeof window !== 'undefined' ) {
		const dataLayer = (
			window as Window & {
				dataLayer?: Array< unknown >;
			}
		 ).dataLayer;
		if ( Array.isArray( dataLayer ) ) {
			dataLayer.push( {
				...payload,
				event: eventName.replace( ':', '_' ),
			} );
		}
	}

	if (
		context.emitClarityHook &&
		typeof window !== 'undefined' &&
		typeof (
			window as unknown as Window & {
				clarity?: (
					command: string,
					key: string,
					value: string
				) => void;
			}
		 ).clarity === 'function'
	) {
		(
			window as unknown as Window & {
				clarity: (
					command: string,
					key: string,
					value: string
				) => void;
			}
		 ).clarity( 'set', `abtest_${ context.experimentId }`, variant );
	}
}

function emitStatsOutputs(
	context: AbTestViewContext,
	variant: VariantKey,
	source: AssignmentSource,
	preview: boolean,
	eventType: EventType,
	stats: AbTestStatsResponse
) {
	const payload: AbTestBrowserStatsPayload = {
		blockInstanceId: context.blockInstanceId,
		eventType,
		experimentId: context.experimentId,
		postId: context.postId,
		preview,
		source,
		stats,
		timestamp: Math.floor( Date.now() / 1000 ),
		variant,
		variantCount: context.variantCount,
		weights: context.weights,
		winner: context.winnerEvaluation.winner,
		winnerMode: context.winnerMode,
	};

	if ( context.emitBrowserEvents && typeof window !== 'undefined' ) {
		window.dispatchEvent(
			new CustomEvent( 'abtest:stats', { detail: payload } )
		);
	}

	if ( context.emitKexpLayer && typeof window !== 'undefined' ) {
		const kexpLayer = (
			window as Window & {
				kexpLayer?: Array< unknown >;
			}
		 ).kexpLayer;
		if ( Array.isArray( kexpLayer ) ) {
			kexpLayer.push( payload );
		}
	}

	if ( context.emitDataLayer && typeof window !== 'undefined' ) {
		const dataLayer = (
			window as Window & {
				dataLayer?: Array< unknown >;
			}
		 ).dataLayer;
		if ( Array.isArray( dataLayer ) ) {
			dataLayer.push( {
				...payload,
				event: 'abtest_stats',
			} );
		}
	}
}

function buildDebugLabel(
	context: AbTestViewContext,
	variant: VariantKey,
	source: AssignmentSource
) {
	return `${
		context.experimentId
	}: Variant ${ variant.toUpperCase() } (${ source })`;
}

function attachClickListener(
	element: HTMLElement,
	context: AbTestViewContext
) {
	const currentController = clickListenerControllers.get( element );

	if ( currentController ) {
		currentController.abort();
	}

	const nextController = new AbortController();
	clickListenerControllers.set( element, nextController );
	element.addEventListener(
		'click',
		( event ) => {
			void maybeTrackClick( event, context );
		},
		{ signal: nextController.signal }
	);
}

function clearImpressionObservation( element: HTMLElement ) {
	const observer = impressionObservers.get( element );

	if ( observer ) {
		observer.disconnect();
		impressionObservers.delete( element );
	}

	const timeoutId = impressionTimeouts.get( element );

	if ( typeof timeoutId === 'number' && typeof window !== 'undefined' ) {
		window.clearTimeout( timeoutId );
		impressionTimeouts.delete( element );
	}
}

function hasTrackedOrPendingPageEvent( pageViewKey: string ) {
	return (
		trackedPageEvents.has( pageViewKey ) ||
		pendingPageEvents.has( pageViewKey )
	);
}

function findPrimaryCtaTrigger(
	target: HTMLElement,
	variantContainer: HTMLElement
) {
	const selector = variantContainer.querySelector( CTA_MARKER_SELECTOR )
		? CTA_MARKER_SELECTOR
		: CTA_FALLBACK_SELECTOR;
	const trigger = target.closest< HTMLElement >( selector );

	if ( ! trigger || ! variantContainer.contains( trigger ) ) {
		return undefined;
	}

	return trigger;
}

function toEventName( eventType: EventType ): BrowserLayerEventName {
	return eventType === 'click' ? 'abtest:click' : 'abtest:impression';
}

function getPageViewEventKey( blockInstanceId: string, eventType: EventType ) {
	const currentPath =
		typeof window === 'undefined'
			? 'server'
			: `${ window.location.pathname }${ window.location.search }`;

	return `${ blockInstanceId }:${ currentPath }:${ eventType }`;
}
