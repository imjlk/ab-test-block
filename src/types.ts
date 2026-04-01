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
