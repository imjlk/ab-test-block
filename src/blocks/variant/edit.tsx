import {
	InnerBlocks,
	store as blockEditorStore,
	useBlockEditContext,
	useBlockProps,
} from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';

import type { AbTestVariantAttributes } from '../../types';
import { DEFAULT_EDITOR_UI, editorUiStore } from '../test/editor-ui-store';

export default function Edit( {
	attributes,
}: {
	attributes: Partial< AbTestVariantAttributes >;
} ) {
	const { clientId } = useBlockEditContext();
	const { isActive, isSelected } = useSelect(
		( select: any ) => {
			const editor = select( blockEditorStore );
			const parentClientId =
				(
					editor.getBlockParentsByBlockName(
						clientId,
						'abtest-block/test'
					) as string[]
				 )?.[ 0 ] ?? '';
			const uiState = parentClientId
				? select( editorUiStore ).getUi( parentClientId )
				: DEFAULT_EDITOR_UI;
			const variantKey = attributes.variantKey ?? 'a';
			const blockSelected =
				editor.isBlockSelected( clientId ) ||
				editor.hasSelectedInnerBlock( clientId, true );
			const parentSelected = parentClientId
				? editor.isBlockSelected( parentClientId )
				: false;

			return {
				isActive:
					blockSelected ||
					( parentSelected &&
						uiState.visibleVariantKey === variantKey ),
				isSelected: blockSelected,
			};
		},
		[ attributes.variantKey, clientId ]
	);

	return (
		<div
			{ ...useBlockProps( {
				className: `wp-block-abtest-block-variant ${
					isActive ? 'is-active' : 'is-inactive'
				}${ isSelected ? ' is-selected-view' : '' }`,
				'data-abtest-editor-variant': attributes.variantKey ?? 'a',
			} ) }
		>
			{ isActive ? (
				<>
					<InnerBlocks renderAppender={ () => null } />
					<div className="wp-block-abtest-block-variant__appender">
						<InnerBlocks.DefaultBlockAppender />
					</div>
				</>
			) : null }
		</div>
	);
}
