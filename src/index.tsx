import { registerBlockType } from '@wordpress/blocks';

import Edit from './edit';
import Save from './save';
import metadata from './block.json';
import './style.scss';

import type { AbTestBlockAttributes } from './types';

registerBlockType< AbTestBlockAttributes >( metadata.name, {
	title: metadata.title,
	description: metadata.description,
	category: metadata.category as any,
	icon: metadata.icon as any,
	supports: metadata.supports,
	attributes: metadata.attributes,
	example: metadata.example,
	edit: Edit,
	save: Save,
} );
