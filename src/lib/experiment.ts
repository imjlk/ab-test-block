import type {
	AbTestExperimentAttributes,
	AbTestTrafficWeights,
	AbTestWinnerEvaluationSnapshot,
	VariantCount,
	VariantKey,
	WinnerLifecycleState,
	WinnerMode,
} from '../types';
import {
	createDefaultVariantAttributes,
	createDefaultWinnerSnapshot,
	DEFAULT_EXPERIMENT_ATTRIBUTES,
	DEFAULT_EXPERIMENT_LABEL,
} from './defaults';
import {
	generateBlockInstanceId,
	generateExperimentId,
	isVariantKey,
} from './ids';

export const VARIANT_KEYS: VariantKey[] = [ 'a', 'b', 'c' ];

export function getVariantKeys( variantCount: VariantCount ): VariantKey[] {
	return VARIANT_KEYS.slice( 0, variantCount );
}

export function getVariantLabel( variantKey: VariantKey ): string {
	return createDefaultVariantAttributes( variantKey ).variantLabel;
}

export function clampWeight( value: number ): number {
	if ( Number.isNaN( value ) ) {
		return 0;
	}

	return Math.max( 0, Math.min( 100, Math.round( value ) ) );
}

export function sumWeights(
	weights: Partial< AbTestTrafficWeights >,
	variantCount: VariantCount
): number {
	return getVariantKeys( variantCount ).reduce(
		( total, key ) => total + clampWeight( Number( weights[ key ] ?? 0 ) ),
		0
	);
}

export function equalizeWeights(
	variantCount: VariantCount
): AbTestTrafficWeights {
	const keys = getVariantKeys( variantCount );
	const base = Math.floor( 100 / keys.length );
	let remainder = 100 - base * keys.length;
	const weights: AbTestTrafficWeights = {
		a: 0,
		b: 0,
	};

	keys.forEach( ( key ) => {
		const nextValue = base + ( remainder > 0 ? 1 : 0 );
		weights[ key ] = nextValue;
		remainder = Math.max( 0, remainder - 1 );
	} );

	if ( variantCount === 2 ) {
		delete weights.c;
	}

	return weights;
}

export function normalizeWeights(
	weights: Partial< AbTestTrafficWeights >,
	variantCount: VariantCount
): AbTestTrafficWeights {
	const keys = getVariantKeys( variantCount );
	const clamped = keys.map( ( key ) => ( {
		key,
		value: clampWeight( Number( weights[ key ] ?? 0 ) ),
	} ) );
	const total = clamped.reduce( ( sum, item ) => sum + item.value, 0 );

	if ( total <= 0 ) {
		return equalizeWeights( variantCount );
	}

	const scaled = clamped.map( ( item ) => {
		const raw = ( item.value / total ) * 100;
		return {
			fraction: raw - Math.floor( raw ),
			key: item.key,
			value: Math.floor( raw ),
		};
	} );

	let remainder = 100 - scaled.reduce( ( sum, item ) => sum + item.value, 0 );

	scaled
		.sort( ( left, right ) => {
			if ( right.fraction === left.fraction ) {
				return keys.indexOf( left.key ) - keys.indexOf( right.key );
			}
			return right.fraction - left.fraction;
		} )
		.forEach( ( item ) => {
			if ( remainder <= 0 ) {
				return;
			}

			item.value += 1;
			remainder -= 1;
		} );

	const normalized: AbTestTrafficWeights = {
		a: 0,
		b: 0,
	};

	keys.forEach( ( key ) => {
		const match = scaled.find( ( item ) => item.key === key );
		normalized[ key ] = match?.value ?? 0;
	} );

	if ( variantCount === 2 ) {
		delete normalized.c;
	}

	return normalized;
}

export function pickWeightedVariant(
	weights: Partial< AbTestTrafficWeights >,
	variantCount: VariantCount,
	randomValue = Math.random()
): VariantKey {
	const normalized = normalizeWeights( weights, variantCount );
	const keys = getVariantKeys( variantCount );
	let cursor = 0;
	const roll = Math.max( 0, Math.min( 0.999999, randomValue ) ) * 100;

	for ( const key of keys ) {
		cursor += normalized[ key ] ?? 0;
		if ( roll < cursor ) {
			return key;
		}
	}

	return keys[ keys.length - 1 ];
}

export function sanitizeExperimentAttributes(
	attributes: Partial< AbTestExperimentAttributes >
): AbTestExperimentAttributes {
	const variantCount: VariantCount =
		attributes.variantCount === 3
			? 3
			: DEFAULT_EXPERIMENT_ATTRIBUTES.variantCount;
	const blockInstanceId =
		typeof attributes.blockInstanceId === 'string' &&
		attributes.blockInstanceId.length >= 8
			? attributes.blockInstanceId
			: generateBlockInstanceId();

	const experimentId =
		typeof attributes.experimentId === 'string' &&
		attributes.experimentId.trim().length > 0 &&
		attributes.experimentId.trim() !== 'experiment'
			? attributes.experimentId.trim()
			: generateExperimentId( blockInstanceId );
	const experimentLabel =
		typeof attributes.experimentLabel === 'string' &&
		attributes.experimentLabel.trim().length > 0
			? attributes.experimentLabel.trim().slice( 0, 120 )
			: DEFAULT_EXPERIMENT_LABEL;

	const previewQueryKey =
		typeof attributes.previewQueryKey === 'string' &&
		attributes.previewQueryKey.trim().length > 0
			? attributes.previewQueryKey.trim()
			: `ab_${ experimentId
					.replace( /[^a-z0-9_]+/gi, '_' )
					.toLowerCase() }`;

	const rawWeights = sanitizeWeights(
		attributes.weights ?? DEFAULT_EXPERIMENT_ATTRIBUTES.weights,
		variantCount
	);
	const fallbackWinner = getVariantKeys( variantCount )[ 0 ];
	const manualWinner =
		isVariantKey( attributes.manualWinner ) &&
		getVariantKeys( variantCount ).includes( attributes.manualWinner )
			? attributes.manualWinner
			: undefined;
	const winnerMode: WinnerMode =
		attributes.winnerMode === 'manual' ||
		attributes.winnerMode === 'automatic'
			? attributes.winnerMode
			: DEFAULT_EXPERIMENT_ATTRIBUTES.winnerMode;

	return {
		...DEFAULT_EXPERIMENT_ATTRIBUTES,
		...attributes,
		automaticMetric: DEFAULT_EXPERIMENT_ATTRIBUTES.automaticMetric,
		blockInstanceId,
		evaluationWindowDays: clampInteger(
			attributes.evaluationWindowDays,
			1,
			365,
			DEFAULT_EXPERIMENT_ATTRIBUTES.evaluationWindowDays
		),
		experimentId,
		experimentLabel,
		lockWinnerAfterSelection:
			typeof attributes.lockWinnerAfterSelection === 'boolean'
				? attributes.lockWinnerAfterSelection
				: DEFAULT_EXPERIMENT_ATTRIBUTES.lockWinnerAfterSelection,
		manualWinner:
			winnerMode === 'manual'
				? manualWinner ?? fallbackWinner
				: undefined,
		minimumClicksPerVariant: clampInteger(
			attributes.minimumClicksPerVariant,
			0,
			1000000,
			DEFAULT_EXPERIMENT_ATTRIBUTES.minimumClicksPerVariant
		),
		minimumImpressionsPerVariant: clampInteger(
			attributes.minimumImpressionsPerVariant,
			0,
			100000000,
			DEFAULT_EXPERIMENT_ATTRIBUTES.minimumImpressionsPerVariant
		),
		previewQueryKey,
		stickyAssignment:
			typeof attributes.stickyAssignment === 'boolean'
				? attributes.stickyAssignment
				: DEFAULT_EXPERIMENT_ATTRIBUTES.stickyAssignment,
		stickyScope:
			attributes.stickyScope === 'experiment'
				? 'experiment'
				: DEFAULT_EXPERIMENT_ATTRIBUTES.stickyScope,
		trackClicks:
			typeof attributes.trackClicks === 'boolean'
				? attributes.trackClicks
				: DEFAULT_EXPERIMENT_ATTRIBUTES.trackClicks,
		trackImpressions:
			typeof attributes.trackImpressions === 'boolean'
				? attributes.trackImpressions
				: DEFAULT_EXPERIMENT_ATTRIBUTES.trackImpressions,
		variantCount,
		weights: rawWeights,
		winnerMode,
	};
}

export function validateExperimentAttributes(
	attributes: AbTestExperimentAttributes
): string[] {
	const errors: string[] = [];
	const variantKeys = getVariantKeys( attributes.variantCount );

	if ( sumWeights( attributes.weights, attributes.variantCount ) !== 100 ) {
		errors.push( 'Traffic allocation weights must sum to 100.' );
	}

	if (
		attributes.winnerMode === 'manual' &&
		( ! attributes.manualWinner ||
			! variantKeys.includes( attributes.manualWinner ) )
	) {
		errors.push( 'Manual winner must match one of the active variants.' );
	}

	if ( attributes.previewQueryKey.trim().length < 1 ) {
		errors.push( 'Preview query key is required.' );
	}

	if ( attributes.blockInstanceId.trim().length < 8 ) {
		errors.push( 'Block instance ID must be at least 8 characters.' );
	}

	return errors;
}

export function sanitizeWinnerSnapshot(
	snapshot: Partial< AbTestWinnerEvaluationSnapshot > | undefined,
	variantCount: VariantCount
): AbTestWinnerEvaluationSnapshot {
	const normalized = createDefaultWinnerSnapshot();
	const variantKeys = getVariantKeys( variantCount );
	const status: WinnerLifecycleState =
		snapshot?.status === 'candidate' || snapshot?.status === 'winner-locked'
			? snapshot.status
			: normalized.status;
	const winner =
		isVariantKey( snapshot?.winner ) &&
		variantKeys.includes( snapshot.winner )
			? snapshot.winner
			: undefined;

	return {
		evaluatedAt:
			typeof snapshot?.evaluatedAt === 'number'
				? snapshot.evaluatedAt
				: undefined,
		lockedAt:
			typeof snapshot?.lockedAt === 'number'
				? snapshot.lockedAt
				: undefined,
		metric: normalized.metric,
		status: winner ? status : normalized.status,
		variants: Array.isArray( snapshot?.variants ) ? snapshot.variants : [],
		windowDays:
			typeof snapshot?.windowDays === 'number'
				? snapshot.windowDays
				: normalized.windowDays,
		winner,
	};
}

function sanitizeWeights(
	weights: Partial< AbTestTrafficWeights >,
	variantCount: VariantCount
): AbTestTrafficWeights {
	const nextWeights: AbTestTrafficWeights = {
		a: 0,
		b: 0,
	};

	getVariantKeys( variantCount ).forEach( ( key ) => {
		nextWeights[ key ] = clampWeight( Number( weights[ key ] ?? 0 ) );
	} );

	if ( variantCount === 2 ) {
		delete nextWeights.c;
	}

	return nextWeights;
}

function clampInteger(
	value: number | undefined,
	minimum: number,
	maximum: number,
	fallback: number
): number {
	if ( typeof value !== 'number' || Number.isNaN( value ) ) {
		return fallback;
	}

	return Math.min( maximum, Math.max( minimum, Math.round( value ) ) );
}
