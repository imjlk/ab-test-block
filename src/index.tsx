import { registerBlockType } from '@wordpress/blocks';
import type { BlockConfiguration } from '@wordpress/blocks';

import Edit from './edit';
import Save from './save';
import metadata from './block.json';
import './style.scss';

import type { AbTestBlockAttributes } from './types';

const blockMetadata = metadata as BlockConfiguration< AbTestBlockAttributes > & {
	name: string;
};

registerBlockType< AbTestBlockAttributes >( blockMetadata.name, {
	title: blockMetadata.title,
	description: blockMetadata.description,
	category: blockMetadata.category as any,
	icon: blockMetadata.icon as any,
	supports: blockMetadata.supports,
	attributes: blockMetadata.attributes,
	example: blockMetadata.example,
	edit: Edit,
	save: Save,
} );
