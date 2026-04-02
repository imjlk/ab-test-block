import { tags } from 'typia';

import type {
	AssignmentSource,
	AutomaticMetric,
	EventType,
	AbTestStatsResponse,
	VariantCount,
	VariantKey,
	WinnerLifecycleState,
} from './types';

export interface AbTestBlockStatsRow {
	postId: number & tags.Type< 'uint32' >;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
	experimentId: string & tags.MinLength< 1 > & tags.MaxLength< 191 >;
	variantKey: VariantKey;
	eventType: EventType;
	eventDate: string & tags.MinLength< 10 > & tags.MaxLength< 10 >;
	eventCount: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
}

export interface AbTestBlockVariantAggregate {
	variant: VariantKey;
	impressions: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	clicks: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	ctr: number & tags.Minimum< 0 >;
}

export interface AbTestBlockRecordEventRequest {
	postId: number & tags.Type< 'uint32' >;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
	experimentId: string & tags.MinLength< 1 > & tags.MaxLength< 191 >;
	publicWriteToken?: string & tags.MinLength< 1 > & tags.MaxLength< 512 >;
	variantCount: VariantCount;
	variant: VariantKey;
	eventType: EventType;
	evaluationWindowDays: number &
		tags.Minimum< 1 > &
		tags.Maximum< 365 > &
		tags.Type< 'uint32' >;
	preview?: boolean & tags.Default< false >;
	source?: AssignmentSource;
	timestamp: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
}

export interface AbTestBlockRecordEventResponse {
	accepted: boolean;
	counted: boolean;
	postId: number & tags.Type< 'uint32' >;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
	experimentId: string & tags.MinLength< 1 > & tags.MaxLength< 191 >;
	variant: VariantKey;
	eventType: EventType;
	stats: AbTestBlockStatsResponse;
}

export interface AbTestBlockReevaluateRequest {
	postId: number & tags.Type< 'uint32' >;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
	experimentId: string & tags.MinLength< 1 > & tags.MaxLength< 191 >;
	publicWriteToken?: string & tags.MinLength< 1 > & tags.MaxLength< 512 >;
	variantCount: VariantCount;
	metric: AutomaticMetric;
	minimumImpressionsPerVariant: number &
		tags.Minimum< 0 > &
		tags.Type< 'uint32' >;
	minimumClicksPerVariant: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	evaluationWindowDays: number &
		tags.Minimum< 1 > &
		tags.Maximum< 365 > &
		tags.Type< 'uint32' >;
	lockWinnerAfterSelection: boolean;
}

export interface AbTestBlockStatsRequest {
	postId: number & tags.Type< 'uint32' >;
	blockInstanceId: string & tags.MinLength< 8 > & tags.MaxLength< 64 >;
	experimentId: string & tags.MinLength< 1 > & tags.MaxLength< 191 >;
	variantCount: VariantCount;
	evaluationWindowDays: number &
		tags.Minimum< 1 > &
		tags.Maximum< 365 > &
		tags.Type< 'uint32' >;
}

export type AbTestBlockStatsResponse = AbTestStatsResponse;

export interface AbTestBlockReevaluateResponse {
	status: WinnerLifecycleState;
	metric: AutomaticMetric;
	winner?: VariantKey;
	evaluatedAt: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	lockedAt?: number & tags.Minimum< 0 > & tags.Type< 'uint32' >;
	variants: AbTestBlockVariantAggregate[];
	stats: AbTestBlockStatsResponse;
}
