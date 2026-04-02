import { registerBlockType } from '@wordpress/blocks';
import type { BlockConfiguration } from '@wordpress/blocks';

import Edit from './edit';
import Save from './save';
import metadata from './block.json';
import './editor-ui-store';
import './editor.scss';
import './style.scss';

import type { AbTestExperimentAttributes } from '../../types';

const blockMetadata =
	metadata as BlockConfiguration< AbTestExperimentAttributes > & {
		name: string;
	};

registerBlockType< AbTestExperimentAttributes >( blockMetadata.name, {
	...blockMetadata,
	edit: Edit,
	save: Save,
} );
