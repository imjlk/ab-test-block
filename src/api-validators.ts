import typia from 'typia';

import { toValidationResult, type ValidationResult } from '@wp-typia/rest';
import type {
	AbTestBlockRecordEventRequest,
	AbTestBlockRecordEventResponse,
	AbTestBlockReevaluateRequest,
	AbTestBlockReevaluateResponse,
	AbTestBlockStatsRequest,
	AbTestBlockStatsResponse,
} from './api-types';

const validateRecordEventRequest =
	typia.createValidate< AbTestBlockRecordEventRequest >();
const validateRecordEventResponse =
	typia.createValidate< AbTestBlockRecordEventResponse >();
const validateReevaluateRequest =
	typia.createValidate< AbTestBlockReevaluateRequest >();
const validateReevaluateResponse =
	typia.createValidate< AbTestBlockReevaluateResponse >();
const validateStatsRequest = typia.createValidate< AbTestBlockStatsRequest >();
const validateStatsResponse =
	typia.createValidate< AbTestBlockStatsResponse >();

export const apiValidators = {
	recordEventRequest: (
		input: unknown
	): ValidationResult< AbTestBlockRecordEventRequest > =>
		toValidationResult( validateRecordEventRequest( input ) ),
	recordEventResponse: (
		input: unknown
	): ValidationResult< AbTestBlockRecordEventResponse > =>
		toValidationResult( validateRecordEventResponse( input ) ),
	reevaluateRequest: (
		input: unknown
	): ValidationResult< AbTestBlockReevaluateRequest > =>
		toValidationResult( validateReevaluateRequest( input ) ),
	reevaluateResponse: (
		input: unknown
	): ValidationResult< AbTestBlockReevaluateResponse > =>
		toValidationResult( validateReevaluateResponse( input ) ),
	statsRequest: (
		input: unknown
	): ValidationResult< AbTestBlockStatsRequest > =>
		toValidationResult( validateStatsRequest( input ) ),
	statsResponse: (
		input: unknown
	): ValidationResult< AbTestBlockStatsResponse > =>
		toValidationResult( validateStatsResponse( input ) ),
};
