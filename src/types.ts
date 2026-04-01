import { tags } from 'typia';

export type VariantKey = 'a' | 'b' | 'c';
export type VariantCount = 2 | 3;
export type WinnerMode = 'off' | 'manual' | 'automatic';
export type AutomaticMetric = 'ctr';
export type EventType = 'impression' | 'click';
export type AssignmentSource =
	| 'query-preview'
	| 'locked-winner'
	| 'manual-winner'
	| 'automatic-winner'
	| 'sticky'
	| 'weighted-random';
export type WinnerLifecycleState = 'no-winner' | 'candidate' | 'winner-locked';
export type BrowserLayerEventName =
	| 'abtest:assigned'
	| 'abtest:impression'
	| 'abtest:click'
	| 'abtest:winner_applied'
	| 'abtest:winner_changed';

export interface AbTestTrafficWeights {
	a: number & tags.Minimum< 0 > & tags.Maximum< 100 >;
	b: number & tags.Minimum< 0 > & tags.Maximum< 100 >;
	c?: number & tags.Minimum< 0 > & tags.Maximum< 100 >;
}

export interface AbTestExperimentAttributes {
	experimentId: string &
		tags.MinLength< 1 > &
		tags.MaxLength< 191 > &
		tags.Default< 'experiment' >;
	variantCount: VariantCount & tags.Default< 2 >;
	weights: AbTestTrafficWeights;
	previewQueryKey: string &
		tags.MinLength< 1 > &
		tags.MaxLength< 50 > &
		tags.Default< 'abtest' >;
	stickyAssignment: boolean & tags.Default< true >;
	winnerMode: WinnerMode & tags.Default< 'off' >;
	manualWinner?: VariantKey;
	automaticMetric: AutomaticMetric & tags.Default< 'ctr' >;
	minimumImpressionsPerVariant: number &
		tags.Minimum< 0 > &
		tags.Type< 'uint32' > &
		tags.Default< 100 >;
	minimumClicksPerVariant: number &
		tags.Minimum< 0 > &
		tags.Type< 'uint32' > &
		tags.Default< 1 >;
	evaluationWindowDays: number &
		tags.Minimum< 1 > &
		tags.Maximum< 365 > &
		tags.Type< 'uint32' > &
		tags.Default< 14 >;
	lockWinnerAfterSelection: boolean & tags.Default< true >;
	trackImpressions: boolean & tags.Default< true >;
	trackClicks: boolean & tags.Default< true >;
	emitBrowserEvents: boolean & tags.Default< true >;
	emitKexpLayer: boolean & tags.Default< false >;
	emitDataLayer: boolean & tags.Default< false >;
	emitClarityHook: boolean & tags.Default< false >;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
}

export interface AbTestVariantAttributes {
	variantKey: VariantKey & tags.Default< 'a' >;
	variantLabel: string &
		tags.MinLength< 1 > &
		tags.MaxLength< 40 > &
		tags.Default< 'Variant A' >;
}

export interface AbTestVariantStatsSnapshot {
	variantKey: VariantKey;
	impressions: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	clicks: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	ctr: number & tags.Minimum< 0 >;
}

export interface AbTestWinnerEvaluationSnapshot {
	status: WinnerLifecycleState;
	metric: AutomaticMetric;
	winner?: VariantKey;
	evaluatedAt?: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	lockedAt?: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	windowDays: number &
		tags.Minimum< 1 > &
		tags.Maximum< 365 > &
		tags.Type< 'uint32' >;
	variants: AbTestVariantStatsSnapshot[];
}

export interface AbTestRuntimeConfiguration {
	postId: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
	experimentId: string & tags.MinLength< 1 > & tags.MaxLength< 191 >;
	variantCount: VariantCount;
	weights: AbTestTrafficWeights;
	stickyAssignment: boolean;
	previewQueryKey: string & tags.MinLength< 1 > & tags.MaxLength< 50 >;
	winnerMode: WinnerMode;
	manualWinner?: VariantKey;
	automaticMetric: AutomaticMetric;
	minimumImpressionsPerVariant: number &
		tags.Minimum< 0 > &
		tags.Type< 'uint32' >;
	minimumClicksPerVariant: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	evaluationWindowDays: number &
		tags.Minimum< 1 > &
		tags.Maximum< 365 > &
		tags.Type< 'uint32' >;
	lockWinnerAfterSelection: boolean;
	trackImpressions: boolean;
	trackClicks: boolean;
	emitBrowserEvents: boolean;
	emitKexpLayer: boolean;
	emitDataLayer: boolean;
	emitClarityHook: boolean;
}

export interface AbTestViewContext extends AbTestRuntimeConfiguration {
	postId: number;
	publicWriteToken?: string;
	publicWriteExpiresAt?: number;
	restNonce?: string;
	stickyStorageKey: string;
	variantKeys: VariantKey[];
	winnerEvaluation: AbTestWinnerEvaluationSnapshot;
}

export interface AbTestViewState {
	assignment?: VariantKey;
	assignmentSource?: AssignmentSource;
	debugLabel?: string;
	error?: string;
	isPreview: boolean;
	isReady: boolean;
	winner?: VariantKey;
	winnerStatus: WinnerLifecycleState;
}

export interface AbTestBrowserEventPayload {
	postId: number;
	blockInstanceId: string;
	experimentId: string;
	variant: VariantKey;
	variantCount: VariantCount;
	weights: AbTestTrafficWeights;
	source: AssignmentSource;
	winnerMode: WinnerMode;
	winner?: VariantKey;
	preview: boolean;
	eventType?: EventType;
	timestamp: number;
}
