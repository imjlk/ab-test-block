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
	Dropdown,
	MenuGroup,
	MenuItem,
	Notice,
	PanelBody,
	SelectControl,
	TextControl,
	ToolbarButton,
	ToolbarGroup,
	ToggleControl,
} from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { useEffect, useMemo, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import { fetchStats } from '../../api';
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
	AbTestStatsResponse,
	AbTestStatsScopeSnapshot,
	AbTestWinnerEvaluationSnapshot,
	StickyScope,
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
import { editorUiStore, type EditorPreviewMode } from './editor-ui-store';

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
		useState< EditorPreviewMode >( 'traffic' );
	const [ lastTrafficVariantKey, setLastTrafficVariantKey ] =
		useState< VariantKey >( 'a' );
	const [ showAssignmentLabel, setShowAssignmentLabel ] = useState( true );
	const [ showWinnerState, setShowWinnerState ] = useState( true );
	const [ enableQueryPreviewHints, setEnableQueryPreviewHints ] =
		useState( true );
	const [ isEditingExperimentId, setIsEditingExperimentId ] =
		useState( false );
	const [ copyExperimentIdStatus, setCopyExperimentIdStatus ] = useState<
		'idle' | 'copied' | 'error'
	>( 'idle' );
	const [ stats, setStats ] = useState< AbTestStatsResponse | undefined >();
	const [ isStatsLoading, setIsStatsLoading ] = useState( false );
	const [ statsError, setStatsError ] = useState< string | undefined >();
	const [ statsRefreshToken, setStatsRefreshToken ] = useState( 0 );
	const normalizedAttributes = useMemo(
		() => sanitizeParentAttributes( attributes ),
		[ attributes ]
	);
	const { innerBlocks, postId, selectedVariantKey, storedWinnerEvaluation } =
		useSelect(
			( select: any ) => {
				const editor = select( blockEditorStore );
				const blocks =
					( editor.getBlocks( clientId ) as BlockRecord[] ) || [];
				const postEditor = select( 'core/editor' );
				const meta = ( postEditor?.getEditedPostAttribute?.( 'meta' ) ??
					{} ) as Record< string, unknown >;
				const nextPostId = Number(
					postEditor?.getCurrentPostId?.() ??
						postEditor?.getEditedPostAttribute?.( 'id' ) ??
						0
				);
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
					postId: Number.isNaN( nextPostId ) ? 0 : nextPostId,
					selectedVariantKey: nextSelectedVariantKey,
					storedWinnerEvaluation: sanitizeWinnerSnapshot(
						winnerStateMap?.[
							normalizedAttributes.blockInstanceId
						] as
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
	const { replaceInnerBlocks, updateBlockAttributes } = useDispatch(
		blockEditorStore as never
	) as {
		replaceInnerBlocks: (
			rootClientId: string,
			blocks: BlockRecord[],
			updateSelection?: boolean
		) => void;
		updateBlockAttributes: (
			targetClientId: string,
			attributes: Record< string, unknown >
		) => void;
	};
	const { clearUi, setUi } = useDispatch( editorUiStore as never ) as {
		clearUi: ( parentClientId: string ) => void;
		setUi: (
			parentClientId: string,
			value: {
				previewMode?: EditorPreviewMode;
				trafficVariantKey?: VariantKey;
				visibleVariantKey?: VariantKey;
			}
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
	const assignmentSourceText = getAssignmentSourceText(
		normalizedAttributes,
		previewMode,
		winnerPreviewState
	);
	const stickyLabel = getStickyLabel( normalizedAttributes );
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
			attributes.experimentId.trim().length === 0 ||
			attributes.experimentId.trim() === 'experiment'
		) {
			nextAttributes.experimentId = normalizedAttributes.experimentId;
		}

		if (
			typeof attributes.experimentLabel !== 'string' ||
			attributes.experimentLabel.trim().length === 0
		) {
			nextAttributes.experimentLabel =
				normalizedAttributes.experimentLabel;
		}

		if (
			typeof attributes.previewQueryKey !== 'string' ||
			attributes.previewQueryKey.trim().length === 0
		) {
			nextAttributes.previewQueryKey =
				normalizedAttributes.previewQueryKey;
		}

		if ( attributes.stickyScope !== normalizedAttributes.stickyScope ) {
			nextAttributes.stickyScope = normalizedAttributes.stickyScope;
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
		attributes.experimentLabel,
		attributes.manualWinner,
		attributes.previewQueryKey,
		attributes.stickyScope,
		attributes.weights,
		clientId,
		normalizedAttributes.blockInstanceId,
		normalizedAttributes.experimentId,
		normalizedAttributes.experimentLabel,
		normalizedAttributes.manualWinner,
		normalizedAttributes.previewQueryKey,
		normalizedAttributes.stickyScope,
		normalizedAttributes.variantCount,
		normalizedAttributes.weights,
		updateBlockAttributes,
	] );

	useEffect( () => {
		if ( copyExperimentIdStatus === 'idle' ) {
			return undefined;
		}

		const timeoutId = window.setTimeout( () => {
			setCopyExperimentIdStatus( 'idle' );
		}, 1800 );

		return () => window.clearTimeout( timeoutId );
	}, [ copyExperimentIdStatus ] );

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
	}, [
		clientId,
		innerBlockByVariant,
		innerBlocks,
		replaceInnerBlocks,
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
		setUi( clientId, {
			previewMode,
			trafficVariantKey: lastTrafficVariantKey,
			visibleVariantKey: activePreviewVariantKey,
		} );
	}, [
		activePreviewVariantKey,
		clientId,
		lastTrafficVariantKey,
		previewMode,
		setUi,
	] );

	useEffect( () => () => clearUi( clientId ), [ clearUi, clientId ] );

	useEffect( () => {
		if ( postId <= 0 ) {
			setStats( undefined );
			setStatsError( undefined );
			setIsStatsLoading( false );
			return;
		}

		let isCurrent = true;

		setIsStatsLoading( true );
		setStatsError( undefined );

		void fetchStats( {
			blockInstanceId: normalizedAttributes.blockInstanceId,
			evaluationWindowDays: normalizedAttributes.evaluationWindowDays,
			experimentId: normalizedAttributes.experimentId,
			postId,
			variantCount: normalizedAttributes.variantCount,
		} )
			.then( ( result ) => {
				if ( ! isCurrent ) {
					return;
				}

				if ( ! result.isValid || ! result.data ) {
					setStats( undefined );
					setStatsError(
						result.errors[ 0 ]?.expected ??
							__( 'Unable to load stats.', 'ab-test-block' )
					);
					return;
				}

				setStats( result.data );
			} )
			.catch( ( error ) => {
				if ( ! isCurrent ) {
					return;
				}

				setStats( undefined );
				setStatsError(
					error instanceof Error
						? error.message
						: __( 'Unknown stats error.', 'ab-test-block' )
				);
			} )
			.finally( () => {
				if ( isCurrent ) {
					setIsStatsLoading( false );
				}
			} );

		return () => {
			isCurrent = false;
		};
	}, [
		normalizedAttributes.blockInstanceId,
		normalizedAttributes.evaluationWindowDays,
		normalizedAttributes.experimentId,
		normalizedAttributes.variantCount,
		postId,
		statsRefreshToken,
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

	function activateVariantEditor( variantKey: VariantKey ) {
		setPreviewMode( 'traffic' );
		setLastTrafficVariantKey( variantKey );
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

		setPreviewMode( 'traffic' );
		setLastTrafficVariantKey( nextTrafficVariantKey );
		setAttributes( nextAttributes );
	}

	function previewTrafficMode() {
		setPreviewMode( 'traffic' );
	}

	function previewWinnerMode() {
		setPreviewMode( 'winner' );
	}

	const validationState = useMemo(
		() => getExperimentValidationState( normalizedAttributes ),
		[ normalizedAttributes ]
	);
	const validationErrors = validationState.errorMessages;
	const queryPreviewHint = sprintf(
		/* translators: 1: query key, 2: experiment id */
		__( 'Preview hints: ?%1$s=b or ?abtest=%2$s:b', 'ab-test-block' ),
		normalizedAttributes.previewQueryKey,
		normalizedAttributes.experimentId
	);
	const hasTrackedStats = Boolean(
		stats?.instance.updatedAt || stats?.experiment.updatedAt
	);
	const latestStatsUpdatedAt = getLatestStatsUpdatedAt( stats );
	const latestStatsUpdatedText = latestStatsUpdatedAt
		? new Date( latestStatsUpdatedAt * 1000 ).toLocaleString()
		: __( 'No tracked events yet', 'ab-test-block' );
	const previewModeText =
		previewMode === 'winner'
			? __( 'Winner preview', 'ab-test-block' )
			: __( 'Traffic mode', 'ab-test-block' );

	function refreshStats() {
		setStatsRefreshToken( ( current ) => current + 1 );
	}

	async function handleCopyExperimentId() {
		const didCopy = await copyTextToClipboard(
			normalizedAttributes.experimentId
		);
		setCopyExperimentIdStatus( didCopy ? 'copied' : 'error' );
	}

	return (
		<>
			<BlockControls>
				<ToolbarGroup>
					{ variantKeys.map( ( variantKey ) => (
						<ToolbarButton
							key={ variantKey }
							isPressed={
								activePreviewVariantKey === variantKey &&
								previewMode === 'traffic'
							}
							label={ sprintf(
								/* translators: %s: variant key */
								__( 'Edit Variant %s', 'ab-test-block' ),
								variantKey.toUpperCase()
							) }
							onClick={ () =>
								activateVariantEditor( variantKey )
							}
						>
							{ variantKey.toUpperCase() }
						</ToolbarButton>
					) ) }
				</ToolbarGroup>
				<ToolbarGroup>
					<ToolbarButton
						isPressed={ previewMode === 'traffic' }
						label={ __( 'Traffic mode', 'ab-test-block' ) }
						onClick={ previewTrafficMode }
					>
						{ __( 'Traffic', 'ab-test-block' ) }
					</ToolbarButton>
					<ToolbarButton
						isPressed={ previewMode === 'winner' }
						label={ __( 'Winner preview', 'ab-test-block' ) }
						onClick={ previewWinnerMode }
					>
						{ __( 'Winner', 'ab-test-block' ) }
					</ToolbarButton>
				</ToolbarGroup>
				<ToolbarGroup>
					<Dropdown
						className="wp-block-abtest-block-test__toolbar-dropdown"
						contentClassName="wp-block-abtest-block-test__toolbar-dropdown-content"
						popoverProps={ { placement: 'bottom-end' } }
						renderToggle={ ( { isOpen, onToggle } ) => (
							<ToolbarButton
								aria-expanded={ isOpen }
								label={ __( 'More', 'ab-test-block' ) }
								onClick={ onToggle }
							>
								{ __( 'More', 'ab-test-block' ) }
							</ToolbarButton>
						) }
						renderContent={ ( { onClose } ) => (
							<div className="wp-block-abtest-block-test__toolbar-menu">
								<MenuGroup
									label={ __( 'Actions', 'ab-test-block' ) }
								>
									{ normalizedAttributes.variantCount ===
									2 ? (
										<MenuItem
											onClick={ () => {
												setVariantCount( 3, 'c' );
												onClose();
											} }
										>
											{ __( 'Add C', 'ab-test-block' ) }
										</MenuItem>
									) : (
										<MenuItem
											onClick={ () => {
												setVariantCount( 2, 'b' );
												onClose();
											} }
										>
											{ __(
												'Remove C',
												'ab-test-block'
											) }
										</MenuItem>
									) }
									<MenuItem
										disabled={
											isStatsLoading || postId <= 0
										}
										onClick={ () => {
											refreshStats();
											onClose();
										} }
									>
										{ isStatsLoading
											? __(
													'Refreshing…',
													'ab-test-block'
											  )
											: __(
													'Refresh stats',
													'ab-test-block'
											  ) }
									</MenuItem>
								</MenuGroup>
								<div className="wp-block-abtest-block-test__toolbar-info">
									<p className="wp-block-abtest-block-test__toolbar-info-title">
										{ __(
											'Experiment info',
											'ab-test-block'
										) }
									</p>
									<dl className="wp-block-abtest-block-test__toolbar-info-grid">
										<div>
											<dt>
												{ __(
													'Label',
													'ab-test-block'
												) }
											</dt>
											<dd>
												{
													normalizedAttributes.experimentLabel
												}
											</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Experiment ID',
													'ab-test-block'
												) }
											</dt>
											<dd>
												{
													normalizedAttributes.experimentId
												}
											</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Weights',
													'ab-test-block'
												) }
											</dt>
											<dd>
												{ formatWeightSummary(
													normalizedAttributes.weights,
													normalizedAttributes.variantCount
												) }
											</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Winner mode',
													'ab-test-block'
												) }
											</dt>
											<dd>
												{
													normalizedAttributes.winnerMode
												}
											</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Sticky',
													'ab-test-block'
												) }
											</dt>
											<dd>{ stickyLabel }</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Preview mode',
													'ab-test-block'
												) }
											</dt>
											<dd>{ previewModeText }</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Assignment',
													'ab-test-block'
												) }
											</dt>
											<dd>{ assignmentSourceText }</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Updated',
													'ab-test-block'
												) }
											</dt>
											<dd>{ latestStatsUpdatedText }</dd>
										</div>
									</dl>
								</div>
							</div>
						) }
					/>
				</ToolbarGroup>
			</BlockControls>
			<InspectorControls>
				<PanelBody
					title={ __( 'Editor Preview', 'ab-test-block' ) }
					initialOpen
				>
					<SelectControl
						label={ __( 'Preview mode', 'ab-test-block' ) }
						value={ previewMode }
						options={ [
							{
								label: __( 'Traffic mode', 'ab-test-block' ),
								value: 'traffic',
							},
							{
								label: __( 'Winner preview', 'ab-test-block' ),
								value: 'winner',
							},
						] }
						onChange={ ( value ) => {
							if ( value === 'winner' ) {
								previewWinnerMode();
								return;
							}

							previewTrafficMode();
						} }
						help={ __(
							'Traffic mode edits one variant at a time. Winner preview lets you inspect the currently resolved winner without changing saved settings.',
							'ab-test-block'
						) }
					/>
					<Notice status="info" isDismissible={ false }>
						{ previewSummary }
					</Notice>
					{ previewMode === 'winner' &&
						! winnerPreviewState.variant && (
							<Notice status="warning" isDismissible={ false }>
								{ __(
									'Winner preview does not yet have a resolved variant to show in the editor.',
									'ab-test-block'
								) }
							</Notice>
						) }
				</PanelBody>
				<PanelBody title={ __( 'General', 'ab-test-block' ) }>
					<TextControl
						label={ __( 'Experiment label', 'ab-test-block' ) }
						value={ normalizedAttributes.experimentLabel }
						onChange={ ( value ) =>
							updateAttribute( 'experimentLabel', value )
						}
						help={ __(
							'Human-friendly label used in the editor shell and debug stats.',
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
				</PanelBody>
				<PanelBody
					title={ __( 'Identity & Preview', 'ab-test-block' ) }
					initialOpen={ false }
				>
					<div className="wp-block-abtest-block-test__field-actions">
						<Button
							variant="secondary"
							onClick={ () =>
								setIsEditingExperimentId(
									( current ) => ! current
								)
							}
						>
							{ isEditingExperimentId
								? __( 'Done editing ID', 'ab-test-block' )
								: __( 'Edit Experiment ID', 'ab-test-block' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ handleCopyExperimentId }
						>
							{ copyExperimentIdStatus === 'copied'
								? __( 'Copied', 'ab-test-block' )
								: __( 'Copy ID', 'ab-test-block' ) }
						</Button>
					</div>
					{ copyExperimentIdStatus === 'error' && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'Could not copy the Experiment ID. Try selecting the value manually.',
								'ab-test-block'
							) }
						</Notice>
					) }
					<TextControl
						label={ __( 'Experiment ID', 'ab-test-block' ) }
						value={ normalizedAttributes.experimentId }
						disabled={ ! isEditingExperimentId }
						onChange={ ( value ) =>
							updateAttribute( 'experimentId', value )
						}
						help={ __(
							'Machine-readable grouping key for query preview, analytics payloads, and optional cross-post experiment aggregates.',
							'ab-test-block'
						) }
					/>
					{ isEditingExperimentId && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'Changing the Experiment ID after stats exist will split future tracking into a new experiment history. Only change it when you intentionally want a different grouping key.',
								'ab-test-block'
							) }
						</Notice>
					) }
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
						help={
							normalizedAttributes.stickyAssignment
								? __(
										'Keeps the assigned variant stable for the current browser using localStorage only.',
										'ab-test-block'
								  )
								: __(
										'Weighted random is recalculated on every page load.',
										'ab-test-block'
								  )
						}
					/>
					{ normalizedAttributes.stickyAssignment && (
						<SelectControl
							label={ __( 'Sticky scope', 'ab-test-block' ) }
							value={ normalizedAttributes.stickyScope }
							options={ [
								{
									label: __( 'Page block', 'ab-test-block' ),
									value: 'instance',
								},
								{
									label: __(
										'Shared experiment',
										'ab-test-block'
									),
									value: 'experiment',
								},
							] }
							help={
								normalizedAttributes.stickyScope ===
								'experiment'
									? __(
											'Shares one sticky assignment across every page using the same Experiment ID.',
											'ab-test-block'
									  )
									: __(
											'Keeps sticky assignment scoped to this page and block instance only.',
											'ab-test-block'
									  )
							}
							onChange={ ( value ) =>
								updateAttribute(
									'stickyScope',
									value as StickyScope
								)
							}
						/>
					) }
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
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Saved server stats are shown here for both this block instance and the shared experiment ID. Preview mode does not write new stats.',
							'ab-test-block'
						) }
					</Notice>
					<div className="wp-block-abtest-block-test__debug-section">
						<div className="wp-block-abtest-block-test__debug-section-head">
							<h4 className="wp-block-abtest-block-test__debug-section-title">
								{ __( 'Current state', 'ab-test-block' ) }
							</h4>
							<div className="wp-block-abtest-block-test__stats-actions">
								<Button
									variant="secondary"
									onClick={ refreshStats }
									disabled={ isStatsLoading || postId <= 0 }
								>
									{ isStatsLoading
										? __( 'Refreshing…', 'ab-test-block' )
										: __(
												'Refresh stats',
												'ab-test-block'
										  ) }
								</Button>
							</div>
						</div>
						<dl className="wp-block-abtest-block-test__debug-summary">
							<div>
								<dt>
									{ __( 'Preview mode', 'ab-test-block' ) }
								</dt>
								<dd>{ previewModeText }</dd>
							</div>
							<div>
								<dt>
									{ __(
										'Assignment source',
										'ab-test-block'
									) }
								</dt>
								<dd>{ assignmentSourceText }</dd>
							</div>
							<div>
								<dt>
									{ __( 'Winner state', 'ab-test-block' ) }
								</dt>
								<dd>{ winnerStateText }</dd>
							</div>
							<div>
								<dt>
									{ __(
										'Last stats update',
										'ab-test-block'
									) }
								</dt>
								<dd>{ latestStatsUpdatedText }</dd>
							</div>
						</dl>
						{ previewMode === 'winner' &&
							! winnerPreviewState.variant && (
								<Notice
									status="warning"
									isDismissible={ false }
								>
									{ __(
										'Winner preview is active, but no resolved winner is available yet.',
										'ab-test-block'
									) }
								</Notice>
							) }
						{ statsError && (
							<Notice status="warning" isDismissible={ false }>
								{ statsError }
							</Notice>
						) }
						{ ! isStatsLoading &&
							! statsError &&
							! hasTrackedStats && (
								<Notice status="info" isDismissible={ false }>
									{ __(
										'No tracked events yet. Once front-end impressions or clicks are counted, stats will appear here.',
										'ab-test-block'
									) }
								</Notice>
							) }
					</div>
					{ stats && (
						<div className="wp-block-abtest-block-test__stats-grid">
							{ renderStatsCard(
								__( 'This block', 'ab-test-block' ),
								stats.instance
							) }
							{ renderStatsCard(
								__( 'This experiment', 'ab-test-block' ),
								stats.experiment
							) }
						</div>
					) }
					<div className="wp-block-abtest-block-test__debug-section">
						<h4 className="wp-block-abtest-block-test__debug-section-title">
							{ __( 'Editor annotations', 'ab-test-block' ) }
						</h4>
						{ showAssignmentLabel && (
							<p className="wp-block-abtest-block-test__sidebar-note">
								{ assignmentPreviewText }
							</p>
						) }
						{ showWinnerState && (
							<p className="wp-block-abtest-block-test__sidebar-note">
								{ winnerStateText }
							</p>
						) }
						{ enableQueryPreviewHints && (
							<p className="wp-block-abtest-block-test__sidebar-note">
								{ queryPreviewHint }
							</p>
						) }
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
					</div>
				</PanelBody>
			</InspectorControls>
			<div
				{ ...useBlockProps( {
					className: 'wp-block-abtest-block-test',
				} ) }
			>
				<div className="wp-block-abtest-block-test__inline-notices">
					{ previewMode === 'winner' &&
						! winnerPreviewState.variant && (
							<Notice
								className="wp-block-abtest-block-test__inline-notice"
								status="warning"
								isDismissible={ false }
							>
								{ __(
									'Winner preview has no resolved variant yet.',
									'ab-test-block'
								) }
							</Notice>
						) }
					{ validationErrors.map( ( error ) => (
						<Notice
							key={ error }
							className="wp-block-abtest-block-test__inline-notice"
							status="warning"
							isDismissible={ false }
						>
							{ error }
						</Notice>
					) ) }
					{ ( previewMode === 'winner' ||
						validationErrors.length > 0 ) && (
						<div className="wp-block-abtest-block-test__inline-summary">
							{ previewMode === 'winner'
								? previewSummary
								: validationErrors[ 0 ] }
						</div>
					) }
				</div>
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

function getLatestStatsUpdatedAt( stats?: AbTestStatsResponse ) {
	return Math.max(
		Number( stats?.instance.updatedAt ?? 0 ),
		Number( stats?.experiment.updatedAt ?? 0 )
	);
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
	previewMode: EditorPreviewMode,
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
	previewMode: EditorPreviewMode,
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
			__( 'Manual -> Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'winner-locked' &&
		winnerPreviewState.variant
	) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Winner locked -> Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'candidate' &&
		winnerPreviewState.variant
	) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Candidate -> Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'off' ||
		attributes.winnerMode === 'off'
	) {
		return __( 'Off', 'ab-test-block' );
	}

	return __( 'No resolved winner yet', 'ab-test-block' );
}

function getAssignmentSourceText(
	attributes: AbTestExperimentAttributes,
	previewMode: EditorPreviewMode,
	winnerPreviewState: WinnerPreviewState
) {
	if ( previewMode === 'winner' ) {
		if ( winnerPreviewState.source === 'manual-winner' ) {
			return __( 'Manual winner', 'ab-test-block' );
		}

		if ( winnerPreviewState.source === 'automatic-winner-locked' ) {
			return __( 'Locked automatic winner', 'ab-test-block' );
		}

		if ( winnerPreviewState.source === 'automatic-candidate' ) {
			return __( 'Automatic winner candidate', 'ab-test-block' );
		}

		return __( 'No resolved winner yet', 'ab-test-block' );
	}

	if ( ! attributes.stickyAssignment ) {
		return __( 'Weighted-random', 'ab-test-block' );
	}

	if ( attributes.stickyScope === 'experiment' ) {
		return __( 'Sticky (shared experiment)', 'ab-test-block' );
	}

	return __( 'Sticky (this block)', 'ab-test-block' );
}

function getStickyLabel( attributes: AbTestExperimentAttributes ) {
	if ( ! attributes.stickyAssignment ) {
		return String( __( 'Non-sticky', 'ab-test-block' ) );
	}

	if ( attributes.stickyScope === 'experiment' ) {
		return String( __( 'Sticky experiment', 'ab-test-block' ) );
	}

	return String( __( 'Sticky page block', 'ab-test-block' ) );
}

function renderStatsCard( title: string, snapshot: AbTestStatsScopeSnapshot ) {
	return (
		<div className="wp-block-abtest-block-test__debug-section">
			<h4 className="wp-block-abtest-block-test__debug-section-title">
				{ title }
			</h4>
			<div className="wp-block-abtest-block-test__stats-card">
				<div className="wp-block-abtest-block-test__stats-head">
					<p className="wp-block-abtest-block-test__stats-meta">
						{ snapshot.updatedAt
							? sprintf(
									/* translators: %s: date and time */
									__( 'Updated %s', 'ab-test-block' ),
									new Date(
										snapshot.updatedAt * 1000
									).toLocaleString()
							  )
							: __( 'No saved events yet', 'ab-test-block' ) }
					</p>
					{ typeof snapshot.postCount === 'number' &&
						typeof snapshot.blockInstanceCount === 'number' && (
							<p className="wp-block-abtest-block-test__stats-meta">
								{ sprintf(
									/* translators: 1: post count, 2: block instance count */
									__(
										'%1$d posts · %2$d block instances',
										'ab-test-block'
									),
									snapshot.postCount,
									snapshot.blockInstanceCount
								) }
							</p>
						) }
				</div>
				<div className="wp-block-abtest-block-test__stats-rows">
					{ snapshot.variants.map( ( variant ) => (
						<div
							key={ variant.variantKey }
							className="wp-block-abtest-block-test__stats-row"
						>
							<span className="wp-block-abtest-block-test__stats-key">
								{ sprintf(
									/* translators: %s: variant key */
									__( 'Variant %s', 'ab-test-block' ),
									variant.variantKey.toUpperCase()
								) }
							</span>
							<span className="wp-block-abtest-block-test__stats-value">
								{ sprintf(
									/* translators: 1: impression count, 2: click count, 3: ctr percentage */
									__(
										'%1$d impressions · %2$d clicks · %3$s CTR',
										'ab-test-block'
									),
									variant.impressions,
									variant.clicks,
									formatCtrPercentage( variant.ctr )
								) }
							</span>
						</div>
					) ) }
				</div>
			</div>
		</div>
	);
}

function formatCtrPercentage( value: number ) {
	return `${ ( value * 100 ).toFixed( 1 ) }%`;
}

async function copyTextToClipboard( value: string ) {
	if ( navigator.clipboard?.writeText ) {
		try {
			await navigator.clipboard.writeText( value );
			return true;
		} catch ( error ) {
			// Fall through to legacy copy for environments without clipboard permissions.
		}
	}

	try {
		const textarea = document.createElement( 'textarea' );
		textarea.value = value;
		textarea.setAttribute( 'readonly', 'readonly' );
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		textarea.style.pointerEvents = 'none';
		document.body.appendChild( textarea );
		textarea.focus();
		textarea.select();
		const didCopy = document.execCommand( 'copy' );
		document.body.removeChild( textarea );
		return didCopy;
	} catch ( error ) {
		return false;
	}
}
