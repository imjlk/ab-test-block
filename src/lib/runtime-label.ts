import type { AssignmentSource, VariantKey } from '../types';

export function formatRuntimeLabel(
	experimentId: string,
	variant: VariantKey,
	source: AssignmentSource
) {
	return `${ experimentId }: Variant ${ variant.toUpperCase() } (${ source })`;
}
