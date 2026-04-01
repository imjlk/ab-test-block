import {
	createAttributeUpdater as createValidatedAttributeUpdater,
	createNestedAttributeUpdater as createValidatedNestedAttributeUpdater,
	formatValidationErrors,
	toValidationResult,
	toValidationState,
	type ValidationResult,
	type ValidationState,
} from '@wp-typia/create/runtime/validation';
import typia from 'typia';

import type { AbTestExperimentAttributes } from '../../types';
import {
	sanitizeExperimentAttributes,
	validateExperimentAttributes as validateBusinessRules,
} from '../../lib/experiment';

const validate = typia.createValidate< AbTestExperimentAttributes >();

export function validateExperimentAttributes(
	attributes: AbTestExperimentAttributes
): ValidationResult< AbTestExperimentAttributes > {
	return toValidationResult( validate( attributes ) );
}

export function sanitizeParentAttributes(
	attributes: Partial< AbTestExperimentAttributes >
): AbTestExperimentAttributes {
	return sanitizeExperimentAttributes( attributes );
}

export function getExperimentValidationState(
	attributes: AbTestExperimentAttributes
): ValidationState< AbTestExperimentAttributes > {
	const validationState = toValidationState(
		validateExperimentAttributes( attributes )
	);
	const typiaErrorMessages = formatValidationErrors( validationState.errors );
	const businessRuleErrors = validateBusinessRules( attributes );

	return {
		...validationState,
		errorMessages: [ ...typiaErrorMessages, ...businessRuleErrors ],
		isValid: validationState.isValid && businessRuleErrors.length === 0,
	};
}

export function getExperimentValidationErrors(
	attributes: AbTestExperimentAttributes
): string[] {
	return getExperimentValidationState( attributes ).errorMessages;
}

export function createExperimentAttributeUpdater(
	attributes: AbTestExperimentAttributes,
	setAttributes: ( attrs: Partial< AbTestExperimentAttributes > ) => void
) {
	return createValidatedAttributeUpdater(
		attributes,
		setAttributes,
		validateExperimentAttributes
	);
}

export function createExperimentNestedAttributeUpdater(
	attributes: AbTestExperimentAttributes,
	setAttributes: ( attrs: Partial< AbTestExperimentAttributes > ) => void
) {
	return createValidatedNestedAttributeUpdater(
		attributes,
		setAttributes,
		validateExperimentAttributes
	);
}
