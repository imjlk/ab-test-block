import { InnerBlocks, useBlockProps } from '@wordpress/block-editor';

import type { AbTestVariantAttributes } from '../../types';

export default function Save( {
	attributes,
}: {
	attributes: AbTestVariantAttributes;
} ) {
	return (
		<div
			{ ...useBlockProps.save( {
				'data-abtest-variant': attributes.variantKey,
				'data-variant-label': attributes.variantLabel,
			} ) }
		>
			<InnerBlocks.Content />
		</div>
	);
}
