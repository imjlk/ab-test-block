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
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import {
	equalizeWeights,
	getVariantKeys,
	getVariantLabel,
	normalizeWeights,
	sanitizeWinnerSnapshot,
	sumWeights,
} from '../../lib/experiment';
import type {
	AbTestExperimentAttributes,
	AbTestWinnerEvaluationSnapshot,
	VariantCount,
	VariantKey,
	WinnerLifecycleState,
	WinnerMode,
} from '../../types';
import {
	createExperimentAttributeUpdater,
	createExperimentNestedAttributeUpdater,
	getExperimentValidationState,
	sanitizeParentAttributes,
} from './validators';

type BlockRecord = {
	clientId: string;
	attributes: Record< string, unknown > & {
		lock?: {
			move?: boolean;
			remove?: boolean;
		};
		variantKey?: VariantKey;
		variantLabel?: string;
	};
	innerBlocks?: BlockRecord[];
};

type PreviewMode = 'traffic' | 'winner';

type WinnerPreviewState = {
	source:
		| 'automatic-candidate'
		| 'automatic-winner-locked'
		| 'manual-winner'
		| 'no-winner'
		| 'off';
	status: WinnerLifecycleState | 'manual' | 'off';
	variant?: VariantKey;
};

const ALLOWED_BLOCKS = [ 'abtest-block/variant' ];
const VARIANT_LOCK = {
	move: true,
	remove: true,
} as const;

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

function isVariantKeyValue( value: unknown ): value is VariantKey {
	return value === 'a' || value === 'b' || value === 'c';
}

function createVariantBlock( variantKey: VariantKey ) {
	return createBlock(
		'abtest-block/variant',
		{
			lock: VARIANT_LOCK,
			variantKey,
			variantLabel: getVariantLabel( variantKey ),
		} as Record< string, unknown >,
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
	const [ lastTrafficVariantKey, setLastTrafficVariantKey ] =
		useState< VariantKey >( 'a' );
	const [ showAssignmentLabel, setShowAssignmentLabel ] = useState( true );
	const [ showWinnerState, setShowWinnerState ] = useState( true );
	const [ enableQueryPreviewHints, setEnableQueryPreviewHints ] =
		useState( true );
	const pendingFocusVariantKeyRef = useRef< VariantKey | undefined >();
	const normalizedAttributes = useMemo(
		() => sanitizeParentAttributes( attributes ),
		[ attributes ]
	);
	const {
		innerBlocks,
		isParentSelected,
		selectedBlockClientId,
		selectedVariantKey,
		storedWinnerEvaluation,
	} = useSelect(
		( select: any ) => {
			const editor = select( blockEditorStore );
			const blocks =
				( editor.getBlocks( clientId ) as BlockRecord[] ) || [];
			const postEditor = select( 'core/editor' );
			const meta = ( postEditor?.getEditedPostAttribute?.( 'meta' ) ??
				{} ) as Record< string, unknown >;
			const winnerStateMap = meta._ab_test_block_winner_state as
				| Record< string, unknown >
				| undefined;
			const nextSelectedBlockClientId =
				editor.getSelectedBlockClientId() as string | undefined;
			let nextSelectedVariantKey: VariantKey | undefined;

			for ( const block of blocks ) {
				const variantKey = block.attributes.variantKey;

				if ( ! isVariantKeyValue( variantKey ) ) {
					continue;
				}

				if (
					block.clientId === nextSelectedBlockClientId ||
					editor.hasSelectedInnerBlock( block.clientId, true )
				) {
					nextSelectedVariantKey = variantKey;
					break;
				}
			}

			return {
				innerBlocks: blocks,
				isParentSelected: editor.isBlockSelected( clientId ) as boolean,
				selectedBlockClientId: nextSelectedBlockClientId,
				selectedVariantKey: nextSelectedVariantKey,
				storedWinnerEvaluation: sanitizeWinnerSnapshot(
					winnerStateMap?.[ normalizedAttributes.blockInstanceId ] as
						| Partial< AbTestWinnerEvaluationSnapshot >
						| undefined,
					normalizedAttributes.variantCount
				),
			};
		},
		[
			clientId,
			normalizedAttributes.blockInstanceId,
			normalizedAttributes.variantCount,
		]
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
				attributes: Record< string, unknown >
			) => void;
		};
	const variantKeys = getVariantKeys( normalizedAttributes.variantCount );
	const innerBlockByVariant = useMemo(
		() =>
			new Map(
				innerBlocks
					.filter( ( block ) =>
						isVariantKeyValue( block.attributes.variantKey )
					)
					.map( ( block ) => [ block.attributes.variantKey, block ] )
			),
		[ innerBlocks ]
	);
	const totalWeight = sumWeights(
		normalizedAttributes.weights,
		normalizedAttributes.variantCount
	);
	const winnerPreviewState = useMemo(
		() =>
			getWinnerPreviewState(
				normalizedAttributes,
				storedWinnerEvaluation
			),
		[ normalizedAttributes, storedWinnerEvaluation ]
	);
	const activeTrafficVariantKey =
		selectedVariantKey && variantKeys.includes( selectedVariantKey )
			? selectedVariantKey
			: undefined;
	const activePreviewVariantKey =
		previewMode === 'winner'
			? winnerPreviewState.variant ?? lastTrafficVariantKey
			: activeTrafficVariantKey ?? lastTrafficVariantKey;
	const previewSummary = getPreviewSummary(
		normalizedAttributes,
		previewMode,
		activePreviewVariantKey,
		winnerPreviewState
	);
	const winnerStateText = getWinnerStateText(
		normalizedAttributes,
		winnerPreviewState
	);
	const assignmentPreviewText = getAssignmentPreviewText(
		previewMode,
		activePreviewVariantKey,
		winnerPreviewState
	);
	const stickyLabel = normalizedAttributes.stickyAssignment
		? __( 'Sticky', 'ab-test-block' )
		: __( 'Non-sticky', 'ab-test-block' );
	const updateAttribute = useMemo(
		() =>
			createExperimentAttributeUpdater(
				normalizedAttributes,
				setAttributes
			),
		[ normalizedAttributes, setAttributes ]
	);
	const updateNestedAttribute = useMemo(
		() =>
			createExperimentNestedAttributeUpdater(
				normalizedAttributes,
				setAttributes
			),
		[ normalizedAttributes, setAttributes ]
	);

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
		clientId,
		normalizedAttributes.blockInstanceId,
		normalizedAttributes.experimentId,
		normalizedAttributes.manualWinner,
		normalizedAttributes.previewQueryKey,
		normalizedAttributes.variantCount,
		normalizedAttributes.weights,
		updateBlockAttributes,
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

		if ( needsSync ) {
			replaceInnerBlocks( clientId, desiredBlocks, false );
		}

		desiredBlocks.forEach( ( block ) => {
			const variantKey = block.attributes.variantKey;

			if ( ! isVariantKeyValue( variantKey ) ) {
				return;
			}

			const lock = block.attributes.lock;
			const nextVariantLabel = getVariantLabel( variantKey );
			const nextBlockAttributes: Record< string, unknown > = {};

			if ( block.attributes.variantLabel !== nextVariantLabel ) {
				nextBlockAttributes.variantLabel = nextVariantLabel;
			}

			if ( lock?.move !== true || lock?.remove !== true ) {
				nextBlockAttributes.lock = VARIANT_LOCK;
			}

			if ( Object.keys( nextBlockAttributes ).length > 0 ) {
				updateBlockAttributes( block.clientId, nextBlockAttributes );
			}
		} );

		const pendingFocusVariantKey = pendingFocusVariantKeyRef.current;
		if ( pendingFocusVariantKey ) {
			const focusTarget = desiredBlocks.find(
				( block ) =>
					block.attributes.variantKey === pendingFocusVariantKey
			);

			if ( focusTarget?.clientId ) {
				selectBlock( focusTarget.clientId );
				pendingFocusVariantKeyRef.current = undefined;
				return;
			}
		}

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
		updateBlockAttributes,
		variantKeys,
	] );

	useEffect( () => {
		if (
			previewMode === 'traffic' &&
			activeTrafficVariantKey &&
			activeTrafficVariantKey !== lastTrafficVariantKey
		) {
			setLastTrafficVariantKey( activeTrafficVariantKey );
		}
	}, [ activeTrafficVariantKey, lastTrafficVariantKey, previewMode ] );

	useEffect( () => {
		if ( variantKeys.includes( lastTrafficVariantKey ) ) {
			return;
		}

		setLastTrafficVariantKey( variantKeys[ 0 ] );
	}, [ lastTrafficVariantKey, variantKeys ] );

	useEffect( () => {
		let targetVariantKey: VariantKey | undefined;

		if ( previewMode === 'winner' ) {
			targetVariantKey = winnerPreviewState.variant;
		} else if ( isParentSelected || ! activeTrafficVariantKey ) {
			targetVariantKey = activePreviewVariantKey;
		}

		if ( ! targetVariantKey ) {
			return;
		}

		const targetBlock = innerBlockByVariant.get( targetVariantKey );
		if ( targetBlock?.clientId ) {
			selectBlock( targetBlock.clientId );
		}
	}, [
		activePreviewVariantKey,
		activeTrafficVariantKey,
		innerBlockByVariant,
		isParentSelected,
		previewMode,
		selectBlock,
		winnerPreviewState.variant,
	] );

	function updateNumberAttribute(
		key:
			| 'minimumClicksPerVariant'
			| 'minimumImpressionsPerVariant'
			| 'evaluationWindowDays',
		value: string
	) {
		const parsed = Number.parseInt( value, 10 );

		updateAttribute(
			key,
			Number.isNaN( parsed ) ? normalizedAttributes[ key ] : parsed
		);
	}

	function updateWeight( variantKey: VariantKey, value: string ) {
		const parsed = Number.parseInt( value, 10 );

		updateNestedAttribute(
			`weights.${ variantKey }`,
			Number.isNaN( parsed ) ? 0 : parsed
		);
	}

	function focusVariant( variantKey: VariantKey ) {
		const targetBlock = innerBlockByVariant.get( variantKey );

		if ( targetBlock?.clientId ) {
			selectBlock( targetBlock.clientId );
			pendingFocusVariantKeyRef.current = undefined;
			return;
		}

		pendingFocusVariantKeyRef.current = variantKey;
	}

	function activateVariantEditor( variantKey: VariantKey ) {
		setPreviewMode( 'traffic' );
		setLastTrafficVariantKey( variantKey );
		focusVariant( variantKey );
	}

	function setVariantCount(
		nextCount: VariantCount,
		preferredTrafficVariantKey?: VariantKey
	) {
		const nextWeights =
			nextCount === 3
				? equalizeWeights( nextCount )
				: normalizeWeights( normalizedAttributes.weights, nextCount );
		const nextVariantKeys = getVariantKeys( nextCount );
		let nextTrafficVariantKey = nextVariantKeys[ 0 ];

		if (
			preferredTrafficVariantKey &&
			nextVariantKeys.includes( preferredTrafficVariantKey )
		) {
			nextTrafficVariantKey = preferredTrafficVariantKey;
		} else if ( nextVariantKeys.includes( lastTrafficVariantKey ) ) {
			nextTrafficVariantKey = lastTrafficVariantKey;
		}
		const nextAttributes: Partial< AbTestExperimentAttributes > = {
			variantCount: nextCount,
			weights: nextWeights,
		};

		if (
			normalizedAttributes.manualWinner &&
			! nextVariantKeys.includes( normalizedAttributes.manualWinner )
		) {
			nextAttributes.manualWinner = nextVariantKeys[ 0 ];
		}

		pendingFocusVariantKeyRef.current = nextTrafficVariantKey;
		setPreviewMode( 'traffic' );
		setLastTrafficVariantKey( nextTrafficVariantKey );
		setAttributes( nextAttributes );
	}

	function previewTrafficMode() {
		setPreviewMode( 'traffic' );
		focusVariant( lastTrafficVariantKey );
	}

	function previewWinnerMode() {
		setPreviewMode( 'winner' );
		if ( winnerPreviewState.variant ) {
			focusVariant( winnerPreviewState.variant );
		}
	}

	const validationState = useMemo(
		() => getExperimentValidationState( normalizedAttributes ),
		[ normalizedAttributes ]
	);
	const validationErrors = validationState.errorMessages;

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
							onClick={ () =>
								activateVariantEditor( variantKey )
							}
						/>
					) ) }
					{ normalizedAttributes.variantCount === 2 ? (
						<ToolbarButton
							label={ __( 'Add C', 'ab-test-block' ) }
							onClick={ () => setVariantCount( 3, 'c' ) }
						/>
					) : (
						<ToolbarButton
							label={ __( 'Remove C', 'ab-test-block' ) }
							onClick={ () => setVariantCount( 2, 'b' ) }
						/>
					) }
				</ToolbarGroup>
				<ToolbarGroup>
					<ToolbarButton
						isPressed={ previewMode === 'winner' }
						label={ __( 'Preview Winner', 'ab-test-block' ) }
						onClick={ previewWinnerMode }
					/>
					<ToolbarButton
						isPressed={ previewMode === 'traffic' }
						label={ __( 'Preview Traffic Mode', 'ab-test-block' ) }
						onClick={ previewTrafficMode }
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
							updateAttribute( 'experimentId', value )
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
							updateAttribute( 'previewQueryKey', value )
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
							updateAttribute( 'stickyAssignment', value )
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
								updateAttribute(
									'weights',
									normalizeWeights(
										normalizedAttributes.weights,
										normalizedAttributes.variantCount
									)
								)
							}
						>
							{ __( 'Normalize weights', 'ab-test-block' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () =>
								updateAttribute(
									'weights',
									equalizeWeights(
										normalizedAttributes.variantCount
									)
								)
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
							updateAttribute( 'lockWinnerAfterSelection', value )
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
							updateAttribute( 'trackImpressions', value )
						}
					/>
					<ToggleControl
						label={ __( 'Track clicks', 'ab-test-block' ) }
						checked={ normalizedAttributes.trackClicks }
						onChange={ ( value ) =>
							updateAttribute( 'trackClicks', value )
						}
					/>
					<ToggleControl
						label={ __(
							'Dispatch browser events',
							'ab-test-block'
						) }
						checked={ normalizedAttributes.emitBrowserEvents }
						onChange={ ( value ) =>
							updateAttribute( 'emitBrowserEvents', value )
						}
					/>
					<ToggleControl
						label={ __(
							'Push to window.kexpLayer',
							'ab-test-block'
						) }
						checked={ normalizedAttributes.emitKexpLayer }
						onChange={ ( value ) =>
							updateAttribute( 'emitKexpLayer', value )
						}
					/>
					<ToggleControl
						label={ __(
							'Push to window.dataLayer',
							'ab-test-block'
						) }
						checked={ normalizedAttributes.emitDataLayer }
						onChange={ ( value ) =>
							updateAttribute( 'emitDataLayer', value )
						}
					/>
					<ToggleControl
						label={ __( 'Emit Clarity hook', 'ab-test-block' ) }
						checked={ normalizedAttributes.emitClarityHook }
						onChange={ ( value ) =>
							updateAttribute( 'emitClarityHook', value )
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
				<div className="wp-block-abtest-block-test__tabs">
					{ variantKeys.map( ( variantKey ) => (
						<Button
							key={ variantKey }
							className="wp-block-abtest-block-test__tab"
							variant={
								activePreviewVariantKey === variantKey
									? 'primary'
									: 'secondary'
							}
							onClick={ () =>
								activateVariantEditor( variantKey )
							}
						>
							{ sprintf(
								/* translators: %s: variant key */
								__( 'Variant %s', 'ab-test-block' ),
								variantKey.toUpperCase()
							) }
						</Button>
					) ) }
					{ normalizedAttributes.variantCount === 2 ? (
						<Button
							className="wp-block-abtest-block-test__tab-action"
							variant="secondary"
							onClick={ () => setVariantCount( 3, 'c' ) }
						>
							{ __( 'Add C', 'ab-test-block' ) }
						</Button>
					) : (
						<Button
							className="wp-block-abtest-block-test__tab-action"
							variant="secondary"
							onClick={ () => setVariantCount( 2, 'b' ) }
						>
							{ __( 'Remove C', 'ab-test-block' ) }
						</Button>
					) }
				</div>
				<div className="wp-block-abtest-block-test__preview-controls">
					<Button
						className="wp-block-abtest-block-test__preview-button"
						variant={
							previewMode === 'traffic' ? 'primary' : 'secondary'
						}
						onClick={ previewTrafficMode }
					>
						{ __( 'Preview Traffic Mode', 'ab-test-block' ) }
					</Button>
					<Button
						className="wp-block-abtest-block-test__preview-button"
						variant={
							previewMode === 'winner' ? 'primary' : 'secondary'
						}
						onClick={ previewWinnerMode }
					>
						{ __( 'Preview Winner', 'ab-test-block' ) }
					</Button>
				</div>
				<Notice status="info" isDismissible={ false }>
					{ previewSummary }
				</Notice>
				{ previewMode === 'winner' && ! winnerPreviewState.variant && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Winner preview does not yet have a resolved variant to show in the editor.',
							'ab-test-block'
						) }
					</Notice>
				) }
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
				<div className="wp-block-abtest-block-test__stage">
					<InnerBlocks
						allowedBlocks={ ALLOWED_BLOCKS }
						renderAppender={ undefined }
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

function getWinnerPreviewState(
	attributes: AbTestExperimentAttributes,
	storedWinnerEvaluation: AbTestWinnerEvaluationSnapshot
): WinnerPreviewState {
	if ( attributes.winnerMode === 'manual' && attributes.manualWinner ) {
		return {
			source: 'manual-winner',
			status: 'manual',
			variant: attributes.manualWinner,
		};
	}

	if ( attributes.winnerMode === 'automatic' ) {
		if (
			storedWinnerEvaluation.status === 'winner-locked' &&
			storedWinnerEvaluation.winner
		) {
			return {
				source: 'automatic-winner-locked',
				status: storedWinnerEvaluation.status,
				variant: storedWinnerEvaluation.winner,
			};
		}

		if (
			storedWinnerEvaluation.status === 'candidate' &&
			storedWinnerEvaluation.winner
		) {
			return {
				source: 'automatic-candidate',
				status: storedWinnerEvaluation.status,
				variant: storedWinnerEvaluation.winner,
			};
		}

		return {
			source: 'no-winner',
			status: 'no-winner',
		};
	}

	if ( attributes.winnerMode === 'off' ) {
		return {
			source: 'off',
			status: 'off',
		};
	}

	return {
		source: 'no-winner',
		status: 'no-winner',
	};
}

function getPreviewSummary(
	attributes: AbTestExperimentAttributes,
	previewMode: PreviewMode,
	activeVariantKey: VariantKey,
	winnerPreviewState: WinnerPreviewState
) {
	if ( previewMode !== 'winner' ) {
		return sprintf(
			/* translators: 1: active variant key, 2: weight summary */
			__(
				'Traffic mode is editing Variant %1$s. Configured delivery: %2$s.',
				'ab-test-block'
			),
			activeVariantKey.toUpperCase(),
			formatWeightSummary( attributes.weights, attributes.variantCount )
		);
	}

	if ( winnerPreviewState.variant ) {
		return sprintf(
			/* translators: %s: variant key */
			__(
				'Winner preview is forcing Variant %s in the editor.',
				'ab-test-block'
			),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.source === 'automatic-candidate' ||
		winnerPreviewState.source === 'automatic-winner-locked'
	) {
		return __(
			'Winner preview is enabled, but automatic winner resolution is only available after front-end stats are evaluated.',
			'ab-test-block'
		);
	}

	return __(
		'Winner preview is enabled, but no manual or automatic winner is currently available in the editor.',
		'ab-test-block'
	);
}

function getAssignmentPreviewText(
	previewMode: PreviewMode,
	activeVariantKey: VariantKey,
	winnerPreviewState: WinnerPreviewState
) {
	if ( previewMode === 'winner' && winnerPreviewState.variant ) {
		let previewSource: string = __(
			'automatic candidate',
			'ab-test-block'
		);

		if ( winnerPreviewState.source === 'manual-winner' ) {
			previewSource = __( 'manual winner', 'ab-test-block' );
		} else if ( winnerPreviewState.source === 'automatic-winner-locked' ) {
			previewSource = __( 'locked automatic winner', 'ab-test-block' );
		}

		return sprintf(
			/* translators: 1: variant key, 2: preview source */
			__(
				'Current editor preview: Variant %1$s via %2$s.',
				'ab-test-block'
			),
			winnerPreviewState.variant.toUpperCase(),
			previewSource
		);
	}

	if ( previewMode === 'winner' ) {
		return __(
			'Current editor preview: winner preview is active, but no resolved winner is available.',
			'ab-test-block'
		);
	}

	return sprintf(
		/* translators: %s: variant key */
		__(
			'Current editor preview: editing Variant %s in traffic mode.',
			'ab-test-block'
		),
		activeVariantKey.toUpperCase()
	);
}

function getWinnerStateText(
	attributes: AbTestExperimentAttributes,
	winnerPreviewState: WinnerPreviewState
) {
	if (
		winnerPreviewState.status === 'manual' &&
		winnerPreviewState.variant
	) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Winner state: manual -> Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'winner-locked' &&
		winnerPreviewState.variant
	) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Winner state: winner-locked -> Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'candidate' &&
		winnerPreviewState.variant
	) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Winner state: candidate -> Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'off' ||
		attributes.winnerMode === 'off'
	) {
		return __( 'Winner state: off', 'ab-test-block' );
	}

	return __( 'Winner state: no resolved winner yet', 'ab-test-block' );
}
