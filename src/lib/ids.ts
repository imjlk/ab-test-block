import type { VariantKey } from '../types';

export function generateBlockInstanceId(): string {
	if (
		typeof globalThis.crypto !== 'undefined' &&
		typeof globalThis.crypto.randomUUID === 'function'
	) {
		return globalThis.crypto
			.randomUUID()
			.replace( /-/g, '' )
			.slice( 0, 16 );
	}

	return Math.random().toString( 36 ).slice( 2, 18 );
}

export function generateExperimentId( blockInstanceId: string ): string {
	return `experiment_${ blockInstanceId.slice( 0, 8 ) }`;
}

export function isVariantKey( value: unknown ): value is VariantKey {
	return value === 'a' || value === 'b' || value === 'c';
}
