import { createBlock, getBlockType, parse, serialize } from '@wordpress/blocks';
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
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import { fetchStats } from '../../api';
import {
	equalizeWeights,
	getDefaultPreviewQueryKey,
	getVariantKeys,
	getVariantLabel,
	normalizeWeights,
	sanitizeWinnerSnapshot,
	sumWeights,
} from '../../lib/experiment';
import { generateBlockInstanceId, generateExperimentId } from '../../lib/ids';
import {
	formatRuntimeLabel,
	getAssignmentSourceLabel,
} from '../../lib/runtime-label';
import type {
	AbTestExperimentAttributes,
	AssignmentSource,
	AbTestStatsResponse,
	AbTestStatsScopeSnapshot,
	AbTestWinnerEvaluationSnapshot,
	FrontRenderMode,
	StickyScope,
	VariantCount,
	VariantKey,
	WinnerReasonCode,
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
	name?: string;
};

type WinnerPreviewState = {
	source:
		| 'automatic-candidate'
		| 'automatic-winner-locked'
		| 'manual-winner'
		| 'no-winner'
		| 'off';
	reasonCode: WinnerReasonCode;
	status: WinnerLifecycleState | 'manual' | 'off';
	variant?: VariantKey;
};

type VariantStructureIssue = {
	fallbackVariant?: VariantKey;
	missingVariantKeys: VariantKey[];
};

type SelectedCtaTarget = {
	blockName: string;
	className?: string;
	clientId: string;
	label: string;
	variantClientId: string;
	variantKey: VariantKey;
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
	const [ lastSelectedCtaTarget, setLastSelectedCtaTarget ] = useState<
		SelectedCtaTarget | undefined
	>();
	const [ structureRepairNote, setStructureRepairNote ] = useState<
		string | undefined
	>();
	const [ isDiagnosticsPanelOpen, setIsDiagnosticsPanelOpen ] =
		useState( false );
	const [ stats, setStats ] = useState< AbTestStatsResponse | undefined >();
	const [ isStatsLoading, setIsStatsLoading ] = useState( false );
	const [ statsError, setStatsError ] = useState< string | undefined >();
	const [ statsRefreshToken, setStatsRefreshToken ] = useState( 0 );
	const diagnosticsPanelRef = useRef< HTMLDivElement | null >( null );
	const normalizedAttributes = useMemo(
		() => sanitizeParentAttributes( attributes ),
		[ attributes ]
	);
	const {
		innerBlocks,
		postId,
		selectedCtaTarget,
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
			let nextSelectedCtaTarget: SelectedCtaTarget | undefined;

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

			if (
				nextSelectedBlockClientId &&
				nextSelectedBlockClientId !== clientId
			) {
				const selectedBlock = editor.getBlock(
					nextSelectedBlockClientId
				) as BlockRecord | null;
				const parentClientIds = editor.getBlockParents(
					nextSelectedBlockClientId
				) as string[];
				const belongsToCurrentParent =
					parentClientIds.includes( clientId );
				const variantClientId = parentClientIds.find( ( id ) => {
					const parentBlock = editor.getBlock(
						id
					) as BlockRecord | null;

					return parentBlock?.name === 'abtest-block/variant';
				} );

				if (
					belongsToCurrentParent &&
					variantClientId &&
					selectedBlock &&
					selectedBlock.name !== 'abtest-block/variant'
				) {
					const variantBlock = editor.getBlock(
						variantClientId
					) as BlockRecord | null;
					const variantKey = variantBlock?.attributes.variantKey;

					if ( isVariantKeyValue( variantKey ) ) {
						nextSelectedCtaTarget = {
							blockName: selectedBlock.name ?? '',
							className:
								typeof selectedBlock.attributes.className ===
								'string'
									? selectedBlock.attributes.className
									: undefined,
							clientId: nextSelectedBlockClientId,
							label:
								typeof selectedBlock.name === 'string'
									? selectedBlock.name
									: __( 'Selected block', 'ab-test-block' ),
							variantClientId,
							variantKey,
						};
					}
				}
			}

			return {
				innerBlocks: blocks,
				postId: Number.isNaN( nextPostId ) ? 0 : nextPostId,
				selectedCtaTarget: nextSelectedCtaTarget,
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
				blocks: unknown[],
				updateSelection?: boolean
			) => void;
			selectBlock: ( clientId: string ) => void;
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
	const runtimeLabelSource = getRuntimeLabelSource(
		normalizedAttributes,
		previewMode,
		winnerPreviewState
	);
	const trackingPanelCtaTarget = selectedCtaTarget ?? lastSelectedCtaTarget;
	const selectedCtaBlockType = useMemo(
		() =>
			selectedCtaTarget
				? getBlockType( selectedCtaTarget.blockName )
				: undefined,
		[ selectedCtaTarget ]
	);
	const trackingPanelCtaBlockType = useMemo(
		() =>
			trackingPanelCtaTarget
				? getBlockType( trackingPanelCtaTarget.blockName )
				: undefined,
		[ trackingPanelCtaTarget ]
	);
	const canManageSelectedPrimaryCta = Boolean(
		selectedCtaTarget &&
			selectedCtaBlockType &&
			selectedCtaBlockType.supports?.className !== false
	);
	const canManageTrackingPanelPrimaryCta = Boolean(
		trackingPanelCtaTarget &&
			trackingPanelCtaBlockType &&
			trackingPanelCtaBlockType.supports?.className !== false
	);
	const trackingPanelPrimaryCtaLabel =
		trackingPanelCtaBlockType?.title?.toString() ??
		trackingPanelCtaTarget?.label ??
		__( 'Selected block', 'ab-test-block' );
	const isSelectedPrimaryCta =
		canManageSelectedPrimaryCta &&
		hasClassNameToken( selectedCtaTarget?.className, 'abtest-cta' );
	const isTrackingPanelPrimaryCta =
		canManageTrackingPanelPrimaryCta &&
		hasClassNameToken( trackingPanelCtaTarget?.className, 'abtest-cta' );
	const currentResolvedWinnerVariantKey =
		winnerPreviewState.variant &&
		variantKeys.includes( winnerPreviewState.variant )
			? winnerPreviewState.variant
			: undefined;
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
			attributes.frontRenderMode !== normalizedAttributes.frontRenderMode
		) {
			nextAttributes.frontRenderMode =
				normalizedAttributes.frontRenderMode;
		}

		if (
			attributes.showRuntimeLabel !==
			normalizedAttributes.showRuntimeLabel
		) {
			nextAttributes.showRuntimeLabel =
				normalizedAttributes.showRuntimeLabel;
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
		attributes.frontRenderMode,
		attributes.manualWinner,
		attributes.previewQueryKey,
		attributes.showRuntimeLabel,
		attributes.stickyScope,
		attributes.weights,
		clientId,
		normalizedAttributes.blockInstanceId,
		normalizedAttributes.experimentId,
		normalizedAttributes.experimentLabel,
		normalizedAttributes.frontRenderMode,
		normalizedAttributes.manualWinner,
		normalizedAttributes.previewQueryKey,
		normalizedAttributes.showRuntimeLabel,
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
		setStructureRepairNote( undefined );
	}, [ clientId, normalizedAttributes.blockInstanceId ] );

	useEffect( () => {
		if ( selectedCtaTarget ) {
			setLastSelectedCtaTarget( selectedCtaTarget );
		}
	}, [ selectedCtaTarget ] );

	useEffect( () => {
		setLastSelectedCtaTarget( undefined );
	}, [ clientId, normalizedAttributes.blockInstanceId ] );

	useEffect( () => {
		if ( ! isDiagnosticsPanelOpen ) {
			return undefined;
		}

		const timeoutId = window.setTimeout( () => {
			diagnosticsPanelRef.current?.scrollIntoView( {
				block: 'nearest',
			} );
		}, 80 );

		return () => window.clearTimeout( timeoutId );
	}, [ isDiagnosticsPanelOpen ] );

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
		const variantStructureIssue = getVariantStructureIssue(
			innerBlocks,
			variantKeys
		);

		if (
			needsSync &&
			normalizedAttributes.frontRenderMode === 'dom-prune' &&
			variantStructureIssue
		) {
			setStructureRepairNote(
				getVariantStructureRepairNote( variantStructureIssue )
			);
		}

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
		normalizedAttributes.frontRenderMode,
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
	const assignmentLabelText = normalizedAttributes.showRuntimeLabel
		? formatRuntimeLabel(
				normalizedAttributes.experimentId,
				activePreviewVariantKey,
				runtimeLabelSource,
				__( 'Winner preview (no resolved winner yet)', 'ab-test-block' )
		  )
		: '';
	const stickyBehaviorText = getStickyBehaviorText( normalizedAttributes );
	const frontEndOutputText = getFrontEndOutputText(
		normalizedAttributes.frontRenderMode
	);

	function refreshStats() {
		setStatsRefreshToken( ( current ) => current + 1 );
	}

	async function handleCopyExperimentId() {
		const didCopy = await copyTextToClipboard(
			normalizedAttributes.experimentId
		);
		setCopyExperimentIdStatus( didCopy ? 'copied' : 'error' );
	}

	function togglePrimaryCta( target: SelectedCtaTarget | undefined ) {
		if ( ! target ) {
			return;
		}

		const variantBlock = innerBlockByVariant.get( target.variantKey );

		if ( ! variantBlock ) {
			return;
		}

		const variantInnerBlocks = Array.isArray( variantBlock.innerBlocks )
			? variantBlock.innerBlocks
			: [];
		const managedTargets = collectPrimaryCtaTargets( variantInnerBlocks );
		const shouldEnable = ! hasClassNameToken(
			target.className,
			'abtest-cta'
		);

		managedTargets.forEach( ( managedTarget ) => {
			const isTargetBlock = managedTarget.clientId === target.clientId;
			const nextClassName = toggleClassNameToken(
				managedTarget.className,
				'abtest-cta',
				shouldEnable && isTargetBlock
			);
			const currentClassName = managedTarget.className ?? '';

			if ( nextClassName === currentClassName ) {
				return;
			}

			updateBlockAttributes( managedTarget.clientId, {
				className: nextClassName,
			} );
		} );
	}

	function startNewExperiment() {
		const { nextBlockInstanceId, nextExperimentId, nextPreviewQueryKey } =
			createFreshExperimentIdentity( normalizedAttributes );

		setPreviewMode( 'traffic' );
		setLastTrafficVariantKey( activePreviewVariantKey );
		selectBlock( clientId );
		setAttributes( {
			blockInstanceId: nextBlockInstanceId,
			experimentId: nextExperimentId,
			manualWinner: undefined,
			previewQueryKey: nextPreviewQueryKey,
			winnerMode:
				normalizedAttributes.winnerMode === 'manual'
					? 'off'
					: normalizedAttributes.winnerMode,
		} );
	}

	function useCurrentWinnerAsNewBaseline() {
		if ( ! currentResolvedWinnerVariantKey ) {
			return;
		}

		const winnerVariantBlock = innerBlockByVariant.get(
			currentResolvedWinnerVariantKey
		);

		if ( ! winnerVariantBlock ) {
			return;
		}

		const sourceInnerBlocks = Array.isArray(
			winnerVariantBlock.innerBlocks
		)
			? winnerVariantBlock.innerBlocks
			: [];
		variantKeys.forEach( ( variantKey ) => {
			const targetVariantBlock = innerBlockByVariant.get( variantKey );

			if (
				! targetVariantBlock ||
				variantKey === currentResolvedWinnerVariantKey
			) {
				return;
			}

			replaceInnerBlocks(
				targetVariantBlock.clientId,
				cloneInnerBlocks( sourceInnerBlocks ) as unknown[],
				false
			);
		} );

		const { nextBlockInstanceId, nextExperimentId, nextPreviewQueryKey } =
			createFreshExperimentIdentity( normalizedAttributes );

		setPreviewMode( 'traffic' );
		setLastTrafficVariantKey( currentResolvedWinnerVariantKey );
		selectBlock( clientId );
		setAttributes( {
			blockInstanceId: nextBlockInstanceId,
			experimentId: nextExperimentId,
			manualWinner: undefined,
			previewQueryKey: nextPreviewQueryKey,
			weights: equalizeWeights( normalizedAttributes.variantCount ),
			winnerMode: 'off',
		} );
	}

	function copyActiveVariantTo( targetVariantKey: VariantKey ) {
		if ( targetVariantKey === activePreviewVariantKey ) {
			return;
		}

		const sourceVariantBlock = innerBlockByVariant.get(
			activePreviewVariantKey
		);
		const targetVariantBlock = innerBlockByVariant.get( targetVariantKey );

		if ( ! sourceVariantBlock || ! targetVariantBlock ) {
			return;
		}

		replaceInnerBlocks(
			targetVariantBlock.clientId,
			cloneInnerBlocks(
				sourceVariantBlock.innerBlocks ?? []
			) as unknown[],
			false
		);
		selectBlock( clientId );
	}

	function swapPrimaryVariants() {
		if ( normalizedAttributes.variantCount !== 2 ) {
			return;
		}

		const variantABlock = innerBlockByVariant.get( 'a' );
		const variantBBlock = innerBlockByVariant.get( 'b' );

		if ( ! variantABlock || ! variantBBlock ) {
			return;
		}

		const variantABlocks = cloneInnerBlocks(
			variantABlock.innerBlocks ?? []
		);
		const variantBBlocks = cloneInnerBlocks(
			variantBBlock.innerBlocks ?? []
		);

		replaceInnerBlocks(
			variantABlock.clientId,
			variantBBlocks as unknown[],
			false
		);
		replaceInnerBlocks(
			variantBBlock.clientId,
			variantABlocks as unknown[],
			false
		);
		selectBlock( clientId );
	}

	function openDiagnosticsPanel( onClose?: () => void ) {
		setIsDiagnosticsPanelOpen( true );
		onClose?.();
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
							aria-label={ sprintf(
								/* translators: %s: variant key */
								__( 'Edit Variant %s', 'ab-test-block' ),
								variantKey.toUpperCase()
							) }
							showTooltip
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
						label={ __( 'Preview traffic mode', 'ab-test-block' ) }
						aria-label={ __(
							'Preview traffic mode',
							'ab-test-block'
						) }
						showTooltip
						onClick={ previewTrafficMode }
					>
						{ __( 'Traffic', 'ab-test-block' ) }
					</ToolbarButton>
					<ToolbarButton
						isPressed={ previewMode === 'winner' }
						label={ __( 'Preview winner mode', 'ab-test-block' ) }
						aria-label={ __(
							'Preview winner mode',
							'ab-test-block'
						) }
						showTooltip
						onClick={ previewWinnerMode }
					>
						{ __( 'Winner', 'ab-test-block' ) }
					</ToolbarButton>
				</ToolbarGroup>
				<ToolbarGroup>
					<ToolbarButton
						isPressed={ normalizedAttributes.showRuntimeLabel }
						label={ __(
							'Toggle assignment label',
							'ab-test-block'
						) }
						aria-label={ __(
							'Toggle assignment label',
							'ab-test-block'
						) }
						showTooltip
						onClick={ () =>
							updateAttribute(
								'showRuntimeLabel',
								! normalizedAttributes.showRuntimeLabel
							)
						}
					>
						{ __( 'Assignment', 'ab-test-block' ) }
					</ToolbarButton>
				</ToolbarGroup>
				{ canManageSelectedPrimaryCta && selectedCtaTarget && (
					<ToolbarGroup>
						<ToolbarButton
							isPressed={ isSelectedPrimaryCta }
							label={ __(
								'Toggle primary CTA',
								'ab-test-block'
							) }
							aria-label={
								isSelectedPrimaryCta
									? __(
											'Remove primary CTA',
											'ab-test-block'
									  )
									: __(
											'Mark as primary CTA',
											'ab-test-block'
									  )
							}
							showTooltip
							onClick={ () =>
								togglePrimaryCta( selectedCtaTarget )
							}
						>
							{ __( 'Primary CTA', 'ab-test-block' ) }
						</ToolbarButton>
					</ToolbarGroup>
				) }
				<ToolbarGroup>
					<Dropdown
						className="wp-block-abtest-block-test__toolbar-dropdown"
						contentClassName="wp-block-abtest-block-test__toolbar-dropdown-content"
						popoverProps={ { placement: 'bottom-end' } }
						renderToggle={ ( { isOpen, onToggle } ) => (
							<ToolbarButton
								aria-expanded={ isOpen }
								aria-label={ __(
									'Open quick summary and actions',
									'ab-test-block'
								) }
								label={ __(
									'Open quick summary and actions',
									'ab-test-block'
								) }
								showTooltip
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
								<MenuGroup
									label={ __(
										'Variant tools',
										'ab-test-block'
									) }
								>
									{ variantKeys
										.filter(
											( variantKey ) =>
												variantKey !==
												activePreviewVariantKey
										)
										.map( ( variantKey ) => (
											<MenuItem
												key={ variantKey }
												onClick={ () => {
													copyActiveVariantTo(
														variantKey
													);
													onClose();
												} }
											>
												{ sprintf(
													/* translators: %s: variant key */
													__(
														'Copy active variant to %s',
														'ab-test-block'
													),
													`Variant ${ variantKey.toUpperCase() }`
												) }
											</MenuItem>
										) ) }
									{ normalizedAttributes.variantCount ===
										2 && (
										<MenuItem
											onClick={ () => {
												swapPrimaryVariants();
												onClose();
											} }
										>
											{ __(
												'Swap A and B',
												'ab-test-block'
											) }
										</MenuItem>
									) }
								</MenuGroup>
								<div className="wp-block-abtest-block-test__toolbar-info">
									<p className="wp-block-abtest-block-test__toolbar-info-title">
										{ __(
											'Quick summary',
											'ab-test-block'
										) }
									</p>
									<dl className="wp-block-abtest-block-test__toolbar-info-grid">
										<div>
											<dt>
												{ __(
													'Experiment label',
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
													'Sticky behavior',
													'ab-test-block'
												) }
											</dt>
											<dd>{ stickyBehaviorText }</dd>
										</div>
										<div>
											<dt>
												{ __(
													'Front-end output',
													'ab-test-block'
												) }
											</dt>
											<dd>{ frontEndOutputText }</dd>
										</div>
									</dl>
									<Button
										variant="secondary"
										onClick={ () =>
											openDiagnosticsPanel( onClose )
										}
									>
										{ __(
											'Open diagnostics',
											'ab-test-block'
										) }
									</Button>
								</div>
							</div>
						) }
					/>
				</ToolbarGroup>
			</BlockControls>
			<InspectorControls>
				<PanelBody
					title={ __( 'Preview', 'ab-test-block' ) }
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
							'Traffic mode edits one variant at a time. Winner preview lets you inspect the resolved winner without changing saved settings.',
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
									'Winner preview has no resolved variant to show yet.',
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
							'Readable name shown in the editor and Diagnostics.',
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
					title={ __( 'Experiment Identity', 'ab-test-block' ) }
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
							'Stable key used for preview links, shared sticky scope, and aggregate stats.',
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
							'Supports both ?your_key=b and ?abtest=experimentId:b.',
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
										'Keeps the assigned variant stable for the current browser using a first-party cookie.',
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
					title={ __( 'Experiment lifecycle', 'ab-test-block' ) }
					initialOpen={ false }
				>
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Start a fresh experiment without deleting prior stats. The current content stays in place while new IDs begin a new history.',
							'ab-test-block'
						) }
					</Notice>
					<div className="wp-block-abtest-block-test__field-actions">
						<Button
							variant="secondary"
							onClick={ startNewExperiment }
						>
							{ __( 'Start new experiment', 'ab-test-block' ) }
						</Button>
						<Button
							variant="secondary"
							disabled={ ! currentResolvedWinnerVariantKey }
							onClick={ useCurrentWinnerAsNewBaseline }
						>
							{ __(
								'Use current winner as new baseline',
								'ab-test-block'
							) }
						</Button>
					</div>
					{ currentResolvedWinnerVariantKey ? (
						<p className="wp-block-abtest-block-test__sidebar-note">
							{ sprintf(
								/* translators: %s: variant key */
								__(
									'Current resolved winner: Variant %s.',
									'ab-test-block'
								),
								currentResolvedWinnerVariantKey.toUpperCase()
							) }
						</p>
					) : (
						<p className="wp-block-abtest-block-test__sidebar-note">
							{ __(
								'Use current winner as new baseline becomes available after a manual or automatic winner resolves.',
								'ab-test-block'
							) }
						</p>
					) }
				</PanelBody>
				<PanelBody
					title={ __( 'Front-end Output', 'ab-test-block' ) }
					initialOpen={ false }
				>
					<SelectControl
						label={ __( 'Front-end output', 'ab-test-block' ) }
						value={ normalizedAttributes.frontRenderMode }
						options={ [
							{
								label: __(
									'Only render chosen variant',
									'ab-test-block'
								),
								value: 'dom-prune',
							},
							{
								label: __(
									'Keep all variants in HTML',
									'ab-test-block'
								),
								value: 'css-hide',
							},
						] }
						onChange={ ( value ) =>
							updateAttribute(
								'frontRenderMode',
								value as FrontRenderMode
							)
						}
						help={
							normalizedAttributes.frontRenderMode === 'css-hide'
								? __(
										'Compatibility mode. Keep every variant in the front-end HTML and hide inactive variants after hydration.',
										'ab-test-block'
								  )
								: __(
										'Recommended. Only the chosen variant is rendered into the front-end HTML.',
										'ab-test-block'
								  )
						}
					/>
				</PanelBody>
				<PanelBody
					title={ __( 'Labels & Hints', 'ab-test-block' ) }
					initialOpen={ false }
				>
					<ToggleControl
						label={ __( 'Show assignment label', 'ab-test-block' ) }
						checked={ normalizedAttributes.showRuntimeLabel }
						onChange={ ( value ) =>
							updateAttribute( 'showRuntimeLabel', value )
						}
						help={ __(
							'Show the same assignment label in the editor preview and on the front end.',
							'ab-test-block'
						) }
					/>
					<ToggleControl
						label={ __(
							'Show assignment note in diagnostics',
							'ab-test-block'
						) }
						checked={ showAssignmentLabel }
						onChange={ setShowAssignmentLabel }
					/>
					<ToggleControl
						label={ __(
							'Show winner note in diagnostics',
							'ab-test-block'
						) }
						checked={ showWinnerState }
						onChange={ setShowWinnerState }
					/>
					<ToggleControl
						label={ __(
							'Show query preview hints',
							'ab-test-block'
						) }
						checked={ enableQueryPreviewHints }
						onChange={ setEnableQueryPreviewHints }
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
							'Clicks record the first primary CTA click per page. Mark a CTA from the editor when a button or link block is selected. Custom HTML can still use data-abtest-cta manually. Without an explicit marker, links and buttons fall back automatically.',
							'ab-test-block'
						) }
					</Notice>
					<Button
						variant="secondary"
						disabled={ ! canManageTrackingPanelPrimaryCta }
						onClick={ () =>
							togglePrimaryCta( trackingPanelCtaTarget )
						}
					>
						{ isTrackingPanelPrimaryCta
							? __( 'Remove primary CTA', 'ab-test-block' )
							: __( 'Mark as primary CTA', 'ab-test-block' ) }
					</Button>
					<p className="wp-block-abtest-block-test__sidebar-note">
						{ canManageTrackingPanelPrimaryCta
							? sprintf(
									/* translators: 1: block label, 2: variant key */
									__(
										'Current selection: %1$s in Variant %2$s.',
										'ab-test-block'
									),
									trackingPanelPrimaryCtaLabel,
									trackingPanelCtaTarget?.variantKey.toUpperCase() ??
										'A'
							  )
							: __(
									'Select a button or link block inside a variant to mark it as the primary CTA.',
									'ab-test-block'
							  ) }
					</p>
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
				<PanelBody
					ref={ diagnosticsPanelRef }
					title={ __( 'Diagnostics', 'ab-test-block' ) }
					opened={ isDiagnosticsPanelOpen }
					onToggle={ setIsDiagnosticsPanelOpen }
				>
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Saved server stats appear here for this block and the shared experiment. Preview mode never writes new stats.',
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
						{ structureRepairNote && (
							<Notice status="warning" isDismissible={ false }>
								{ structureRepairNote }
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
							{ __( 'Notes', 'ab-test-block' ) }
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
						{ structureRepairNote && (
							<p className="wp-block-abtest-block-test__sidebar-note">
								{ structureRepairNote }
							</p>
						) }
					</div>
				</PanelBody>
			</InspectorControls>
			<div
				{ ...useBlockProps( {
					className: 'wp-block-abtest-block-test',
				} ) }
			>
				{ assignmentLabelText && (
					<p className="wp-block-abtest-block-test__runtime-label">
						{ assignmentLabelText }
					</p>
				) }
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
			reasonCode: 'manual',
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
				reasonCode: 'locked',
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
				reasonCode: 'candidate',
				source: 'automatic-candidate',
				status: storedWinnerEvaluation.status,
				variant: storedWinnerEvaluation.winner,
			};
		}

		return {
			reasonCode: storedWinnerEvaluation.reasonCode,
			source: 'no-winner',
			status: 'no-winner',
		};
	}

	if ( attributes.winnerMode === 'off' ) {
		return {
			reasonCode: 'off',
			source: 'off',
			status: 'off',
		};
	}

	return {
		reasonCode: 'insufficient-data',
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
				'Editing Variant %1$s in traffic mode. Delivery: %2$s.',
				'ab-test-block'
			),
			activeVariantKey.toUpperCase(),
			formatWeightSummary( attributes.weights, attributes.variantCount )
		);
	}

	if ( winnerPreviewState.variant ) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Winner preview is showing Variant %s.', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	return sprintf(
		/* translators: %s: winner reason summary */
		__( 'Winner preview is enabled, but %s.', 'ab-test-block' ),
		getWinnerReasonText( winnerPreviewState.reasonCode ).toLowerCase()
	);
}

function getAssignmentPreviewText(
	previewMode: EditorPreviewMode,
	activeVariantKey: VariantKey,
	winnerPreviewState: WinnerPreviewState
) {
	if ( previewMode === 'winner' && winnerPreviewState.variant ) {
		let previewSource: string = __(
			'automatic winner candidate',
			'ab-test-block'
		);

		if ( winnerPreviewState.source === 'manual-winner' ) {
			previewSource = __( 'manual winner', 'ab-test-block' );
		} else if ( winnerPreviewState.source === 'automatic-winner-locked' ) {
			previewSource = __( 'locked automatic winner', 'ab-test-block' );
		}

		return sprintf(
			/* translators: 1: variant key, 2: preview source */
			__( 'Previewing Variant %1$s from %2$s.', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase(),
			previewSource
		);
	}

	if ( previewMode === 'winner' ) {
		return sprintf(
			/* translators: %s: winner reason summary */
			__( 'Winner preview is active. %s.', 'ab-test-block' ),
			getWinnerReasonText( winnerPreviewState.reasonCode )
		);
	}

	return sprintf(
		/* translators: %s: variant key */
		__( 'Previewing Variant %s in traffic mode.', 'ab-test-block' ),
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
			__( 'Manual winner: Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'winner-locked' &&
		winnerPreviewState.variant
	) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Winner locked: Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'candidate' &&
		winnerPreviewState.variant
	) {
		return sprintf(
			/* translators: %s: variant key */
			__( 'Automatic winner candidate: Variant %s', 'ab-test-block' ),
			winnerPreviewState.variant.toUpperCase()
		);
	}

	if (
		winnerPreviewState.status === 'off' ||
		attributes.winnerMode === 'off'
	) {
		return __( 'Automatic winner is off', 'ab-test-block' );
	}

	return getWinnerReasonText( winnerPreviewState.reasonCode );
}

function getAssignmentSourceText(
	attributes: AbTestExperimentAttributes,
	previewMode: EditorPreviewMode,
	winnerPreviewState: WinnerPreviewState
) {
	if ( previewMode === 'winner' ) {
		if ( winnerPreviewState.source === 'manual-winner' ) {
			return __( 'Manual winner preview', 'ab-test-block' );
		}

		if ( winnerPreviewState.source === 'automatic-winner-locked' ) {
			return __( 'Locked automatic winner', 'ab-test-block' );
		}

		if ( winnerPreviewState.source === 'automatic-candidate' ) {
			return __( 'Automatic winner candidate', 'ab-test-block' );
		}

		return getWinnerReasonText( winnerPreviewState.reasonCode );
	}

	if ( ! attributes.stickyAssignment ) {
		return getAssignmentSourceLabel( 'weighted-random' );
	}

	if ( attributes.stickyScope === 'experiment' ) {
		return __( 'Sticky assignment for this experiment', 'ab-test-block' );
	}

	return __( 'Sticky assignment for this block', 'ab-test-block' );
}

function getWinnerReasonText( reasonCode: WinnerReasonCode ) {
	switch ( reasonCode ) {
		case 'off':
			return __( 'Automatic winner is off', 'ab-test-block' );
		case 'manual':
			return __( 'Manual winner is in use', 'ab-test-block' );
		case 'locked':
			return __( 'A locked winner is already set', 'ab-test-block' );
		case 'candidate':
			return __(
				'An automatic winner candidate is ready',
				'ab-test-block'
			);
		case 'thresholds-not-met':
			return __( 'No winner yet: minimum data not met', 'ab-test-block' );
		case 'tie':
			return __( 'No winner yet: tied CTR', 'ab-test-block' );
		case 'insufficient-data':
		default:
			return __( 'No winner yet: not enough data', 'ab-test-block' );
	}
}

function getStickyBehaviorText( attributes: AbTestExperimentAttributes ) {
	if ( ! attributes.stickyAssignment ) {
		return String( __( 'Recalculate on each page load', 'ab-test-block' ) );
	}

	if ( attributes.stickyScope === 'experiment' ) {
		return String(
			__( 'Remember across this experiment', 'ab-test-block' )
		);
	}

	return String( __( 'Remember for this block', 'ab-test-block' ) );
}

function getFrontEndOutputText( frontRenderMode: FrontRenderMode ) {
	if ( frontRenderMode === 'css-hide' ) {
		return __( 'Keep all variants in HTML', 'ab-test-block' );
	}

	return __( 'Only render chosen variant', 'ab-test-block' );
}

function getVariantStructureIssue(
	innerBlocks: BlockRecord[],
	variantKeys: VariantKey[]
): VariantStructureIssue | undefined {
	const validVariantKeys = innerBlocks
		.map( ( block ) => block.attributes.variantKey )
		.filter( isVariantKeyValue );
	const missingVariantKeys = variantKeys.filter(
		( key ) => ! validVariantKeys.includes( key )
	);
	const orderMismatch =
		validVariantKeys.length !== variantKeys.length ||
		validVariantKeys.some( ( key, index ) => variantKeys[ index ] !== key );

	if ( missingVariantKeys.length === 0 && ! orderMismatch ) {
		return undefined;
	}

	return {
		fallbackVariant: validVariantKeys[ 0 ],
		missingVariantKeys,
	};
}

function getVariantStructureRepairNote( issue: VariantStructureIssue ) {
	if ( issue.fallbackVariant && issue.missingVariantKeys.length > 0 ) {
		return sprintf(
			/* translators: 1: fallback variant key, 2: comma-separated missing variant keys */
			__(
				'Saved content was missing Variant %2$s. The editor rebuilt the expected slots, and front-end output would fall back to Variant %1$s until you save this repaired block.',
				'ab-test-block'
			),
			issue.fallbackVariant.toUpperCase(),
			issue.missingVariantKeys
				.map( ( key ) => key.toUpperCase() )
				.join( ', ' )
		);
	}

	if ( issue.fallbackVariant ) {
		return sprintf(
			/* translators: %s: fallback variant key */
			__(
				'Saved content was out of sync with the expected variant structure. The editor rebuilt the slots, and front-end output would currently fall back to Variant %s until you save the repaired block.',
				'ab-test-block'
			),
			issue.fallbackVariant.toUpperCase()
		);
	}

	return __(
		'Saved content did not contain a renderable variant block. The editor rebuilt the expected slots; save the post to restore front-end output.',
		'ab-test-block'
	);
}

function getRuntimeLabelSource(
	attributes: AbTestExperimentAttributes,
	previewMode: EditorPreviewMode,
	winnerPreviewState: WinnerPreviewState
): AssignmentSource | undefined {
	if ( previewMode === 'winner' ) {
		if ( winnerPreviewState.source === 'manual-winner' ) {
			return 'manual-winner';
		}

		if ( winnerPreviewState.source === 'automatic-winner-locked' ) {
			return 'locked-winner';
		}

		if ( winnerPreviewState.source === 'automatic-candidate' ) {
			return 'automatic-winner';
		}

		return undefined;
	}

	if ( ! attributes.stickyAssignment ) {
		return 'weighted-random';
	}

	return 'sticky';
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

function collectPrimaryCtaTargets( blocks: BlockRecord[] ) {
	const targets: Array< { className?: string; clientId: string } > = [];

	const visit = ( entries: BlockRecord[] ) => {
		entries.forEach( ( block ) => {
			const blockType = block.name
				? getBlockType( block.name )
				: undefined;

			if ( blockType && blockType.supports?.className !== false ) {
				targets.push( {
					className:
						typeof block.attributes.className === 'string'
							? block.attributes.className
							: undefined,
					clientId: block.clientId,
				} );
			}

			if ( Array.isArray( block.innerBlocks ) ) {
				visit( block.innerBlocks );
			}
		} );
	};

	visit( blocks );

	return targets;
}

function hasClassNameToken( className: string | undefined, token: string ) {
	return (
		className?.split( /\s+/ ).some( ( item ) => item.trim() === token ) ??
		false
	);
}

function toggleClassNameToken(
	className: string | undefined,
	token: string,
	enabled: boolean
) {
	const values = ( className ?? '' )
		.split( /\s+/ )
		.map( ( item ) => item.trim() )
		.filter( Boolean )
		.filter( ( item ) => item !== token );

	if ( enabled ) {
		values.push( token );
	}

	return values.join( ' ' );
}

function cloneInnerBlocks( blocks: BlockRecord[] ) {
	if ( blocks.length === 0 ) {
		return [];
	}

	return parse(
		serialize( blocks as Parameters< typeof serialize >[ 0 ] )
	) as unknown as BlockRecord[];
}

function createFreshExperimentIdentity(
	attributes: AbTestExperimentAttributes
) {
	const nextBlockInstanceId = generateBlockInstanceId();
	const nextExperimentId = generateExperimentId( nextBlockInstanceId );
	const currentDefaultPreviewQueryKey = getDefaultPreviewQueryKey(
		attributes.experimentId
	);

	return {
		nextBlockInstanceId,
		nextExperimentId,
		nextPreviewQueryKey:
			attributes.previewQueryKey === currentDefaultPreviewQueryKey
				? getDefaultPreviewQueryKey( nextExperimentId )
				: attributes.previewQueryKey,
	};
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
