import { getBlockType } from '@wordpress/blocks';
import {
	BlockControls,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { ToolbarButton, ToolbarGroup } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { Fragment, type ComponentType } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';

type VariantInnerBlock = {
	attributes: Record< string, unknown >;
	clientId: string;
	innerBlocks?: Array< unknown >;
	name: string;
};

function PrimaryCtaToolbar( { clientId }: { clientId: string } ) {
	const { isPrimaryCta, selectedTarget } = useSelect(
		( select: any ) => {
			const editor = select( blockEditorStore );
			const currentBlock = editor.getBlock( clientId );

			if (
				! currentBlock ||
				editor.getSelectedBlockClientId() !== clientId
			) {
				return {
					isPrimaryCta: false,
					selectedTarget: undefined,
				};
			}

			const parentClientIds = editor.getBlockParents(
				clientId
			) as string[];
			const isInsideExperiment = parentClientIds.some(
				( parentClientId ) => {
					const parentBlock = editor.getBlock( parentClientId );
					return parentBlock?.name === 'abtest-block/test';
				}
			);
			const variantClientId = parentClientIds.find(
				( parentClientId ) => {
					const parentBlock = editor.getBlock( parentClientId );
					return parentBlock?.name === 'abtest-block/variant';
				}
			);
			const blockType = getBlockType( currentBlock.name );
			const canManageCurrentBlock = Boolean(
				isInsideExperiment &&
					variantClientId &&
					blockType &&
					blockType.supports?.className !== false
			);

			if ( ! canManageCurrentBlock || ! variantClientId ) {
				return {
					isPrimaryCta: false,
					selectedTarget: undefined,
				};
			}

			return {
				isPrimaryCta: hasClassNameToken(
					typeof currentBlock.attributes.className === 'string'
						? currentBlock.attributes.className
						: undefined,
					'abtest-cta'
				),
				selectedTarget: {
					className:
						typeof currentBlock.attributes.className === 'string'
							? currentBlock.attributes.className
							: undefined,
					clientId,
					variantInnerBlocks:
						( editor.getBlock( variantClientId )
							?.innerBlocks as VariantInnerBlock[] ) ?? [],
				},
			};
		},
		[ clientId ]
	);
	const { updateBlockAttributes } = useDispatch(
		blockEditorStore as never
	) as {
		updateBlockAttributes: (
			targetClientId: string,
			nextAttributes: Record< string, unknown >
		) => void;
	};

	if ( ! selectedTarget ) {
		return null;
	}

	const currentSelectedTarget = selectedTarget;

	function togglePrimaryCta() {
		const shouldEnable = ! hasClassNameToken(
			currentSelectedTarget.className,
			'abtest-cta'
		);

		collectPrimaryCtaTargets(
			currentSelectedTarget.variantInnerBlocks
		).forEach( ( target ) => {
			const isTargetBlock =
				target.clientId === currentSelectedTarget.clientId;
			const nextClassName = toggleClassNameToken(
				target.className,
				'abtest-cta',
				shouldEnable && isTargetBlock
			);
			const currentClassName = target.className ?? '';

			if ( nextClassName === currentClassName ) {
				return;
			}

			updateBlockAttributes( target.clientId, {
				className: nextClassName,
			} );
		} );
	}

	return (
		<BlockControls>
			<ToolbarGroup>
				<ToolbarButton
					isPressed={ isPrimaryCta }
					label={ __( 'Primary CTA', 'ab-test-block' ) }
					aria-label={
						isPrimaryCta
							? __( 'Remove primary CTA', 'ab-test-block' )
							: __( 'Mark as primary CTA', 'ab-test-block' )
					}
					showTooltip
					onClick={ togglePrimaryCta }
				>
					{ __( 'Primary CTA', 'ab-test-block' ) }
				</ToolbarButton>
			</ToolbarGroup>
		</BlockControls>
	);
}

function withPrimaryCtaToolbar( BlockEdit: ComponentType< any > ) {
	return function AbTestPrimaryCtaBlockEdit( props: any ) {
		if (
			props.name === 'abtest-block/test' ||
			props.name === 'abtest-block/variant'
		) {
			return <BlockEdit { ...props } />;
		}

		return (
			<Fragment>
				<BlockEdit { ...props } />
				<PrimaryCtaToolbar clientId={ props.clientId } />
			</Fragment>
		);
	};
}

addFilter(
	'editor.BlockEdit',
	'abtest-block/primary-cta-toolbar',
	withPrimaryCtaToolbar
);

function collectPrimaryCtaTargets( blocks: VariantInnerBlock[] ) {
	const targets: Array< { className?: string; clientId: string } > = [];
	const queue = [ ...blocks ];

	while ( queue.length > 0 ) {
		const block = queue.shift();

		if ( ! block ) {
			continue;
		}

		const blockType = getBlockType( block.name );

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
			queue.push( ...( block.innerBlocks as VariantInnerBlock[] ) );
		}
	}

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
