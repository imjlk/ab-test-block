import typia from 'typia';

import {
	toValidationResult,
	type ValidationResult,
} from '@wp-typia/rest';
import type {
	AbTestBlockCounterQuery,
	AbTestBlockCounterResponse,
	AbTestBlockIncrementRequest,
} from './api-types';

const validateCounterQuery = typia.createValidate< AbTestBlockCounterQuery >();
const validateIncrementRequest =
	typia.createValidate< AbTestBlockIncrementRequest >();
const validateCounterResponse =
	typia.createValidate< AbTestBlockCounterResponse >();

export const apiValidators = {
	counterQuery: (
		input: unknown
	): ValidationResult< AbTestBlockCounterQuery > =>
		toValidationResult( validateCounterQuery( input ) ),
	counterResponse: (
		input: unknown
	): ValidationResult< AbTestBlockCounterResponse > =>
		toValidationResult( validateCounterResponse( input ) ),
	incrementRequest: (
		input: unknown
	): ValidationResult< AbTestBlockIncrementRequest > =>
		toValidationResult( validateIncrementRequest( input ) ),
};
