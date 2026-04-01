import {
	InnerBlocks,
	store as blockEditorStore,
	useBlockEditContext,
	useBlockProps,
} from '@wordpress/block-editor';
import { Button } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';

import { getVariantLabel } from '../../lib/experiment';
import type { AbTestVariantAttributes } from '../../types';

export default function Edit( {
	attributes,
}: {
	attributes: Partial< AbTestVariantAttributes >;
} ) {
	const { clientId } = useBlockEditContext();
	const isActive = useSelect(
		( select: any ) => {
			const editor = select( blockEditorStore );
			return (
				editor.isBlockSelected( clientId ) ||
				editor.hasSelectedInnerBlock( clientId, true )
			);
		},
		[ clientId ]
	);
	const { selectBlock } = useDispatch( blockEditorStore as never ) as {
		selectBlock: ( targetClientId?: string ) => void;
	};
	const variantKey = attributes.variantKey ?? 'a';
	const label = attributes.variantLabel || getVariantLabel( variantKey );

	return (
		<div
			{ ...useBlockProps( {
				className: `wp-block-abtest-block-variant ${
					isActive ? 'is-active' : 'is-collapsed'
				}`,
				'data-abtest-editor-variant': variantKey,
			} ) }
		>
			<div className="wp-block-abtest-block-variant__header">
				<div>
					<p className="wp-block-abtest-block-variant__eyebrow">
						{ __( 'Variant', 'ab-test-block' ) }
					</p>
					<h4>{ label }</h4>
				</div>
				{ ! isActive && (
					<Button
						variant="secondary"
						onClick={ () => selectBlock( clientId ) }
					>
						{ __( 'Edit', 'ab-test-block' ) }
					</Button>
				) }
			</div>
			{ isActive ? (
				<InnerBlocks
					renderAppender={ InnerBlocks.ButtonBlockAppender }
				/>
			) : (
				<p className="wp-block-abtest-block-variant__placeholder">
					{ __(
						'Select this variant to edit its content.',
						'ab-test-block'
					) }
				</p>
			) }
		</div>
	);
}
