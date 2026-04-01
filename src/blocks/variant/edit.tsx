import {
	InnerBlocks,
	store as blockEditorStore,
	useBlockEditContext,
	useBlockProps,
} from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';

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

	return (
		<div
			{ ...useBlockProps( {
				className: `wp-block-abtest-block-variant ${
					isActive ? 'is-active' : 'is-inactive'
				}`,
				'data-abtest-editor-variant': attributes.variantKey ?? 'a',
			} ) }
		>
			{ isActive ? (
				<InnerBlocks
					renderAppender={ InnerBlocks.ButtonBlockAppender }
				/>
			) : null }
		</div>
	);
}
