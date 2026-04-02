import { createReduxStore, register, select } from '@wordpress/data';

import type { VariantKey } from '../../types';

export type EditorPreviewMode = 'traffic' | 'winner';

type EditorUiState = {
	byParentClientId: Record<
		string,
		{
			previewMode: EditorPreviewMode;
			trafficVariantKey: VariantKey;
			visibleVariantKey: VariantKey;
		}
	>;
};

type SetUiAction = {
	type: 'SET_UI';
	parentClientId: string;
	value: Partial< EditorUiState[ 'byParentClientId' ][ string ] >;
};

type ClearUiAction = {
	type: 'CLEAR_UI';
	parentClientId: string;
};

type Action = SetUiAction | ClearUiAction;

export const STORE_NAME = 'abtest-block/editor-ui';

export const DEFAULT_EDITOR_UI = {
	previewMode: 'traffic' as EditorPreviewMode,
	trafficVariantKey: 'a' as VariantKey,
	visibleVariantKey: 'a' as VariantKey,
};

const reducer = (
	state: EditorUiState = { byParentClientId: {} },
	action: Action
): EditorUiState => {
	switch ( action.type ) {
		case 'SET_UI':
			return {
				...state,
				byParentClientId: {
					...state.byParentClientId,
					[ action.parentClientId ]: {
						...DEFAULT_EDITOR_UI,
						...state.byParentClientId[ action.parentClientId ],
						...action.value,
					},
				},
			};
		case 'CLEAR_UI': {
			const nextUi = { ...state.byParentClientId };
			delete nextUi[ action.parentClientId ];

			return {
				...state,
				byParentClientId: nextUi,
			};
		}
	}

	return state;
};

const selectors = {
	getUi( state: EditorUiState, parentClientId: string ) {
		return state.byParentClientId[ parentClientId ] ?? DEFAULT_EDITOR_UI;
	},
};

const actions = {
	setUi(
		parentClientId: string,
		value: Partial< EditorUiState[ 'byParentClientId' ][ string ] >
	): SetUiAction {
		return {
			type: 'SET_UI',
			parentClientId,
			value,
		};
	},
	clearUi( parentClientId: string ): ClearUiAction {
		return {
			type: 'CLEAR_UI',
			parentClientId,
		};
	},
};

export const editorUiStore = createReduxStore( STORE_NAME, {
	reducer,
	selectors,
	actions,
} );

if ( ! select( editorUiStore ) ) {
	register( editorUiStore );
}
