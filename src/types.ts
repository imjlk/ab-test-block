import type { TextAlignment } from '@wp-typia/block-types/block-editor/alignment';
import type {
	TypiaValidationError,
	ValidationResult,
} from '@wp-typia/create/runtime/validation';
import { tags } from 'typia';

export type {
	TypiaValidationError,
	ValidationResult,
} from '@wp-typia/create/runtime/validation';

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
	experimentId: string & tags.MinLength< 1 > & tags.MaxLength< 191 >;
	variantCount: VariantCount;
	weights: AbTestTrafficWeights;
	previewQueryKey: string & tags.MinLength< 1 > & tags.MaxLength< 50 >;
	stickyAssignment: boolean;
	winnerMode: WinnerMode;
	manualWinner?: VariantKey;
	automaticMetric: AutomaticMetric;
	minimumImpressionsPerVariant: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	minimumClicksPerVariant: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	evaluationWindowDays: number & tags.Minimum< 1 > & tags.Maximum< 365 > & tags.Type< 'uint32' >;
	lockWinnerAfterSelection: boolean;
	trackImpressions: boolean;
	trackClicks: boolean;
	emitBrowserEvents: boolean;
	emitKexpLayer: boolean;
	emitDataLayer: boolean;
	emitClarityHook: boolean;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
}

export interface AbTestVariantAttributes {
	variantKey: VariantKey;
	variantLabel: string & tags.MinLength< 1 > & tags.MaxLength< 40 >;
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
	windowDays: number & tags.Minimum< 1 > & tags.Maximum< 365 > & tags.Type< 'uint32' >;
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
	lockWinnerAfterSelection: boolean;
	trackImpressions: boolean;
	trackClicks: boolean;
}

// Temporary scaffold attributes while the block is still using the persistence starter UI.
export interface AbTestBlockAttributes {
	content: string &
		tags.MinLength< 1 > &
		tags.MaxLength< 250 > &
		tags.Default< 'Ab Test Block persistence block' >;
	alignment?: TextAlignment & tags.Default< 'left' >;
	isVisible?: boolean & tags.Default< true >;
	showCount?: boolean & tags.Default< true >;
	buttonLabel?: string &
		tags.MinLength< 1 > &
		tags.MaxLength< 40 > &
		tags.Default< 'Persist Count' >;
	resourceKey?: string &
		tags.MinLength< 1 > &
		tags.MaxLength< 100 > &
		tags.Default< 'primary' >;
}

export interface AbTestBlockContext {
	buttonLabel: string;
	canWrite: boolean;
	count: number;
	persistencePolicy: 'authenticated' | 'public';
	postId: number;
	publicWriteExpiresAt?: number;
	publicWriteToken?: string;
	resourceKey: string;
	restNonce?: string;
	storage: 'post-meta' | 'custom-table';
	isVisible: boolean;
}

export interface AbTestBlockState {
	canWrite: boolean;
	count: number;
	error?: string;
	isHydrated: boolean;
	isLoading: boolean;
	isSaving: boolean;
	isVisible: boolean;
}

export type AbTestBlockValidationResult = ValidationResult< AbTestBlockAttributes >;
