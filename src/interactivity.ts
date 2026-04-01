import { getContext, store } from '@wordpress/interactivity';

import { fetchCounter, incrementCounter } from './api';
import type { AbTestBlockContext, AbTestBlockState } from './types';

function hasExpiredPublicWriteToken(
	context: AbTestBlockContext
): boolean {
	return (
		context.persistencePolicy === 'public' && typeof context.publicWriteExpiresAt === 'number' && context.publicWriteExpiresAt > 0 && Date.now() >= context.publicWriteExpiresAt * 1000
	);
}

function getWriteBlockedMessage(
	context: AbTestBlockContext
): string {
	return context.persistencePolicy === 'authenticated'
		? 'Sign in to persist this counter.'
		: 'Reload the page to refresh this write token.';
}

const { actions, state } = store( 'ab-test-block', {
	state: {
		canWrite: false,
		count: 0,
		error: undefined,
		isHydrated: false,
		isLoading: false,
		isSaving: false,
		isVisible: true,
	} as AbTestBlockState,

	actions: {
		async loadCounter() {
			const context = getContext< AbTestBlockContext >();
			if ( context.postId <= 0 || ! context.resourceKey ) {
				return;
			}

			state.isLoading = true;
			state.error = undefined;

			try {
				const result = await fetchCounter( {
					postId: context.postId,
					resourceKey: context.resourceKey,
				} );
				if ( ! result.isValid || ! result.data ) {
					state.error = result.errors[ 0 ]?.expected ?? 'Unable to load counter';
					return;
				}
				context.count = result.data.count;
				context.storage = result.data.storage;
				state.count = result.data.count;
			} catch ( error ) {
				state.error =
					error instanceof Error ? error.message : 'Unknown loading error';
			} finally {
				state.isLoading = false;
			}
		},
		async increment() {
			const context = getContext< AbTestBlockContext >();
			if ( context.postId <= 0 || ! context.resourceKey ) {
				return;
			}
			if ( hasExpiredPublicWriteToken( context ) ) {
				context.canWrite = false;
				state.canWrite = false;
				state.error = getWriteBlockedMessage( context );
				return;
			}
			if ( ! context.canWrite || ! state.canWrite ) {
				state.error = getWriteBlockedMessage( context );
				return;
			}

			state.isSaving = true;
			state.error = undefined;

			try {
				const result = await incrementCounter( {
					delta: 1,
					postId: context.postId,
					publicWriteToken:
						context.persistencePolicy === 'public' && typeof context.publicWriteToken === 'string' && context.publicWriteToken.length > 0
							? context.publicWriteToken
							: undefined,
					resourceKey: context.resourceKey,
				}, context.restNonce );
				if ( ! result.isValid || ! result.data ) {
					state.error = result.errors[ 0 ]?.expected ?? 'Unable to update counter';
					return;
				}
				context.count = result.data.count;
				context.storage = result.data.storage;
				state.count = result.data.count;
			} catch ( error ) {
				state.error =
					error instanceof Error ? error.message : 'Unknown update error';
			} finally {
				state.isSaving = false;
			}
		},
	},

	callbacks: {
		init() {
			const context = getContext< AbTestBlockContext >();
			context.canWrite =
				context.canWrite && ! hasExpiredPublicWriteToken( context );
			state.canWrite = context.canWrite;
			state.isVisible = context.isVisible;
			state.count = context.count;
		},
		mounted() {
			state.isHydrated = true;
			if ( typeof document !== 'undefined' ) {
				document.documentElement.dataset[ 'abTestBlockHydrated' ] = 'true';
			}
			void actions.loadCounter();
		},
	},
} );
