import type {
	AbTestExperimentAttributes,
	AbTestVariantAttributes,
	AbTestWinnerEvaluationSnapshot,
	VariantKey,
} from '../types';

export const DEFAULT_PREVIEW_QUERY_KEY = 'abtest';
export const DEFAULT_AUTOMATIC_METRIC = 'ctr';

export const DEFAULT_EXPERIMENT_ATTRIBUTES: AbTestExperimentAttributes = {
	automaticMetric: DEFAULT_AUTOMATIC_METRIC,
	blockInstanceId: '',
	emitBrowserEvents: true,
	emitClarityHook: false,
	emitDataLayer: false,
	emitKexpLayer: false,
	evaluationWindowDays: 14,
	experimentId: 'experiment',
	lockWinnerAfterSelection: true,
	manualWinner: undefined,
	minimumClicksPerVariant: 1,
	minimumImpressionsPerVariant: 100,
	previewQueryKey: DEFAULT_PREVIEW_QUERY_KEY,
	stickyAssignment: true,
	trackClicks: true,
	trackImpressions: true,
	variantCount: 2,
	weights: {
		a: 50,
		b: 50,
	},
	winnerMode: 'off',
};

export function createDefaultVariantAttributes(
	variantKey: VariantKey
): AbTestVariantAttributes {
	return {
		variantKey,
		variantLabel: `Variant ${ variantKey.toUpperCase() }`,
	};
}

export function createDefaultWinnerSnapshot(): AbTestWinnerEvaluationSnapshot {
	return {
		evaluatedAt: undefined,
		lockedAt: undefined,
		metric: DEFAULT_AUTOMATIC_METRIC,
		status: 'no-winner',
		variants: [],
		windowDays: DEFAULT_EXPERIMENT_ATTRIBUTES.evaluationWindowDays,
		winner: undefined,
	};
}
