import { __ } from '@wordpress/i18n';
import {
	AlignmentToolbar,
	BlockControls,
	InspectorControls,
	RichText,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	Notice,
	PanelBody,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';
import currentManifest from './typia.manifest.json';
import {
	createEditorModel,
	type ManifestDocument,
} from '@wp-typia/create/runtime/editor';
import type { AbTestBlockAttributes } from './types';
import {
	createAttributeUpdater,
	validateAbTestBlockAttributes,
	validators,
} from './validators';
import { useTypiaValidation } from './hooks';

export default function Edit( {
	attributes,
	setAttributes,
}: {
	attributes: AbTestBlockAttributes;
	setAttributes: ( attrs: Partial< AbTestBlockAttributes > ) => void;
} ) {
	const editorFieldMap = new Map(
		createEditorModel( currentManifest as ManifestDocument, {
			manual: [ 'content', 'resourceKey' ],
			labels: {
				buttonLabel: __( 'Button Label', 'ab-test-block' ),
				resourceKey: __( 'Resource Key', 'ab-test-block' ),
				showCount: __( 'Show Count', 'ab-test-block' ),
			},
		} ).map( ( field ) => [ field.path, field ] )
	);
	const alignmentField = editorFieldMap.get( 'alignment' );
	const isVisibleField = editorFieldMap.get( 'isVisible' );
	const showCountField = editorFieldMap.get( 'showCount' );
	const buttonLabelField = editorFieldMap.get( 'buttonLabel' );
	const { errorMessages, isValid } = useTypiaValidation(
		attributes,
		validateAbTestBlockAttributes
	);
	const updateAttribute = createAttributeUpdater( attributes, setAttributes );
	const alignmentOptions = ( alignmentField?.options || [] ).map( ( option ) => ( {
		label: option.label,
		value: String( option.value ),
	} ) );
	const alignmentValue = attributes.alignment ?? (
		typeof alignmentField?.defaultValue === 'string' ? alignmentField.defaultValue : 'left'
	);
	const isVisible = attributes.isVisible ?? (
		typeof isVisibleField?.defaultValue === 'boolean' ? isVisibleField.defaultValue : true
	);
	const showCount = attributes.showCount ?? (
		typeof showCountField?.defaultValue === 'boolean' ? showCountField.defaultValue : true
	);
	const buttonLabel = attributes.buttonLabel ?? (
		typeof buttonLabelField?.defaultValue === 'string'
			? buttonLabelField.defaultValue
			: 'Persist Count'
	);
	const persistencePolicy = 'public';
	const persistencePolicyDescription = __(
		'Anonymous writes use signed short-lived public tokens.',
		'ab-test-block'
	);

	return (
		<>
			<BlockControls>
				<AlignmentToolbar
					value={ alignmentValue }
					onChange={ ( value ) =>
						updateAttribute(
							'alignment',
							( value || alignmentValue ) as NonNullable< AbTestBlockAttributes[ 'alignment' ] >
						)
					}
				/>
			</BlockControls>
			<InspectorControls>
				<PanelBody title={ __( 'Persistence Settings', 'ab-test-block' ) }>
					<SelectControl
						label={ alignmentField?.label || __( 'Alignment', 'ab-test-block' ) }
						value={ alignmentValue }
						options={ alignmentOptions }
						onChange={ ( value ) =>
							updateAttribute(
								'alignment',
								value as NonNullable< AbTestBlockAttributes[ 'alignment' ] >
							)
						}
					/>
					<ToggleControl
						label={ isVisibleField?.label || __( 'Visible', 'ab-test-block' ) }
						checked={ isVisible }
						onChange={ ( value ) => updateAttribute( 'isVisible', value ) }
					/>
					<ToggleControl
						label={ showCountField?.label || __( 'Show Count', 'ab-test-block' ) }
						checked={ showCount }
						onChange={ ( value ) => updateAttribute( 'showCount', value ) }
					/>
					<TextControl
						label={ buttonLabelField?.label || __( 'Button Label', 'ab-test-block' ) }
						value={ buttonLabel }
						onChange={ ( value ) => updateAttribute( 'buttonLabel', value ) }
					/>
					<TextControl
						label={ __( 'Resource Key', 'ab-test-block' ) }
						value={ attributes.resourceKey ?? '' }
						onChange={ ( value ) => updateAttribute( 'resourceKey', value ) }
						help={ __( 'Stable key used by the persisted counter endpoint.', 'ab-test-block' ) }
					/>
					<Notice status="info" isDismissible={ false }>
						{ __( 'Storage mode: custom-table', 'ab-test-block' ) }
					</Notice>
					<Notice status="info" isDismissible={ false }>
						{ __( 'Persistence policy: public', 'ab-test-block' ) }
						<br />
						{ persistencePolicyDescription }
					</Notice>
				</PanelBody>
				{ ! isValid && (
					<PanelBody
						title={ __( 'Validation Errors', 'ab-test-block' ) }
						initialOpen
					>
						{ errorMessages.map( ( error, index ) => (
							<Notice key={ index } status="error" isDismissible={ false }>
								{ error }
							</Notice>
						) ) }
					</PanelBody>
				) }
			</InspectorControls>
			<div
				{ ...useBlockProps( {
					className: 'wp-block-ab-test-block',
					style: {
						textAlign:
							alignmentValue as NonNullable< AbTestBlockAttributes[ 'alignment' ] >,
					},
				} ) }
			>
				<RichText
					tagName="p"
					value={ attributes.content }
					onChange={ ( value ) => updateAttribute( 'content', value ) }
					placeholder={ __( 'Ab Test Block persistence block', 'ab-test-block' ) }
				/>
				<p className="wp-block-ab-test-block__meta">
					{ __( 'Resource key:', 'ab-test-block' ) } { attributes.resourceKey || '—' }
				</p>
				<p className="wp-block-ab-test-block__meta">
					{ __( 'Storage mode:', 'ab-test-block' ) } custom-table
				</p>
				<p className="wp-block-ab-test-block__meta">
					{ __( 'Persistence policy:', 'ab-test-block' ) } public
				</p>
				{ ! isValid && (
					<Notice status="error" isDismissible={ false }>
						<ul>
							{ errorMessages.map( ( error, index ) => <li key={ index }>{ error }</li> ) }
						</ul>
					</Notice>
				) }
			</div>
		</>
	);
}
