import typia from 'typia';

import type { AbTestExperimentAttributes } from '../../types';
import {
	sanitizeExperimentAttributes,
	validateExperimentAttributes as validateBusinessRules,
} from '../../lib/experiment';

const validate = typia.createValidate< AbTestExperimentAttributes >();

export function sanitizeParentAttributes(
	attributes: Partial< AbTestExperimentAttributes >
): AbTestExperimentAttributes {
	return sanitizeExperimentAttributes( attributes );
}

export function getExperimentValidationErrors(
	attributes: AbTestExperimentAttributes
): string[] {
	const result = validate( attributes );
	const errors = result.success
		? []
		: result.errors.map(
				( error ) =>
					`${ error.path || 'attributes' }: ${ error.expected }`
		  );

	return [ ...errors, ...validateBusinessRules( attributes ) ];
}
