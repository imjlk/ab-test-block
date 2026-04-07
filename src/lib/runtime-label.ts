import type { AssignmentSource, VariantKey } from '../types';

export function getAssignmentSourceLabel( source: AssignmentSource ) {
	switch ( source ) {
		case 'query-preview':
			return 'preview override';
		case 'locked-winner':
			return 'locked winner';
		case 'manual-winner':
			return 'manual winner';
		case 'automatic-winner':
			return 'automatic winner';
		case 'sticky':
			return 'sticky assignment';
		case 'weighted-random':
		default:
			return 'weighted traffic split';
	}
}

export function formatRuntimeLabel(
	experimentId: string,
	variant?: VariantKey,
	source?: AssignmentSource,
	fallback?: string
) {
	if ( ! variant || ! source ) {
		return fallback ? `${ experimentId }: ${ fallback }` : '';
	}

	return `${ experimentId }: Showing Variant ${ variant.toUpperCase() } from ${ getAssignmentSourceLabel(
		source
	) }`;
}
