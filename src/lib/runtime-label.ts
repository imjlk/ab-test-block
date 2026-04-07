import type { AssignmentSource, VariantKey } from '../types';

export function formatRuntimeLabel(
	experimentId: string,
	variant?: VariantKey,
	source?: AssignmentSource,
	fallback?: string
) {
	if ( ! variant || ! source ) {
		return fallback ? `${ experimentId }: ${ fallback }` : '';
	}

	return `${ experimentId }: Variant ${ variant.toUpperCase() } (${ source })`;
}
