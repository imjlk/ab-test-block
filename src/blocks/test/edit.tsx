import { createBlock } from '@wordpress/blocks';
import {
	BlockControls,
	InspectorControls,
	InnerBlocks,
	store as blockEditorStore,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	Button,
	Notice,
	PanelBody,
	SelectControl,
	TextControl,
	ToggleControl,
	ToolbarButton,
	ToolbarGroup,
} from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { useEffect, useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import {
	equalizeWeights,
	getVariantKeys,
	normalizeWeights,
	sumWeights,
} from '../../lib/experiment';
import type {
	AbTestExperimentAttributes,
	VariantCount,
	VariantKey,
	WinnerMode,
} from '../../types';
import { sanitizeParentAttributes } from './validators';

type BlockRecord = {
	clientId: string;
	attributes: Record< string, unknown >;
	innerBlocks?: BlockRecord[];
};

type PreviewMode = 'traffic' | 'winner';

const ALLOWED_BLOCKS = [ 'abtest-block/variant' ];

function haveSameWeights(
	left: Partial< AbTestExperimentAttributes[ 'weights' ] > | undefined,
	right: Partial< AbTestExperimentAttributes[ 'weights' ] > | undefined,
	variantCount: VariantCount
) {
	return getVariantKeys( variantCount ).every(
		( key ) =>
			Number( left?.[ key ] ?? 0 ) === Number( right?.[ key ] ?? 0 )
	);
}

function createVariantBlock( variantKey: VariantKey ) {
	return createBlock(
		'abtest-block/variant',
		{
			variantKey,
			variantLabel: `Variant ${ variantKey.toUpperCase() }`,
		},
		[
			createBlock( 'core/paragraph', {
				placeholder: sprintf(
					/* translators: %s: variant label */
					__( 'Add content for Variant %s', 'ab-test-block' ),
					variantKey.toUpperCase()
				),
			} ),
		]
	);
}

export default function Edit( {
	attributes,
	clientId,
	setAttributes,
}: {
	attributes: Partial< AbTestExperimentAttributes >;
	clientId: string;
	setAttributes: ( attrs: Partial< AbTestExperimentAttributes > ) => void;
} ) {
	const [ previewMode, setPreviewMode ] =
		useState< PreviewMode >( 'traffic' );
	const [ showAssignmentLabel, setShowAssignmentLabel ] = useState( true );
	const [ showWinnerState, setShowWinnerState ] = useState( true );
	const [ enableQueryPreviewHints, setEnableQueryPreviewHints ] =
		useState( true );
	const normalizedAttributes = useMemo(
		() => sanitizeParentAttributes( attributes ),
		[ attributes ]
	);
	const innerBlocks = useSelect(
		( select: any ) =>
			( select( blockEditorStore ).getBlocks(
				clientId
			) as BlockRecord[] ) || [],
		[ clientId ]
	);
	const selectedBlockClientId = useSelect(
		( select: any ) =>
			select( blockEditorStore ).getSelectedBlockClientId() as
				| string
				| undefined,
		[]
	);
	const { replaceInnerBlocks, selectBlock, updateBlockAttributes } =
		useDispatch( blockEditorStore as never ) as {
			replaceInnerBlocks: (
				rootClientId: string,
				blocks: BlockRecord[],
				updateSelection?: boolean
			) => void;
			selectBlock: ( targetClientId?: string ) => void;
			updateBlockAttributes: (
				targetClientId: string,
				attributes: Partial< AbTestExperimentAttributes >
			) => void;
		};
	const variantKeys = getVariantKeys( normalizedAttributes.variantCount );
	const innerBlockByVariant = useMemo(
		() =>
			new Map(
				innerBlocks.map( ( block ) => [
					block.attributes.variantKey as VariantKey,
					block,
				] )
			),
		[ innerBlocks ]
	);
	const totalWeight = sumWeights(
		normalizedAttributes.weights,
		normalizedAttributes.variantCount
	);
	const previewSummary = getPreviewSummary(
		normalizedAttributes,
		previewMode
	);
	const winnerStateText = getWinnerStateText( normalizedAttributes );
	const assignmentPreviewText =
		previewMode === 'traffic'
			? __(
					'Traffic preview shows the configured delivery strategy.',
					'ab-test-block'
			  )
			: __(
					'Winner preview shows which variant would be forced by winner rules.',
					'ab-test-block'
			  );
	const stickyLabel = normalizedAttributes.stickyAssignment
		? __( 'Sticky', 'ab-test-block' )
		: __( 'Non-sticky', 'ab-test-block' );

	useEffect( () => {
		const nextAttributes: Partial< AbTestExperimentAttributes > = {};

		if (
			typeof attributes.blockInstanceId !== 'string' ||
			attributes.blockInstanceId.length < 8
		) {
			nextAttributes.blockInstanceId =
				normalizedAttributes.blockInstanceId;
		}

		if (
			typeof attributes.experimentId !== 'string' ||
			attributes.experimentId.trim().length === 0
		) {
			nextAttributes.experimentId = normalizedAttributes.experimentId;
		}

		if (
			typeof attributes.previewQueryKey !== 'string' ||
			attributes.previewQueryKey.trim().length === 0
		) {
			nextAttributes.previewQueryKey =
				normalizedAttributes.previewQueryKey;
		}

		if (
			! haveSameWeights(
				attributes.weights,
				normalizedAttributes.weights,
				normalizedAttributes.variantCount
			)
		) {
			nextAttributes.weights = normalizedAttributes.weights;
		}

		if ( attributes.manualWinner !== normalizedAttributes.manualWinner ) {
			nextAttributes.manualWinner = normalizedAttributes.manualWinner;
		}

		if ( Object.keys( nextAttributes ).length > 0 ) {
			updateBlockAttributes( clientId, nextAttributes );
		}
	}, [
		attributes.blockInstanceId,
		attributes.experimentId,
		attributes.manualWinner,
		attributes.previewQueryKey,
		attributes.weights,
		normalizedAttributes.blockInstanceId,
		normalizedAttributes.experimentId,
		normalizedAttributes.manualWinner,
		normalizedAttributes.previewQueryKey,
		normalizedAttributes.variantCount,
		normalizedAttributes.weights,
		updateBlockAttributes,
		clientId,
	] );

	useEffect( () => {
		const desiredBlocks = variantKeys.map( ( key ) => {
			const existingBlock = innerBlockByVariant.get( key );
			if ( existingBlock ) {
				return existingBlock;
			}

			return createVariantBlock( key ) as unknown as BlockRecord;
		} );
		const needsSync =
			desiredBlocks.length !== innerBlocks.length ||
			desiredBlocks.some(
				( block, index ) =>
					innerBlocks[ index ]?.clientId !== block.clientId
			);

		if ( ! needsSync ) {
			return;
		}

		replaceInnerBlocks( clientId, desiredBlocks, false );

		if ( ! selectedBlockClientId && desiredBlocks[ 0 ]?.clientId ) {
			selectBlock( desiredBlocks[ 0 ].clientId );
		}
	}, [
		clientId,
		innerBlockByVariant,
		innerBlocks,
		replaceInnerBlocks,
		selectBlock,
		selectedBlockClientId,
		variantKeys,
	] );

	function updateNumberAttribute(
		key:
			| 'minimumClicksPerVariant'
			| 'minimumImpressionsPerVariant'
			| 'evaluationWindowDays',
		value: string
	) {
		const parsed = Number.parseInt( value, 10 );

		setAttributes( {
			[ key ]: Number.isNaN( parsed )
				? normalizedAttributes[ key ]
				: parsed,
		} as Partial< AbTestExperimentAttributes > );
	}

	function updateWeight( variantKey: VariantKey, value: string ) {
		const parsed = Number.parseInt( value, 10 );
		const nextWeights = {
			...normalizedAttributes.weights,
			[ variantKey ]: Number.isNaN( parsed ) ? 0 : parsed,
		};

		setAttributes( {
			weights: nextWeights,
		} );
	}

	function setVariantCount( nextCount: VariantCount ) {
		const nextWeights =
			nextCount === 3
				? equalizeWeights( nextCount )
				: normalizeWeights( normalizedAttributes.weights, nextCount );
		const nextAttributes: Partial< AbTestExperimentAttributes > = {
			variantCount: nextCount,
			weights: nextWeights,
		};

		if (
			normalizedAttributes.manualWinner &&
			! getVariantKeys( nextCount ).includes(
				normalizedAttributes.manualWinner
			)
		) {
			nextAttributes.manualWinner = getVariantKeys( nextCount )[ 0 ];
		}

		setAttributes( nextAttributes );
	}

	function selectVariant( variantKey: VariantKey ) {
		const targetBlock = innerBlockByVariant.get( variantKey );
		if ( targetBlock?.clientId ) {
			selectBlock( targetBlock.clientId );
		}
	}

	const validationErrors = useMemo( () => {
		const errors: string[] = [];
		if ( totalWeight !== 100 ) {
			errors.push(
				sprintf(
					/* translators: %d: invalid weight total */
					__(
						'Current traffic allocation totals %d. It should total 100.',
						'ab-test-block'
					),
					totalWeight
				)
			);
		}
		if (
			normalizedAttributes.winnerMode === 'manual' &&
			! normalizedAttributes.manualWinner
		) {
			errors.push(
				__(
					'Choose a manual winner when manual mode is enabled.',
					'ab-test-block'
				)
			);
		}
		return errors;
	}, [
		normalizedAttributes.manualWinner,
		normalizedAttributes.winnerMode,
		totalWeight,
	] );

	return (
		<>
			<BlockControls>
				<ToolbarGroup>
					{ variantKeys.map( ( variantKey ) => (
						<ToolbarButton
							key={ variantKey }
							label={ sprintf(
								/* translators: %s: variant key */
								__( 'Edit %s', 'ab-test-block' ),
								variantKey.toUpperCase()
							) }
							onClick={ () => selectVariant( variantKey ) }
						/>
					) ) }
					{ normalizedAttributes.variantCount === 2 ? (
						<ToolbarButton
							label={ __( 'Add C', 'ab-test-block' ) }
							onClick={ () => setVariantCount( 3 ) }
						/>
					) : (
						<ToolbarButton
							label={ __( 'Remove C', 'ab-test-block' ) }
							onClick={ () => setVariantCount( 2 ) }
						/>
					) }
				</ToolbarGroup>
				<ToolbarGroup>
					<ToolbarButton
						isPressed={ previewMode === 'winner' }
						label={ __( 'Preview Winner', 'ab-test-block' ) }
						onClick={ () => setPreviewMode( 'winner' ) }
					/>
					<ToolbarButton
						isPressed={ previewMode === 'traffic' }
						label={ __( 'Preview Traffic Mode', 'ab-test-block' ) }
						onClick={ () => setPreviewMode( 'traffic' ) }
					/>
				</ToolbarGroup>
			</BlockControls>
			<InspectorControls>
				<PanelBody
					title={ __( 'General', 'ab-test-block' ) }
					initialOpen
				>
					<TextControl
						label={ __( 'Experiment ID', 'ab-test-block' ) }
						value={ normalizedAttributes.experimentId }
						onChange={ ( value ) =>
							setAttributes( { experimentId: value } )
						}
						help={ __(
							'Used for query preview and analytics payloads.',
							'ab-test-block'
						) }
					/>
					<SelectControl
						label={ __( 'Variant count', 'ab-test-block' ) }
						value={
							String( normalizedAttributes.variantCount ) as
								| '2'
								| '3'
						}
						options={ [
							{ label: __( 'A/B', 'ab-test-block' ), value: '2' },
							{
								label: __( 'A/B/C', 'ab-test-block' ),
								value: '3',
							},
						] }
						onChange={ ( value ) =>
							setVariantCount( value === '3' ? 3 : 2 )
						}
					/>
					<TextControl
						label={ __( 'Preview query key', 'ab-test-block' ) }
						value={ normalizedAttributes.previewQueryKey }
						onChange={ ( value ) =>
							setAttributes( { previewQueryKey: value } )
						}
						help={ __(
							'Supports both a block-specific key and ?abtest=experimentId:variant.',
							'ab-test-block'
						) }
					/>
					<ToggleControl
						label={ __( 'Sticky assignment', 'ab-test-block' ) }
						checked={ normalizedAttributes.stickyAssignment }
						onChange={ ( value ) =>
							setAttributes( { stickyAssignment: value } )
						}
					/>
				</PanelBody>
				<PanelBody
					title={ __( 'Traffic Allocation', 'ab-test-block' ) }
				>
					{ variantKeys.map( ( variantKey ) => (
						<TextControl
							key={ variantKey }
							label={ sprintf(
								/* translators: %s: variant key */
								__( 'Weight %s', 'ab-test-block' ),
								variantKey.toUpperCase()
							) }
							type="number"
							value={ String(
								normalizedAttributes.weights[ variantKey ] ?? 0
							) }
							onChange={ ( value ) =>
								updateWeight( variantKey, value )
							}
						/>
					) ) }
					<div className="wp-block-abtest-block-test__panel-actions">
						<Button
							variant="secondary"
							onClick={ () =>
								setAttributes( {
									weights: normalizeWeights(
										normalizedAttributes.weights,
										normalizedAttributes.variantCount
									),
								} )
							}
						>
							{ __( 'Normalize weights', 'ab-test-block' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () =>
								setAttributes( {
									weights: equalizeWeights(
										normalizedAttributes.variantCount
									),
								} )
							}
						>
							{ __( 'Equalize weights', 'ab-test-block' ) }
						</Button>
					</div>
					{ totalWeight !== 100 && (
						<Notice status="warning" isDismissible={ false }>
							{ sprintf(
								/* translators: %d: current weight total */
								__(
									'Current total: %d. Normalize or adjust until the total is 100.',
									'ab-test-block'
								),
								totalWeight
							) }
						</Notice>
					) }
				</PanelBody>
				<PanelBody title={ __( 'Winning Rules', 'ab-test-block' ) }>
					<SelectControl
						label={ __( 'Winner mode', 'ab-test-block' ) }
						value={ normalizedAttributes.winnerMode }
						options={ [
							{
								label: __( 'Off', 'ab-test-block' ),
								value: 'off',
							},
							{
								label: __( 'Manual', 'ab-test-block' ),
								value: 'manual',
							},
							{
								label: __( 'Automatic', 'ab-test-block' ),
								value: 'automatic',
							},
						] }
						onChange={ ( value ) =>
							setAttributes( {
								winnerMode: value as WinnerMode,
								manualWinner:
									value === 'manual'
										? normalizedAttributes.manualWinner ??
										  variantKeys[ 0 ]
										: undefined,
							} )
						}
					/>
					{ normalizedAttributes.winnerMode === 'manual' && (
						<SelectControl
							label={ __( 'Manual winner', 'ab-test-block' ) }
							value={
								normalizedAttributes.manualWinner ??
								variantKeys[ 0 ]
							}
							options={ variantKeys.map( ( key ) => ( {
								label: `Variant ${ key.toUpperCase() }`,
								value: key,
							} ) ) }
							onChange={ ( value ) =>
								setAttributes( {
									manualWinner: value as VariantKey,
								} )
							}
						/>
					) }
					<SelectControl
						label={ __(
							'Automatic winner metric',
							'ab-test-block'
						) }
						value={ normalizedAttributes.automaticMetric }
						options={ [
							{
								label: __( 'CTR only', 'ab-test-block' ),
								value: 'ctr',
							},
						] }
						onChange={ () => undefined }
						disabled
					/>
					<TextControl
						label={ __(
							'Minimum impressions per variant',
							'ab-test-block'
						) }
						type="number"
						value={ String(
							normalizedAttributes.minimumImpressionsPerVariant
						) }
						onChange={ ( value ) =>
							updateNumberAttribute(
								'minimumImpressionsPerVariant',
								value
							)
						}
					/>
					<TextControl
						label={ __(
							'Minimum clicks per variant',
							'ab-test-block'
						) }
						type="number"
						value={ String(
							normalizedAttributes.minimumClicksPerVariant
						) }
						onChange={ ( value ) =>
							updateNumberAttribute(
								'minimumClicksPerVariant',
								value
							)
						}
					/>
					<TextControl
						label={ __(
							'Evaluation window (days)',
							'ab-test-block'
						) }
						type="number"
						value={ String(
							normalizedAttributes.evaluationWindowDays
						) }
						onChange={ ( value ) =>
							updateNumberAttribute(
								'evaluationWindowDays',
								value
							)
						}
					/>
					<ToggleControl
						label={ __(
							'Lock winner after selection',
							'ab-test-block'
						) }
						checked={
							normalizedAttributes.lockWinnerAfterSelection
						}
						onChange={ ( value ) =>
							setAttributes( { lockWinnerAfterSelection: value } )
						}
					/>
				</PanelBody>
				<PanelBody title={ __( 'Tracking', 'ab-test-block' ) }>
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Impressions are recorded when the active variant stays at least 50% visible for 1 second.',
							'ab-test-block'
						) }
					</Notice>
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Clicks record the first primary CTA click per page. Mark a CTA with the Additional CSS class "abtest-cta" or use data-abtest-cta in Custom HTML. Without a marker, links and buttons fall back automatically.',
							'ab-test-block'
						) }
					</Notice>
					<ToggleControl
						label={ __( 'Track impressions', 'ab-test-block' ) }
						checked={ normalizedAttributes.trackImpressions }
						onChange={ ( value ) =>
							setAttributes( { trackImpressions: value } )
						}
					/>
					<ToggleControl
						label={ __( 'Track clicks', 'ab-test-block' ) }
						checked={ normalizedAttributes.trackClicks }
						onChange={ ( value ) =>
							setAttributes( { trackClicks: value } )
						}
					/>
					<ToggleControl
						label={ __(
							'Dispatch browser events',
							'ab-test-block'
						) }
						checked={ normalizedAttributes.emitBrowserEvents }
						onChange={ ( value ) =>
							setAttributes( { emitBrowserEvents: value } )
						}
					/>
					<ToggleControl
						label={ __(
							'Push to window.kexpLayer',
							'ab-test-block'
						) }
						checked={ normalizedAttributes.emitKexpLayer }
						onChange={ ( value ) =>
							setAttributes( { emitKexpLayer: value } )
						}
					/>
					<ToggleControl
						label={ __(
							'Push to window.dataLayer',
							'ab-test-block'
						) }
						checked={ normalizedAttributes.emitDataLayer }
						onChange={ ( value ) =>
							setAttributes( { emitDataLayer: value } )
						}
					/>
					<ToggleControl
						label={ __( 'Emit Clarity hook', 'ab-test-block' ) }
						checked={ normalizedAttributes.emitClarityHook }
						onChange={ ( value ) =>
							setAttributes( { emitClarityHook: value } )
						}
					/>
				</PanelBody>
				<PanelBody title={ __( 'Debug', 'ab-test-block' ) }>
					<ToggleControl
						label={ __(
							'Show current assignment label in editor preview',
							'ab-test-block'
						) }
						checked={ showAssignmentLabel }
						onChange={ setShowAssignmentLabel }
					/>
					<ToggleControl
						label={ __(
							'Show current winner state in editor',
							'ab-test-block'
						) }
						checked={ showWinnerState }
						onChange={ setShowWinnerState }
					/>
					<ToggleControl
						label={ __(
							'Enable query preview hints',
							'ab-test-block'
						) }
						checked={ enableQueryPreviewHints }
						onChange={ setEnableQueryPreviewHints }
					/>
				</PanelBody>
			</InspectorControls>
			<div
				{ ...useBlockProps( {
					className: 'wp-block-abtest-block-test',
				} ) }
			>
				<div className="wp-block-abtest-block-test__header">
					<div>
						<p className="wp-block-abtest-block-test__eyebrow">
							{ __( 'A/B Experiment', 'ab-test-block' ) }
						</p>
						<h3 className="wp-block-abtest-block-test__title">
							{ normalizedAttributes.experimentId }
						</h3>
					</div>
					<div className="wp-block-abtest-block-test__summary">
						<span>
							{ formatWeightSummary(
								normalizedAttributes.weights,
								normalizedAttributes.variantCount
							) }
						</span>
						<span>{ normalizedAttributes.winnerMode }</span>
						<span>{ stickyLabel }</span>
					</div>
				</div>
				<Notice status="info" isDismissible={ false }>
					{ previewSummary }
				</Notice>
				{ showWinnerState && (
					<p className="wp-block-abtest-block-test__debug">
						{ winnerStateText }
					</p>
				) }
				{ showAssignmentLabel && (
					<p className="wp-block-abtest-block-test__debug">
						{ assignmentPreviewText }
					</p>
				) }
				{ enableQueryPreviewHints && (
					<p className="wp-block-abtest-block-test__debug">
						{ sprintf(
							/* translators: 1: query key, 2: experiment id */
							__(
								'Preview hints: ?%1$s=b or ?abtest=%2$s:b',
								'ab-test-block'
							),
							normalizedAttributes.previewQueryKey,
							normalizedAttributes.experimentId
						) }
					</p>
				) }
				{ validationErrors.map( ( error ) => (
					<Notice
						key={ error }
						status="warning"
						isDismissible={ false }
					>
						{ error }
					</Notice>
				) ) }
				<div className="wp-block-abtest-block-test__variants">
					<InnerBlocks
						allowedBlocks={ ALLOWED_BLOCKS }
						templateLock="all"
					/>
				</div>
			</div>
		</>
	);
}

function formatWeightSummary(
	weights: AbTestExperimentAttributes[ 'weights' ],
	variantCount: VariantCount
) {
	return getVariantKeys( variantCount )
		.map(
			( key ) =>
				`${ key.toUpperCase() } ${ String( weights[ key ] ?? 0 ) }%`
		)
		.join( ' / ' );
}

function getPreviewSummary(
	attributes: AbTestExperimentAttributes,
	previewMode: PreviewMode
) {
	if ( previewMode !== 'winner' ) {
		return sprintf(
			/* translators: %s: weight summary */
			__(
				'Traffic preview uses weighted allocation: %s.',
				'ab-test-block'
			),
			formatWeightSummary( attributes.weights, attributes.variantCount )
		);
	}

	if ( attributes.winnerMode === 'manual' && attributes.manualWinner ) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Winner preview would show Variant %s.', 'ab-test-block' ),
			attributes.manualWinner.toUpperCase()
		);
	}

	if ( attributes.winnerMode === 'automatic' ) {
		return __(
			'Winner preview follows the latest automatic winner state.',
			'ab-test-block'
		);
	}

	return __(
		'Winner preview is off until a manual or automatic winner exists.',
		'ab-test-block'
	);
}

function getWinnerStateText( attributes: AbTestExperimentAttributes ) {
	if ( attributes.winnerMode === 'manual' && attributes.manualWinner ) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Configured manual winner: Variant %s', 'ab-test-block' ),
			attributes.manualWinner.toUpperCase()
		);
	}

	if ( attributes.winnerMode === 'automatic' ) {
		return __(
			'Automatic winner will be resolved from front-end stats.',
			'ab-test-block'
		);
	}

	return __( 'No winner is currently configured.', 'ab-test-block' );
}
