import typia from 'typia';
import currentManifest from './typia.manifest.json';
import {
	type ManifestDefaultsDocument,
	applyTemplateDefaultsFromManifest,
} from '@wp-typia/create/runtime/defaults';
import {
	createAttributeUpdater as createValidatedAttributeUpdater,
	type ValidationResult,
	toValidationResult,
} from '@wp-typia/create/runtime/validation';
import type {
	AbTestBlockAttributes,
	AbTestBlockValidationResult,
} from './types';

const validate = typia.createValidate< AbTestBlockAttributes >();
const assert = typia.createAssert< AbTestBlockAttributes >();
const is = typia.createIs< AbTestBlockAttributes >();
const random = typia.createRandom< AbTestBlockAttributes >();
const clone = typia.misc.createClone< AbTestBlockAttributes >();
const prune = typia.misc.createPrune< AbTestBlockAttributes >();

export const validators = {
	assert,
	clone,
	is,
	prune,
	random,
	validate,
};

export const validateAbTestBlockAttributes = (
	attributes: unknown
): AbTestBlockValidationResult => {
	return toValidationResult( validate( attributes ) );
};

export const sanitizeAbTestBlockAttributes = (
	attributes: Partial< AbTestBlockAttributes >
): AbTestBlockAttributes => {
	const normalized = applyTemplateDefaultsFromManifest< AbTestBlockAttributes >(
		currentManifest as ManifestDefaultsDocument,
		attributes
	);

	return validators.assert( {
		...normalized,
		resourceKey:
			normalized.resourceKey && normalized.resourceKey.length > 0
				? normalized.resourceKey
				: generateResourceKey(),
	} );
};

export function createAttributeUpdater(
	attributes: AbTestBlockAttributes,
	setAttributes: ( attrs: Partial< AbTestBlockAttributes > ) => void,
	validator = validateAbTestBlockAttributes
) {
	return createValidatedAttributeUpdater(
		attributes,
		setAttributes,
		validator as (
			value: AbTestBlockAttributes
		) => ValidationResult< AbTestBlockAttributes >,
		( validation, key ) => {
			console.error( `Validation failed for ${ String( key ) }:`, validation.errors );
		}
	);
}

const generateResourceKey = (): string =>
	'ab-test-block-' + Math.random().toString( 36 ).slice( 2, 11 );
