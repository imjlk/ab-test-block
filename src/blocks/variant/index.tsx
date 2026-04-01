import { registerBlockType } from '@wordpress/blocks';
import type { BlockConfiguration } from '@wordpress/blocks';

import Edit from './edit';
import Save from './save';
import metadata from './block.json';
import './editor.scss';

import type { AbTestVariantAttributes } from '../../types';

const blockMetadata =
	metadata as BlockConfiguration< AbTestVariantAttributes > & {
		name: string;
	};

registerBlockType< AbTestVariantAttributes >( blockMetadata.name, {
	...blockMetadata,
	edit: Edit,
	save: Save,
} );
