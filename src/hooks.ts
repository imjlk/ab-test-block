import { useEffect, useState } from '@wordpress/element';

import {
	formatValidationError,
	formatValidationErrors,
	toValidationState,
	type TypiaValidationError,
	type ValidationResult,
	type ValidationState,
} from '@wp-typia/create/runtime/validation';

export {
	formatValidationError,
	formatValidationErrors,
	type TypiaValidationError,
	type ValidationResult,
	type ValidationState,
} from '@wp-typia/create/runtime/validation';

export function useTypiaValidation<T>(
	value: T,
	validator: ( value: T ) => ValidationResult< T >
): ValidationState< T > {
	const [ state, setState ] = useState< ValidationState< T > >( () =>
		toValidationState( validator( value ) )
	);

	useEffect( () => {
		setState( toValidationState( validator( value ) ) );
	}, [ value, validator ] );

	return state;
}
