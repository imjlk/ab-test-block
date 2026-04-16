import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { chromium, type Browser, type Locator, type Page } from 'playwright';

type SmokeMode = 'core' | 'editor' | 'full';
type FrontRenderMode = 'css-hide' | 'dom-prune';
type StickyScope = 'experiment' | 'instance';
type VariantKey = 'a' | 'b' | 'c';
type VariantCount = 2 | 3;

const BASE_URL = process.env.AB_TEST_BLOCK_SITE_URL ?? 'http://localhost:8890';
const ADMIN_USER = process.env.AB_TEST_BLOCK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.AB_TEST_BLOCK_ADMIN_PASSWORD ?? 'password';
const WP_ENV_BIN = join( process.cwd(), 'node_modules', '.bin', 'wp-env' );
const SMOKE_MODE = getSmokeMode(
	process.env.AB_TEST_BLOCK_SMOKE_MODE ?? 'full'
);
const RUN_CORE_CHECKS = SMOKE_MODE === 'core' || SMOKE_MODE === 'full';
const RUN_EDITOR_CHECKS = SMOKE_MODE === 'editor' || SMOKE_MODE === 'full';

const createdPostIds: number[] = [];
const browsers: Browser[] = [];

function writeLog( value: string ) {
	process.stdout.write( `${ value }\n` );
}

function writeWarning( value: string ) {
	process.stderr.write( `${ value }\n` );
}

function escapeRegExp( value: string ) {
	return value.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
}

function normalizeWhitespace( value: string | null | undefined ) {
	return String( value ?? '' )
		.replace( /\s+/g, ' ' )
		.trim();
}

function assert( condition: unknown, message: string ): asserts condition {
	if ( ! condition ) {
		throw new Error( message );
	}
}

function getSmokeMode( value: string ): SmokeMode {
	if ( value === 'core' || value === 'editor' || value === 'full' ) {
		return value;
	}

	writeWarning(
		`Unknown AB_TEST_BLOCK_SMOKE_MODE "${ value }"; defaulting to "full".`
	);

	return 'full';
}

function runWp( args: string[] ) {
	return execFileSync( WP_ENV_BIN, [ 'run', 'cli', 'wp', ...args ], {
		cwd: process.cwd(),
		encoding: 'utf8',
		env: process.env,
	} ).trim();
}

function createFixturePost( title: string, content: string ) {
	const output = runWp( [
		'post',
		'create',
		`--post_title=${ title }`,
		`--post_content=${ content }`,
		'--post_status=publish',
		'--porcelain',
	] );
	const postId = Number.parseInt( output.split( /\s+/ ).pop() ?? '', 10 );

	assert(
		Number.isInteger( postId ) && postId > 0,
		`Failed to create fixture post for ${ title }`
	);

	createdPostIds.push( postId );

	return postId;
}

function seedWinnerState(
	postId: number,
	blockInstanceId: string,
	state: Record< string, unknown >
) {
	const payload = Buffer.from(
		JSON.stringify( {
			[ blockInstanceId ]: state,
		} ),
		'utf8'
	).toString( 'base64' );

	runWp( [
		'eval',
		`update_post_meta( ${ postId }, '_ab_test_block_winner_state', json_decode( base64_decode( '${ payload }' ), true ) );`,
	] );
}

function buildParagraph( text: string ) {
	return `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
}

function buildButton( text: string ) {
	return `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="#smoke-button">${ text }</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`;
}

function buildEmptyParagraph() {
	return '<!-- wp:paragraph --><p></p><!-- /wp:paragraph -->';
}

function buildVariantBlock( variantKey: VariantKey, html: string ) {
	return `<!-- wp:abtest-block/variant ${ JSON.stringify( {
		variantKey,
		variantLabel: `Variant ${ variantKey.toUpperCase() }`,
	} ) } --><div class="wp-block-abtest-block-variant" data-abtest-variant="${ variantKey }" data-variant-label="Variant ${ variantKey.toUpperCase() }">${ html }</div><!-- /wp:abtest-block/variant -->`;
}

function buildExperimentBlock( {
	blockInstanceId,
	experimentId,
	experimentLabel,
	emitDataLayer = false,
	frontRenderMode = 'dom-prune',
	manualWinner,
	showRuntimeLabel = false,
	stickyAssignment = true,
	stickyScope = 'instance',
	variantAContent,
	variantABody,
	variantBContent,
	variantBBody,
	variantCContent,
	variantCBody = 'Variant C body',
	variantCount = 2,
	weights,
	winnerMode = 'off',
}: {
	blockInstanceId: string;
	experimentId: string;
	experimentLabel: string;
	emitDataLayer?: boolean;
	frontRenderMode?: FrontRenderMode;
	manualWinner?: VariantKey;
	showRuntimeLabel?: boolean;
	stickyAssignment?: boolean;
	stickyScope?: StickyScope;
	variantAContent?: string;
	variantABody: string;
	variantBContent?: string;
	variantBBody: string;
	variantCContent?: string;
	variantCBody?: string;
	variantCount?: VariantCount;
	weights?: {
		a: number;
		b: number;
		c?: number;
	};
	winnerMode?: 'automatic' | 'manual' | 'off';
} ) {
	const attributes = {
		automaticMetric: 'ctr',
		blockInstanceId,
		emitBrowserEvents: true,
		emitClarityHook: false,
		emitDataLayer,
		emitKexpLayer: false,
		evaluationWindowDays: 14,
		experimentId,
		experimentLabel,
		frontRenderMode,
		lockWinnerAfterSelection: true,
		minimumClicksPerVariant: 1,
		minimumImpressionsPerVariant: 100,
		manualWinner,
		previewQueryKey: `ab_${ experimentId }`,
		showRuntimeLabel,
		stickyAssignment,
		stickyScope,
		trackClicks: true,
		trackImpressions: true,
		variantCount,
		weights:
			weights ??
			( variantCount === 3
				? {
						a: 34,
						b: 33,
						c: 33,
				  }
				: {
						a: 50,
						b: 50,
				  } ),
		winnerMode,
	};

	return `<!-- wp:abtest-block/test ${ JSON.stringify(
		attributes
	) } -->${ buildVariantBlock(
		'a',
		variantAContent ?? buildParagraph( variantABody )
	) }${ buildVariantBlock(
		'b',
		variantBContent ?? buildParagraph( variantBBody )
	) }${
		variantCount === 3
			? buildVariantBlock(
					'c',
					variantCContent ?? buildParagraph( variantCBody )
			  )
			: ''
	}<!-- /wp:abtest-block/test -->`;
}

function buildSingleVariantExperimentBlock( {
	blockInstanceId,
	experimentId,
	experimentLabel,
	previewQueryKey,
	variantABody,
}: {
	blockInstanceId: string;
	experimentId: string;
	experimentLabel: string;
	previewQueryKey: string;
	variantABody: string;
} ) {
	const attributes = {
		automaticMetric: 'ctr',
		blockInstanceId,
		emitBrowserEvents: true,
		emitClarityHook: false,
		emitDataLayer: false,
		emitKexpLayer: false,
		evaluationWindowDays: 14,
		experimentId,
		experimentLabel,
		frontRenderMode: 'dom-prune',
		lockWinnerAfterSelection: true,
		minimumClicksPerVariant: 1,
		minimumImpressionsPerVariant: 100,
		previewQueryKey,
		showRuntimeLabel: false,
		stickyAssignment: true,
		stickyScope: 'instance',
		trackClicks: true,
		trackImpressions: true,
		variantCount: 2,
		weights: {
			a: 50,
			b: 50,
		},
		winnerMode: 'off',
	};

	return `<!-- wp:abtest-block/test ${ JSON.stringify(
		attributes
	) } -->${ buildVariantBlock(
		'a',
		buildParagraph( variantABody )
	) }<!-- /wp:abtest-block/test -->`;
}

function buildEmptyExperimentBlock( {
	blockInstanceId,
	experimentId,
	experimentLabel,
	variantCount = 3,
}: {
	blockInstanceId: string;
	experimentId: string;
	experimentLabel: string;
	variantCount?: VariantCount;
} ) {
	const attributes = {
		automaticMetric: 'ctr',
		blockInstanceId,
		emitBrowserEvents: true,
		emitClarityHook: false,
		emitDataLayer: false,
		emitKexpLayer: false,
		evaluationWindowDays: 14,
		experimentId,
		experimentLabel,
		frontRenderMode: 'dom-prune',
		lockWinnerAfterSelection: true,
		minimumClicksPerVariant: 1,
		minimumImpressionsPerVariant: 100,
		previewQueryKey: `ab_${ experimentId }`,
		showRuntimeLabel: false,
		stickyAssignment: true,
		stickyScope: 'instance',
		trackClicks: true,
		trackImpressions: true,
		variantCount,
		weights:
			variantCount === 3
				? {
						a: 34,
						b: 33,
						c: 33,
				  }
				: {
						a: 50,
						b: 50,
				  },
		winnerMode: 'off',
	};

	return `<!-- wp:abtest-block/test ${ JSON.stringify(
		attributes
	) } -->${ buildVariantBlock(
		'a',
		buildEmptyParagraph()
	) }${ buildVariantBlock( 'b', buildEmptyParagraph() ) }${
		variantCount === 3
			? buildVariantBlock( 'c', buildEmptyParagraph() )
			: ''
	}<!-- /wp:abtest-block/test -->`;
}

async function launchContext( initScript?: () => void ) {
	const browser = await chromium.launch( { headless: true } );
	const context = await browser.newContext();

	browsers.push( browser );

	if ( initScript ) {
		await context.addInitScript( initScript );
	}

	return context;
}

function createFrontInitScript() {
	return () => {
		( window as typeof window & { dataLayer?: unknown[] } ).dataLayer = [];
		window.IntersectionObserver = class InstantIntersectionObserver {
			private readonly callback: IntersectionObserverCallback;

			constructor( callback: IntersectionObserverCallback ) {
				this.callback = callback;
			}

			disconnect() {}

			observe( target: Element ) {
				this.callback(
					[
						{
							boundingClientRect: target.getBoundingClientRect(),
							intersectionRatio: 1,
							intersectionRect: target.getBoundingClientRect(),
							isIntersecting: true,
							rootBounds: null,
							target,
							time: performance.now(),
						},
					] as IntersectionObserverEntry[],
					this as unknown as IntersectionObserver
				);
			}

			takeRecords() {
				return [];
			}

			unobserve() {}
		} as typeof window.IntersectionObserver;
	};
}

function getInstanceCookieName( postId: number, blockInstanceId: string ) {
	return `abtest_${ postId }_${ blockInstanceId }`;
}

function getExperimentCookieName( experimentId: string ) {
	return `abtest_exp_${ experimentId }`;
}

async function waitForFrontStatsEvent( page: Page ) {
	const attempts = 3;

	for ( let attempt = 1; attempt <= attempts; attempt += 1 ) {
		try {
			await page.waitForSelector( '.wp-block-abtest-block-test', {
				timeout: 15000,
			} );
			await page.waitForFunction(
				() =>
					Array.isArray(
						( window as typeof window & { dataLayer?: unknown[] } )
							.dataLayer
					) &&
					(
						(
							window as typeof window & {
								dataLayer?: Array< { event?: string } >;
							}
						 ).dataLayer ?? []
					).some( ( entry ) => entry.event === 'abtest_stats' ),
				undefined,
				{ timeout: 15000 }
			);
			return;
		} catch ( error ) {
			if ( attempt === attempts ) {
				const diagnostics = await page.evaluate( () => {
					const stickyLocalStorage = Array.from(
						{ length: window.localStorage.length },
						( _, index ) => {
							const key = window.localStorage.key( index ) ?? '';

							return {
								key,
								value: window.localStorage.getItem( key ),
							};
						}
					).filter(
						( entry ) =>
							entry.key.startsWith( 'abtest:' ) ||
							entry.key.startsWith( 'abtest-exp:' )
					);
					const stickyCookies = document.cookie
						.split( ';' )
						.map( ( entry ) => entry.trim() )
						.filter(
							( entry ) =>
								entry.startsWith( 'abtest_' ) ||
								entry.startsWith( 'abtest_exp_' )
						);

					return {
						dataLayerEvents: (
							(
								window as typeof window & {
									dataLayer?: Array< { event?: string } >;
								}
							 ).dataLayer ?? []
						).map( ( entry ) => entry.event ?? '(missing-event)' ),
						rootCount: document.querySelectorAll(
							'.wp-block-abtest-block-test'
						).length,
						rootStates: Array.from(
							document.querySelectorAll(
								'.wp-block-abtest-block-test'
							)
						).map( ( element ) => ( {
							frontRenderMode: element.getAttribute(
								'data-abtest-front-render-mode'
							),
							ready: element.getAttribute( 'data-abtest-ready' ),
							runtimeLabel:
								element.querySelector(
									'.wp-block-abtest-block-test__runtime-label'
								)?.textContent ?? null,
						} ) ),
						stickyCookies,
						stickyLocalStorage,
						title: document.title,
					};
				} );
				throw new Error(
					`Front-end smoke did not observe abtest_stats after ${ attempts } attempts. Diagnostics: ${ JSON.stringify(
						diagnostics
					) }. Cause: ${ String( error ) }`
				);
			}

			await page.reload( { waitUntil: 'domcontentloaded' } );
			await page.waitForTimeout( 1500 * attempt );
		}
	}
}

async function loginToWpAdmin( page: Page ) {
	await page.goto( `${ BASE_URL }/wp-login.php`, {
		waitUntil: 'domcontentloaded',
	} );

	await page.locator( '#user_login' ).fill( ADMIN_USER );
	await page.locator( '#user_pass' ).fill( ADMIN_PASSWORD );

	await Promise.all( [
		page
			.waitForNavigation( { waitUntil: 'domcontentloaded' } )
			.catch( () => null ),
		page.locator( '#wp-submit' ).click(),
	] );
}

async function openEditor( page: Page, postId: number ) {
	await page.goto(
		`${ BASE_URL }/wp-admin/post.php?post=${ postId }&action=edit`,
		{
			waitUntil: 'domcontentloaded',
		}
	);
	await page.waitForTimeout( 3000 );
}

async function waitForParentBlock( page: Page, blockInstanceId: string ) {
	await page.waitForFunction(
		( currentBlockInstanceId ) => {
			const wpData = (
				window as typeof window & {
					wp?: {
						data?: {
							select?: ( store: string ) => {
								getBlocks: () => Array< {
									attributes: Record< string, unknown >;
								} >;
							};
						};
					};
				}
			 ).wp?.data;

			if ( ! wpData?.select ) {
				return false;
			}

			return wpData
				.select( 'core/block-editor' )
				.getBlocks()
				.some(
					( block ) =>
						block.attributes.blockInstanceId ===
						currentBlockInstanceId
				);
		},
		blockInstanceId,
		{ timeout: 30000 }
	);
}

async function selectParentBlock( page: Page, blockInstanceId: string ) {
	await waitForParentBlock( page, blockInstanceId );

	await page.evaluate( ( currentBlockInstanceId ) => {
		const wpData = (
			window as typeof window & {
				wp: {
					data: {
						dispatch: ( store: string ) => {
							selectBlock: ( clientId: string ) => void;
						};
						select: ( store: string ) => {
							getBlocks: () => Array< {
								attributes: Record< string, unknown >;
								clientId: string;
							} >;
						};
					};
				};
			}
		 ).wp;
		const editor = wpData.data.select( 'core/block-editor' );
		const dispatcher = wpData.data.dispatch( 'core/block-editor' );
		const parentBlock = editor
			.getBlocks()
			.find(
				( block ) =>
					block.attributes.blockInstanceId === currentBlockInstanceId
			);

		if ( ! parentBlock ) {
			throw new Error( 'Missing parent block to select' );
		}

		dispatcher.selectBlock( parentBlock.clientId );
	}, blockInstanceId );

	await page.waitForTimeout( 800 );

	return page.frameLocator( 'iframe[name="editor-canvas"]' );
}

async function getVisibleVariantCanvasText(
	frame: ReturnType< Page[ 'frameLocator' ] >
) {
	return (
		await frame
			.locator( '.wp-block-abtest-block-variant.is-active' )
			.first()
			.innerText()
	)
		.replace( /\s+/g, ' ' )
		.trim();
}

async function getVariantCanvasTexts(
	page: Page,
	frame: ReturnType< Page[ 'frameLocator' ] >,
	variantKeys: VariantKey[]
) {
	const snapshot = {} as Record< VariantKey, string >;

	for ( const variantKey of variantKeys ) {
		await page
			.locator(
				`[role="toolbar"] button[aria-label="Edit Variant ${ variantKey.toUpperCase() }"]`
			)
			.click();
		await page.waitForTimeout( 400 );
		snapshot[ variantKey ] = await getVisibleVariantCanvasText( frame );
	}

	return snapshot;
}

async function openSidebarPanel( page: Page, title: string ) {
	const sidebar = page.locator( '.interface-interface-skeleton__sidebar' );
	await sidebar.waitFor( { state: 'visible', timeout: 30000 } );
	const blockTab = sidebar.getByRole( 'button', {
		name: new RegExp( `^${ escapeRegExp( 'Block' ) }$`, 'i' ),
	} );

	if ( ( await blockTab.count() ) > 0 ) {
		await blockTab.first().click();
	}

	const exactToggle = sidebar.getByRole( 'button', {
		name: new RegExp( `^${ escapeRegExp( title ) }$`, 'i' ),
	} );
	const fallbackToggle = sidebar.getByRole( 'button', {
		name: new RegExp( escapeRegExp( title ), 'i' ),
	} );
	const hasExactToggle = ( await exactToggle.count() ) > 0;
	const hasFallbackToggle = ( await fallbackToggle.count() ) > 0;

	if ( ! hasExactToggle && ! hasFallbackToggle ) {
		throw new Error( `Missing sidebar panel toggle: ${ title }` );
	}

	const toggle = hasExactToggle
		? exactToggle.first()
		: fallbackToggle.first();

	await toggle.scrollIntoViewIfNeeded();

	if ( ( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
		await toggle.click();
	}

	await page.waitForTimeout( 1000 );

	return sidebar;
}

function getCompareCards( sidebar: Locator ) {
	return sidebar.locator( '.wp-block-abtest-block-test__compare-card' );
}

async function openDiagnosticsPanel( page: Page ) {
	return openSidebarPanel( page, 'Diagnostics' );
}

async function isParentBlockSelected( page: Page, blockInstanceId: string ) {
	return page.evaluate( ( currentBlockInstanceId ) => {
		const wpData = (
			window as typeof window & {
				wp: {
					data: {
						select: ( store: string ) => {
							getBlock: ( clientId: string ) => {
								attributes: Record< string, unknown >;
							} | null;
							getSelectedBlockClientId: () => string | null;
						};
					};
				};
			}
		 ).wp;
		const editor = wpData.data.select( 'core/block-editor' );
		const selectedClientId = editor.getSelectedBlockClientId();

		if ( ! selectedClientId ) {
			return false;
		}

		return (
			editor.getBlock( selectedClientId )?.attributes.blockInstanceId ===
			currentBlockInstanceId
		);
	}, blockInstanceId );
}

async function insertHeadingIntoVariant(
	page: Page,
	blockInstanceId: string,
	variantKey: VariantKey,
	content: string
) {
	await page.evaluate(
		( payload ) => {
			const wpData = (
				window as typeof window & {
					wp: {
						blocks: {
							createBlock: (
								name: string,
								attributes: Record< string, unknown >
							) => unknown;
						};
						data: {
							dispatch: ( store: string ) => {
								insertBlocks: (
									blocks: unknown,
									index?: number,
									rootClientId?: string
								) => void;
							};
							select: ( store: string ) => {
								getBlocks: () => Array< {
									attributes: Record< string, unknown >;
									clientId: string;
									innerBlocks: Array< {
										attributes: Record< string, unknown >;
										clientId: string;
									} >;
								} >;
							};
						};
					};
				}
			 ).wp;

			const editor = wpData.data.select( 'core/block-editor' );
			const dispatcher = wpData.data.dispatch( 'core/block-editor' );
			const parentBlock = editor
				.getBlocks()
				.find(
					( block ) =>
						block.attributes.blockInstanceId ===
						payload.blockInstanceId
				);

			if ( ! parentBlock ) {
				throw new Error( 'Missing A/B test parent block' );
			}

			const variantBlock = parentBlock.innerBlocks.find(
				( block ) => block.attributes.variantKey === payload.variantKey
			);

			if ( ! variantBlock ) {
				throw new Error( 'Missing variant block' );
			}

			dispatcher.insertBlocks(
				wpData.blocks.createBlock( 'core/heading', {
					content: payload.content,
				} ),
				undefined,
				variantBlock.clientId
			);
		},
		{
			blockInstanceId,
			content,
			variantKey,
		}
	);
}

async function insertButtonIntoVariant(
	page: Page,
	blockInstanceId: string,
	variantKey: VariantKey,
	text: string
) {
	await page.evaluate(
		( payload ) => {
			const wpData = (
				window as typeof window & {
					wp: {
						blocks: {
							createBlock: (
								name: string,
								attributes?: Record< string, unknown >,
								innerBlocks?: unknown[]
							) => unknown;
						};
						data: {
							dispatch: ( store: string ) => {
								insertBlocks: (
									blocks: unknown,
									index?: number,
									rootClientId?: string
								) => void;
							};
							select: ( store: string ) => {
								getBlocks: () => Array< {
									attributes: Record< string, unknown >;
									clientId: string;
									innerBlocks: Array< {
										attributes: Record< string, unknown >;
										clientId: string;
									} >;
								} >;
							};
						};
					};
				}
			 ).wp;

			const editor = wpData.data.select( 'core/block-editor' );
			const dispatcher = wpData.data.dispatch( 'core/block-editor' );
			const parentBlock = editor
				.getBlocks()
				.find(
					( block ) =>
						block.attributes.blockInstanceId ===
						payload.blockInstanceId
				);

			if ( ! parentBlock ) {
				throw new Error( 'Missing A/B test parent block' );
			}

			const variantBlock = parentBlock.innerBlocks.find(
				( block ) => block.attributes.variantKey === payload.variantKey
			);

			if ( ! variantBlock ) {
				throw new Error( 'Missing variant block' );
			}

			const buttonBlock = wpData.blocks.createBlock( 'core/buttons', {}, [
				wpData.blocks.createBlock( 'core/button', {
					text: payload.text,
					url: '#smoke-cta',
				} ),
			] );

			dispatcher.insertBlocks(
				buttonBlock,
				undefined,
				variantBlock.clientId
			);
		},
		{
			blockInstanceId,
			text,
			variantKey,
		}
	);
}

async function moveLastBlockToTopInVariant(
	page: Page,
	blockInstanceId: string,
	variantKey: VariantKey
) {
	await page.evaluate(
		( payload ) => {
			const wpData = (
				window as typeof window & {
					wp: {
						data: {
							dispatch: ( store: string ) => {
								moveBlocksToPosition: (
									clientIds: string[],
									fromRootClientId: string,
									toRootClientId: string,
									index: number
								) => void;
							};
							select: ( store: string ) => {
								getBlocks: () => Array< {
									attributes: Record< string, unknown >;
									clientId: string;
									innerBlocks: Array< {
										attributes: Record< string, unknown >;
										clientId: string;
									} >;
								} >;
							};
						};
					};
				}
			 ).wp;

			const editor = wpData.data.select( 'core/block-editor' );
			const dispatcher = wpData.data.dispatch( 'core/block-editor' );
			const parentBlock = editor
				.getBlocks()
				.find(
					( block ) =>
						block.attributes.blockInstanceId ===
						payload.blockInstanceId
				);

			if ( ! parentBlock ) {
				throw new Error( 'Missing A/B test parent block' );
			}

			const variantBlock = parentBlock.innerBlocks.find(
				( block ) => block.attributes.variantKey === payload.variantKey
			);

			if (
				! variantBlock ||
				! Array.isArray( variantBlock.innerBlocks ) ||
				variantBlock.innerBlocks.length < 2
			) {
				throw new Error(
					'Variant does not contain enough blocks to reorder'
				);
			}

			const lastBlock =
				variantBlock.innerBlocks[ variantBlock.innerBlocks.length - 1 ];

			dispatcher.moveBlocksToPosition(
				[ lastBlock.clientId ],
				variantBlock.clientId,
				variantBlock.clientId,
				0
			);
		},
		{
			blockInstanceId,
			variantKey,
		}
	);
}

async function removeHeadingFromVariant(
	page: Page,
	blockInstanceId: string,
	variantKey: VariantKey
) {
	await page.evaluate(
		( payload ) => {
			const wpData = (
				window as typeof window & {
					wp: {
						data: {
							dispatch: ( store: string ) => {
								removeBlocks: ( clientIds: string[] ) => void;
							};
							select: ( store: string ) => {
								getBlocks: () => Array< {
									attributes: Record< string, unknown >;
									clientId: string;
									name: string;
									innerBlocks: Array< {
										attributes: Record< string, unknown >;
										clientId: string;
										name: string;
										innerBlocks?: Array< {
											attributes: Record<
												string,
												unknown
											>;
											clientId: string;
											name: string;
										} >;
									} >;
								} >;
							};
						};
					};
				}
			 ).wp;

			const editor = wpData.data.select( 'core/block-editor' );
			const dispatcher = wpData.data.dispatch( 'core/block-editor' );
			const parentBlock = editor
				.getBlocks()
				.find(
					( block ) =>
						block.attributes.blockInstanceId ===
						payload.blockInstanceId
				);

			if ( ! parentBlock ) {
				throw new Error( 'Missing A/B test parent block' );
			}

			const variantBlock = parentBlock.innerBlocks.find(
				( block ) => block.attributes.variantKey === payload.variantKey
			);

			if (
				! variantBlock ||
				! Array.isArray( variantBlock.innerBlocks )
			) {
				throw new Error( 'Missing variant block' );
			}

			const headingBlock = [ ...variantBlock.innerBlocks ]
				.reverse()
				.find( ( block ) => block.name === 'core/heading' );

			if ( ! headingBlock ) {
				throw new Error( 'Missing inserted heading block' );
			}

			dispatcher.removeBlocks( [ headingBlock.clientId ] );
		},
		{
			blockInstanceId,
			variantKey,
		}
	);
}

async function selectInnerBlockByName(
	page: Page,
	blockInstanceId: string,
	variantKey: VariantKey,
	blockName: string
) {
	await page.evaluate(
		( payload ) => {
			const wpData = (
				window as typeof window & {
					wp: {
						data: {
							dispatch: ( store: string ) => {
								selectBlock: ( clientId: string ) => void;
							};
							select: ( store: string ) => {
								getBlocks: () => Array< {
									attributes: Record< string, unknown >;
									clientId: string;
									innerBlocks: Array< {
										attributes: Record< string, unknown >;
										clientId: string;
										innerBlocks?: Array< unknown >;
										name: string;
									} >;
								} >;
							};
						};
					};
				}
			 ).wp;
			const editor = wpData.data.select( 'core/block-editor' );
			const dispatcher = wpData.data.dispatch( 'core/block-editor' );
			const parentBlock = editor
				.getBlocks()
				.find(
					( block ) =>
						block.attributes.blockInstanceId ===
						payload.blockInstanceId
				);

			if ( ! parentBlock ) {
				throw new Error( 'Missing A/B test parent block' );
			}

			const variantBlock = parentBlock.innerBlocks.find(
				( block ) => block.attributes.variantKey === payload.variantKey
			);

			if ( ! variantBlock ) {
				throw new Error( 'Missing variant block' );
			}

			const queue = [ ...variantBlock.innerBlocks ] as Array< {
				clientId: string;
				innerBlocks?: Array< unknown >;
				name: string;
			} >;
			let targetClientId: string | undefined;

			while ( queue.length > 0 ) {
				const block = queue.shift();

				if ( ! block ) {
					continue;
				}

				if ( block.name === payload.blockName ) {
					targetClientId = block.clientId;
					break;
				}

				if ( Array.isArray( block.innerBlocks ) ) {
					queue.push(
						...( block.innerBlocks as Array< {
							clientId: string;
							innerBlocks?: Array< unknown >;
							name: string;
						} > )
					);
				}
			}

			if ( ! targetClientId ) {
				throw new Error( `Missing ${ payload.blockName } block` );
			}

			dispatcher.selectBlock( targetClientId );
		},
		{
			blockInstanceId,
			blockName,
			variantKey,
		}
	);
}

async function getSelectedExperimentAttributeSnapshot( page: Page ) {
	return page.evaluate( () => {
		const wpData = (
			window as typeof window & {
				wp: {
					data: {
						select: ( store: string ) => {
							getBlock: ( clientId: string | null ) => {
								attributes: Record< string, unknown >;
							} | null;
							getSelectedBlockClientId: () => string | null;
						};
					};
				};
			}
		 ).wp;
		const editor = wpData.data.select( 'core/block-editor' );
		const selectedClientId = editor.getSelectedBlockClientId();
		const selectedBlock = editor.getBlock( selectedClientId );

		if ( ! selectedBlock ) {
			throw new Error( 'Missing selected block' );
		}

		return selectedBlock.attributes;
	} );
}

async function getSelectedBlockClassName( page: Page ) {
	return page.evaluate( () => {
		const wpData = (
			window as typeof window & {
				wp: {
					data: {
						select: ( store: string ) => {
							getBlock: ( clientId: string | null ) => {
								attributes: Record< string, unknown >;
							} | null;
							getSelectedBlockClientId: () => string | null;
						};
					};
				};
			}
		 ).wp;
		const editor = wpData.data.select( 'core/block-editor' );
		const selectedClientId = editor.getSelectedBlockClientId();
		const selectedBlock = editor.getBlock( selectedClientId );

		return typeof selectedBlock?.attributes.className === 'string'
			? selectedBlock.attributes.className
			: '';
	} );
}

async function getVariantInnerBlockNames(
	page: Page,
	blockInstanceId: string,
	variantKey: VariantKey
) {
	return page.evaluate(
		( payload ) => {
			const wpData = (
				window as typeof window & {
					wp: {
						data: {
							select: ( store: string ) => {
								getBlocks: () => Array< {
									attributes: Record< string, unknown >;
									innerBlocks: Array< {
										attributes: Record< string, unknown >;
										innerBlocks?: Array< unknown >;
										name: string;
									} >;
								} >;
							};
						};
					};
				}
			 ).wp;
			const editor = wpData.data.select( 'core/block-editor' );
			const parentBlock = editor
				.getBlocks()
				.find(
					( block ) =>
						block.attributes.blockInstanceId ===
						payload.blockInstanceId
				);

			if ( ! parentBlock ) {
				throw new Error( 'Missing A/B test parent block' );
			}

			const variantBlock = parentBlock.innerBlocks.find(
				( block ) => block.attributes.variantKey === payload.variantKey
			);

			if (
				! variantBlock ||
				! Array.isArray( variantBlock.innerBlocks )
			) {
				throw new Error( 'Missing variant block' );
			}

			return variantBlock.innerBlocks.map( ( block ) => block.name );
		},
		{
			blockInstanceId,
			variantKey,
		}
	);
}

async function getVisibleVariantTexts( page: Page ) {
	return page
		.locator( '.wp-block-abtest-block-variant' )
		.evaluateAll( ( elements ) =>
			elements
				.filter( ( element ) => {
					const styles = window.getComputedStyle( element );
					return (
						styles.display !== 'none' &&
						styles.visibility !== 'hidden' &&
						( element as HTMLElement ).offsetParent !== null
					);
				} )
				.map( ( element ) => element.textContent?.trim() ?? '' )
		);
}

async function runCoreSmoke( statsPostId: number ) {
	const malformedDomPrunePostId = createFixturePost(
		'E2E DOM Prune Fallback Fixture',
		buildSingleVariantExperimentBlock( {
			blockInstanceId: 'e2eprunefallback1',
			experimentId: 'e2e_dom_prune_fallback_fixture',
			experimentLabel: 'DOM Prune Fallback Fixture',
			previewQueryKey: 'ab_e2e_dom_prune_fallback_fixture',
			variantABody: 'DOM Prune Fallback Variant A body',
		} )
	);
	const cssHidePostId = createFixturePost(
		'E2E CSS Hide Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2ecsshide1',
			experimentId: 'e2e_css_hide_fixture',
			experimentLabel: 'CSS Hide Fixture',
			frontRenderMode: 'css-hide',
			showRuntimeLabel: true,
			stickyAssignment: true,
			stickyScope: 'instance',
			variantABody: 'CSS Hide Variant A body',
			variantBBody: 'CSS Hide Variant B body',
		} )
	);
	const migrationPostId = createFixturePost(
		'E2E Legacy Sticky Migration',
		buildExperimentBlock( {
			blockInstanceId: 'e2emigration1',
			experimentId: 'e2e_legacy_migration_fixture',
			experimentLabel: 'Legacy Migration Fixture',
			stickyAssignment: true,
			stickyScope: 'instance',
			variantABody: 'Legacy Migration Variant A body',
			variantBBody: 'Legacy Migration Variant B body',
		} )
	);
	const nonStickyPostId = createFixturePost(
		'E2E Non Sticky Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2enonsticky1',
			experimentId: 'e2e_non_sticky_fixture',
			experimentLabel: 'Non Sticky Fixture',
			stickyAssignment: false,
			stickyScope: 'instance',
			variantABody: 'Non-sticky Variant A body',
			variantBBody: 'Non-sticky Variant B body',
		} )
	);
	const sharedScopePostOneId = createFixturePost(
		'E2E Shared Scope One',
		buildExperimentBlock( {
			blockInstanceId: 'e2esharedone1',
			experimentId: 'e2e_shared_scope_fixture',
			experimentLabel: 'Shared Scope Fixture',
			stickyAssignment: true,
			stickyScope: 'experiment',
			variantABody: 'Shared Scope One Variant A body',
			variantBBody: 'Shared Scope One Variant B body',
		} )
	);
	const sharedScopePostTwoId = createFixturePost(
		'E2E Shared Scope Two',
		buildExperimentBlock( {
			blockInstanceId: 'e2esharedtwo1',
			experimentId: 'e2e_shared_scope_fixture',
			experimentLabel: 'Shared Scope Fixture',
			stickyAssignment: true,
			stickyScope: 'experiment',
			variantABody: 'Shared Scope Two Variant A body',
			variantBBody: 'Shared Scope Two Variant B body',
		} )
	);

	const frontContext = await launchContext( createFrontInitScript() );
	const frontPage = await frontContext.newPage();

	await frontPage.goto( `${ BASE_URL }/?p=${ statsPostId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await waitForFrontStatsEvent( frontPage );
	const frontMarkup = await frontPage.content();
	assert(
		( await frontPage.locator( '[data-abtest-variant]' ).count() ) === 1,
		'Expected dom-prune mode to keep only one variant in the front-end DOM'
	);
	assert(
		( frontMarkup.match( /data-abtest-variant=/g ) ?? [] ).length === 1,
		'Expected dom-prune mode to emit exactly one variant marker in the front-end HTML'
	);

	const visibleVariantTexts = await getVisibleVariantTexts( frontPage );
	assert(
		visibleVariantTexts.length === 1,
		'Expected exactly one active variant to be visible on the front end'
	);

	const malformedDomPruneContext = await launchContext();
	const malformedDomPrunePage = await malformedDomPruneContext.newPage();

	await malformedDomPrunePage.goto(
		`${ BASE_URL }/?p=${ malformedDomPrunePostId }&ab_e2e_dom_prune_fallback_fixture=b`,
		{
			waitUntil: 'domcontentloaded',
		}
	);
	await malformedDomPrunePage.waitForTimeout( 2500 );

	const malformedMarkup = await malformedDomPrunePage.content();
	const malformedVisibleTexts = await getVisibleVariantTexts(
		malformedDomPrunePage
	);
	const malformedFallbackMessage =
		'Requested Variant B could not be rendered. Showing Variant A instead.';
	const malformedRuntimeError =
		( await malformedDomPrunePage
			.locator( '.wp-block-abtest-block-test__runtime-error' )
			.first()
			.textContent() ) ?? '';

	assert(
		( malformedMarkup.match( /data-abtest-variant=/g ) ?? [] ).length === 1,
		'Expected dom-prune fallback to keep exactly one variant marker in the front-end HTML when the requested variant is missing'
	);
	assert(
		malformedVisibleTexts.length === 1 &&
			malformedVisibleTexts[ 0 ]?.includes(
				'DOM Prune Fallback Variant A body'
			),
		'Expected dom-prune fallback to render the first valid variant when the requested variant is missing'
	);
	assert(
		malformedRuntimeError.includes( malformedFallbackMessage ) ||
			malformedMarkup.includes( malformedFallbackMessage ),
		'Expected dom-prune fallback to expose a runtime error when it has to fall back to a different variant'
	);

	const dataLayer = ( await frontPage.evaluate(
		() =>
			( window as typeof window & { dataLayer?: unknown[] } ).dataLayer ??
			[]
	) ) as Array< Record< string, unknown > >;
	const impressionEvent = dataLayer.find(
		( entry ) => entry.event === 'abtest_impression'
	);
	const statsEvent = dataLayer.find(
		( entry ) => entry.event === 'abtest_stats'
	) as
		| {
				event: string;
				stats: {
					experiment: {
						blockInstanceCount: number;
						postCount: number;
						variants: Array< { impressions: number } >;
					};
					instance: {
						blockInstanceId: string;
						postId: number;
						variants: Array< { impressions: number } >;
					};
				};
		  }
		| undefined;

	assert(
		impressionEvent,
		'Expected abtest_impression to be pushed to window.dataLayer'
	);
	assert(
		! Object.prototype.hasOwnProperty.call( impressionEvent, 'stats' ),
		'Expected abtest_impression payload to stay lightweight'
	);
	assert(
		statsEvent,
		'Expected abtest_stats to be pushed to window.dataLayer'
	);
	assert(
		statsEvent.stats.instance.blockInstanceId === 'e2einstats1',
		'Expected abtest_stats.instance to describe the current block instance'
	);
	assert(
		statsEvent.stats.instance.postId === statsPostId,
		'Expected abtest_stats.instance.postId to match the front-end fixture post'
	);
	assert(
		typeof statsEvent.stats.experiment.postCount === 'number' &&
			typeof statsEvent.stats.experiment.blockInstanceCount === 'number',
		'Expected abtest_stats.experiment to include numeric aggregate metadata'
	);
	assert(
		statsEvent.stats.instance.variants.reduce(
			( total, variant ) => total + variant.impressions,
			0
		) === 1,
		'Expected one counted impression in instance stats after the front-end visit'
	);

	const instanceStickyValue = await frontPage.evaluate(
		( key ) =>
			document.cookie
				.split( ';' )
				.map( ( entry ) => entry.trim() )
				.find( ( entry ) => entry.startsWith( `${ key }=` ) )
				?.split( '=' )[ 1 ] ?? null,
		getInstanceCookieName( statsPostId, 'e2einstats1' )
	);
	assert(
		instanceStickyValue === 'a' || instanceStickyValue === 'b',
		'Expected instance sticky assignment to be stored in a first-party cookie'
	);

	const nonStickyContext = await launchContext();
	const nonStickyPage = await nonStickyContext.newPage();

	await nonStickyPage.goto( `${ BASE_URL }/?p=${ nonStickyPostId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await nonStickyPage.waitForTimeout( 2500 );
	const nonStickyValue = await nonStickyPage.evaluate(
		( key ) =>
			document.cookie
				.split( ';' )
				.map( ( entry ) => entry.trim() )
				.find( ( entry ) => entry.startsWith( `${ key }=` ) ) ?? null,
		getInstanceCookieName( nonStickyPostId, 'e2enonsticky1' )
	);
	assert(
		nonStickyValue === null,
		'Expected stickyAssignment=false to avoid storing a sticky cookie'
	);

	const sharedContext = await launchContext();
	const sharedPage = await sharedContext.newPage();

	await sharedPage.goto( `${ BASE_URL }/?p=${ sharedScopePostOneId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await sharedPage.waitForTimeout( 1000 );
	const sharedKey = getExperimentCookieName( 'e2e_shared_scope_fixture' );
	await sharedPage.evaluate( ( key ) => {
		document.cookie = `${ key }=b; path=/; max-age=2592000; samesite=lax`;
	}, sharedKey );
	await sharedPage.goto( `${ BASE_URL }/?p=${ sharedScopePostTwoId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await sharedPage.waitForTimeout( 2500 );
	const sharedVisibleTexts = await getVisibleVariantTexts( sharedPage );
	assert(
		sharedVisibleTexts.length === 1 &&
			sharedVisibleTexts[ 0 ].includes(
				'Shared Scope Two Variant B body'
			),
		'Expected experiment-scope sticky assignment to carry across posts with the same experimentId'
	);

	const cssHideContext = await launchContext();
	const cssHidePage = await cssHideContext.newPage();

	await cssHidePage.goto( `${ BASE_URL }/?p=${ cssHidePostId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await cssHidePage.waitForTimeout( 2500 );
	const cssHideMarkup = await cssHidePage.content();
	assert(
		( await cssHidePage.locator( '[data-abtest-variant]' ).count() ) === 2,
		'Expected css-hide mode to keep both variants in the front-end DOM'
	);
	assert(
		( cssHideMarkup.match( /data-abtest-variant=/g ) ?? [] ).length === 2,
		'Expected css-hide mode to keep both variant markers in the front-end HTML'
	);
	assert(
		( await getVisibleVariantTexts( cssHidePage ) ).length === 1,
		'Expected css-hide mode to keep exactly one visible active variant after hydration'
	);
	await cssHidePage.waitForFunction(
		() =>
			(
				document.querySelector(
					'.wp-block-abtest-block-test__runtime-label'
				) as HTMLElement | null
			 )?.textContent?.includes( 'e2e_css_hide_fixture:' ) ?? false,
		undefined,
		{ timeout: 15000 }
	);
	const cssHideRuntimeLabel =
		( await cssHidePage
			.locator( '.wp-block-abtest-block-test__runtime-label' )
			.first()
			.textContent() ) ?? '';
	assert(
		cssHideRuntimeLabel.includes( 'e2e_css_hide_fixture:' ),
		'Expected showRuntimeLabel=true to expose the assignment label on the front end'
	);

	const migrationContext = await launchContext();
	const migrationPage = await migrationContext.newPage();
	const migrationUrl = `${ BASE_URL }/?p=${ migrationPostId }`;

	await migrationPage.goto( BASE_URL, {
		waitUntil: 'domcontentloaded',
	} );
	await migrationPage.evaluate( ( key ) => {
		window.localStorage.setItem( key, 'b' );
	}, `abtest:${ migrationPostId }:e2emigration1` );

	await migrationPage.goto( migrationUrl, {
		waitUntil: 'domcontentloaded',
	} );
	let migrationVisibleTexts: string[] = [];
	let migrationCookieValue: string | null = null;
	const migrationCookieKey = getInstanceCookieName(
		migrationPostId,
		'e2emigration1'
	);

	for ( let attempt = 1; attempt <= 4; attempt += 1 ) {
		await migrationPage.waitForTimeout( attempt === 1 ? 2200 : 1400 );
		migrationCookieValue = await migrationPage.evaluate(
			( key ) =>
				document.cookie
					.split( ';' )
					.map( ( entry ) => entry.trim() )
					.find( ( entry ) => entry.startsWith( `${ key }=` ) )
					?.split( '=' )[ 1 ] ?? null,
			migrationCookieKey
		);

		if ( migrationCookieValue === 'b' ) {
			break;
		}

		if ( attempt === 4 ) {
			const migrationDebug = await migrationPage.evaluate(
				( storageKey ) => ( {
					cookie: document.cookie,
					htmlVariantMarkerCount: (
						document.documentElement.innerHTML.match(
							/data-abtest-variant=/g
						) ?? []
					).length,
					legacyStorageValue:
						window.localStorage.getItem( storageKey ) ?? null,
					runtimeError:
						document
							.querySelector(
								'.wp-block-abtest-block-test__runtime-error'
							)
							?.textContent?.trim() ?? '',
				} ),
				`abtest:${ migrationPostId }:e2emigration1`
			);

			throw new Error(
				`Expected legacy localStorage sticky assignment to migrate into a first-party cookie. ${ JSON.stringify(
					migrationDebug
				) }`
			);
		}

		await migrationPage.goto( migrationUrl, {
			waitUntil: 'domcontentloaded',
		} );
	}

	await migrationPage.goto( migrationUrl, {
		waitUntil: 'domcontentloaded',
	} );
	await migrationPage.waitForFunction(
		( expectedText ) => {
			const visibleTexts = Array.from(
				document.querySelectorAll< HTMLElement >(
					'.wp-block-abtest-block-variant'
				)
			)
				.filter( ( element ) => {
					const styles = window.getComputedStyle( element );
					return (
						styles.display !== 'none' &&
						styles.visibility !== 'hidden' &&
						element.offsetParent !== null
					);
				} )
				.map( ( element ) => element.textContent?.trim() ?? '' );

			return (
				visibleTexts.length === 1 &&
				visibleTexts[ 0 ]?.includes( expectedText ) &&
				(
					document.documentElement.innerHTML.match(
						/data-abtest-variant=/g
					) ?? []
				).length === 1
			);
		},
		'Legacy Migration Variant B body',
		{
			timeout: 12000,
		}
	);

	migrationVisibleTexts = await getVisibleVariantTexts( migrationPage );
	migrationCookieValue = await migrationPage.evaluate(
		( key ) =>
			document.cookie
				.split( ';' )
				.map( ( entry ) => entry.trim() )
				.find( ( entry ) => entry.startsWith( `${ key }=` ) )
				?.split( '=' )[ 1 ] ?? null,
		migrationCookieKey
	);
	assert(
		migrationCookieValue === 'b',
		'Expected legacy localStorage sticky assignment to migrate into a first-party cookie'
	);
	assert(
		migrationVisibleTexts.length === 1 &&
			migrationVisibleTexts[ 0 ].includes(
				'Legacy Migration Variant B body'
			),
		'Expected legacy localStorage migration to preserve the prior sticky variant in dom-prune mode'
	);
	assert(
		(
			( await migrationPage.content() ).match(
				/data-abtest-variant=/g
			) ?? []
		).length === 1,
		'Expected dom-prune legacy migration flow to keep exactly one variant marker in the front-end HTML'
	);
}

async function runEditorSmoke(
	statsPostId: number,
	templatePostId: number,
	malformedPostId: number,
	lifecyclePostId: number,
	authoringPostId: number,
	structureSyncPostId: number,
	structureSyncThreeVariantPostId: number,
	reasonPostId: number,
	candidatePostId: number
) {
	const frontContext = await launchContext( createFrontInitScript() );
	const frontPage = await frontContext.newPage();

	await frontPage.goto( `${ BASE_URL }/?p=${ statsPostId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await waitForFrontStatsEvent( frontPage );

	const adminContext = await launchContext();
	const adminPage = await adminContext.newPage();

	await loginToWpAdmin( adminPage );
	await openEditor( adminPage, statsPostId );

	const frame = await selectParentBlock( adminPage, 'e2einstats1' );
	assert(
		( await frame
			.locator( '.wp-block-abtest-block-test__tabs' )
			.count() ) === 0,
		'Expected canvas variant tabs to be removed from the editor shell'
	);
	assert(
		await isParentBlockSelected( adminPage, 'e2einstats1' ),
		'Expected the A/B test parent block to stay selected after selection sync'
	);
	await adminPage
		.locator( '[role="toolbar"] button[aria-label="Edit Variant B"]' )
		.click();
	await adminPage.waitForTimeout( 500 );
	assert(
		await isParentBlockSelected( adminPage, 'e2einstats1' ),
		'Expected toolbar variant switching to keep parent block selection'
	);
	assert(
		(
			await frame
				.locator( '.wp-block-abtest-block-variant.is-active' )
				.first()
				.innerText()
		).includes( 'Stats Variant B body' ),
		'Expected toolbar variant switching to show Variant B content in the editor canvas'
	);
	await adminPage
		.locator( '[role="toolbar"] button[aria-label="Preview winner mode"]' )
		.click();
	await adminPage.waitForTimeout( 400 );
	assert(
		await isParentBlockSelected( adminPage, 'e2einstats1' ),
		'Expected Winner preview toolbar action to keep parent block selection'
	);
	await adminPage
		.locator( '[role="toolbar"] button[aria-label="Preview traffic mode"]' )
		.click();
	await adminPage.waitForTimeout( 400 );
	assert(
		await isParentBlockSelected( adminPage, 'e2einstats1' ),
		'Expected Traffic mode toolbar action to keep parent block selection'
	);

	const insertedHeading = 'Playwright smoke heading';
	await insertHeadingIntoVariant(
		adminPage,
		'e2einstats1',
		'b',
		insertedHeading
	);
	await frame.getByText( insertedHeading ).waitFor( { state: 'visible' } );
	await removeHeadingFromVariant( adminPage, 'e2einstats1', 'b' );
	await adminPage.waitForTimeout( 500 );
	assert(
		( await frame.getByText( insertedHeading ).count() ) === 0,
		'Expected inserted heading block to be removable inside the variant container'
	);
	await frame.getByText( 'Outside block' ).click();
	await adminPage.waitForTimeout( 500 );
	assert(
		( await frame
			.locator( '.wp-block-abtest-block-variant.is-active' )
			.count() ) === 1,
		'Expected the visible variant to remain rendered after selecting an outside block'
	);
	await selectParentBlock( adminPage, 'e2einstats1' );
	await adminPage.waitForTimeout( 500 );

	await adminPage
		.getByRole( 'button', { name: 'Open quick summary and actions' } )
		.click();
	const quickSummary = adminPage.locator(
		'.wp-block-abtest-block-test__toolbar-dropdown-content'
	);
	await quickSummary.getByText( 'Quick summary' ).waitFor( {
		state: 'visible',
	} );
	assert(
		( await quickSummary.getByText( 'Sticky behavior' ).count() ) === 1 &&
			( await quickSummary.getByText( 'Front-end output' ).count() ) ===
				1,
		'Expected Quick summary to show the reduced summary fields'
	);
	await quickSummary
		.getByRole( 'button', { name: 'Open diagnostics' } )
		.click();
	await adminPage.waitForTimeout( 400 );

	const sidebar = await openDiagnosticsPanel( adminPage );
	await sidebar.getByRole( 'button', { name: 'Refresh stats' } ).click();
	await adminPage.waitForTimeout( 1200 );

	const debugText = await sidebar.innerText();
	const normalizedDebugText = debugText.replace( /\s+/g, ' ' );
	const hasAssignmentSourceSummary = [
		'traffic split',
		'Sticky assignment for this block',
		'Sticky assignment for this experiment',
		'Manual winner preview',
		'Locked automatic winner',
		'Automatic winner candidate',
		'No winner yet:',
	].some( ( value ) => normalizedDebugText.includes( value ) );
	assert(
		normalizedDebugText.includes( 'This block' ) &&
			normalizedDebugText.includes( 'This experiment' ),
		'Expected Diagnostics to show both block and experiment stats cards'
	);
	assert(
		normalizedDebugText.includes( '1 impressions' ),
		'Expected Diagnostics to reflect the counted front-end impression'
	);
	assert(
		( normalizedDebugText.includes( 'Current state' ) ||
			normalizedDebugText.includes( 'Preview mode' ) ) &&
			hasAssignmentSourceSummary,
		'Expected Diagnostics to show the current assignment source text'
	);

	const advancedSidebar = await openSidebarPanel(
		adminPage,
		'Experiment Identity'
	);
	const advancedSidebarText = await advancedSidebar.innerText();
	const experimentIdInput = advancedSidebar.getByLabel( 'Experiment ID' );
	assert(
		await experimentIdInput.isDisabled(),
		'Expected Experiment ID to stay locked by default'
	);

	if ( advancedSidebarText.includes( 'Copy ID' ) ) {
		await advancedSidebar
			.getByRole( 'button', { name: 'Copy ID' } )
			.click();
		await adminPage.waitForTimeout( 300 );

		const advancedTextAfterCopy = await advancedSidebar.innerText();

		if ( advancedTextAfterCopy.includes( 'Copied' ) ) {
			assert(
				await experimentIdInput.isDisabled(),
				'Expected Copy ID to leave the Experiment ID field locked'
			);
		} else if (
			advancedTextAfterCopy.includes( 'Could not copy the Experiment ID' )
		) {
			assert(
				await experimentIdInput.isDisabled(),
				'Expected failed Copy ID feedback to leave the Experiment ID field locked'
			);
		} else {
			writeWarning(
				'Skipping Copy ID feedback assertion because this editor session did not expose a stable clipboard success or failure message.'
			);
		}
	}

	if ( advancedSidebarText.includes( 'Edit Experiment ID' ) ) {
		await adminPage.evaluate( () => {
			const sidebarElement = document.querySelector(
				'.interface-interface-skeleton__sidebar'
			);
			const button = Array.from(
				sidebarElement?.querySelectorAll( 'button' ) ?? []
			).find(
				( element ) =>
					element.textContent?.includes( 'Edit Experiment ID' )
			) as HTMLButtonElement | undefined;

			if ( ! button ) {
				throw new Error( 'Missing Edit Experiment ID button' );
			}

			button.click();
		} );
		await adminPage.waitForTimeout( 300 );
		assert(
			( await advancedSidebar
				.getByText( 'Changing the Experiment ID after stats exist' )
				.count() ) === 1,
			'Expected Experiment ID warning to appear while editing the advanced field'
		);
		await adminPage.evaluate( () => {
			const sidebarElement = document.querySelector(
				'.interface-interface-skeleton__sidebar'
			);
			const button = Array.from(
				sidebarElement?.querySelectorAll( 'button' ) ?? []
			).find(
				( element ) =>
					element.textContent?.includes( 'Done editing ID' )
			) as HTMLButtonElement | undefined;

			if ( ! button ) {
				throw new Error( 'Missing Done editing ID button' );
			}

			button.click();
		} );
		await adminPage.waitForTimeout( 300 );
		assert(
			( await advancedSidebar
				.getByText( 'Changing the Experiment ID after stats exist' )
				.count() ) === 0,
			'Expected Experiment ID to relock after leaving edit mode'
		);
	} else {
		writeWarning(
			'Skipping Experiment ID editor smoke check because the Experiment Identity panel control text was not discoverable in this editor session.'
		);
	}

	const renderingSidebar = await openSidebarPanel(
		adminPage,
		'Labels & Hints'
	);
	await renderingSidebar.getByLabel( 'Show assignment label' ).click();
	await adminPage.waitForTimeout( 300 );
	await frame
		.locator( '.wp-block-abtest-block-test__runtime-label' )
		.first()
		.waitFor( {
			state: 'visible',
			timeout: 5000,
		} );
	assert(
		(
			( await frame
				.locator( '.wp-block-abtest-block-test__runtime-label' )
				.first()
				.textContent() ) ?? ''
		).includes( 'e2e_stats_fixture:' ),
		'Expected the editor canvas to mirror the front-end assignment label when enabled'
	);
	const runtimeToolbarButton = adminPage.getByRole( 'button', {
		name: /assignment label/i,
	} );
	assert(
		( await runtimeToolbarButton.getAttribute( 'aria-pressed' ) ) ===
			'true',
		'Expected the assignment label toolbar toggle to stay in sync with the inspector control'
	);
	await runtimeToolbarButton.click();
	await adminPage.waitForTimeout( 300 );
	assert(
		( await frame
			.locator( '.wp-block-abtest-block-test__runtime-label' )
			.count() ) === 0,
		'Expected the toolbar assignment label toggle to hide the mirrored editor label'
	);

	await selectParentBlock( adminPage, 'e2einstats1' );
	const statsCompareSidebar = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	const statsCompareSidebarText = normalizeWhitespace(
		await statsCompareSidebar.innerText()
	);
	const statsCompareCards = getCompareCards( statsCompareSidebar );
	assert(
		statsCompareSidebarText.includes(
			'All compared variants match the active baseline.'
		),
		'Expected Compare variants to show a compact match state when the target variant matches the active baseline'
	);
	assert(
		normalizeWhitespace(
			await statsCompareCards.nth( 1 ).innerText()
		).includes( 'Matches active baseline' ),
		'Expected Compare variants to collapse matching variants into a one-line match state'
	);

	await selectParentBlock( adminPage, 'e2einstats1' );
	await insertButtonIntoVariant(
		adminPage,
		'e2einstats1',
		'a',
		'Inserted CTA button'
	);
	await adminPage.waitForTimeout( 500 );
	await selectInnerBlockByName(
		adminPage,
		'e2einstats1',
		'a',
		'core/button'
	);
	await adminPage.waitForTimeout( 500 );
	const primaryCtaToolbarButton = adminPage
		.locator( '[role="toolbar"] button' )
		.filter( {
			hasText: 'Primary CTA',
		} )
		.first();
	assert(
		( await primaryCtaToolbarButton.count() ) === 1,
		'Expected a Primary CTA toolbar button while a CTA-capable inner block is selected'
	);
	await primaryCtaToolbarButton.click();
	await adminPage.waitForTimeout( 400 );
	assert(
		( await getSelectedBlockClassName( adminPage ) ).includes(
			'abtest-cta'
		),
		'Expected the selected CTA block to receive the abtest-cta class from the toolbar action'
	);
	assert(
		( await primaryCtaToolbarButton.getAttribute( 'aria-pressed' ) ) ===
			'true',
		'Expected the toolbar Primary CTA toggle to reflect the selected CTA state'
	);
	await selectParentBlock( adminPage, 'e2einstats1' );
	await adminPage.waitForTimeout( 400 );
	const trackingSidebar = await openSidebarPanel( adminPage, 'Tracking' );
	assert(
		( await trackingSidebar
			.getByRole( 'button', { name: 'Remove primary CTA' } )
			.count() ) === 1,
		'Expected Tracking to remember the last selected CTA-capable block while the parent block is selected'
	);
	await trackingSidebar
		.getByRole( 'button', { name: 'Remove primary CTA' } )
		.click();
	await adminPage.waitForTimeout( 400 );
	await selectInnerBlockByName(
		adminPage,
		'e2einstats1',
		'a',
		'core/button'
	);
	await adminPage.waitForTimeout( 400 );
	assert(
		! ( await getSelectedBlockClassName( adminPage ) ).includes(
			'abtest-cta'
		),
		'Expected the Tracking panel CTA action to remove the explicit CTA class from the remembered CTA block'
	);
	await adminPage.waitForFunction(
		() =>
			document.body.textContent?.includes( 'Fallback tracking is active' )
	);
	await selectParentBlock( adminPage, 'e2einstats1' );
	const trackingSidebarFallback = await openSidebarPanel(
		adminPage,
		'Tracking'
	);
	assert(
		( await trackingSidebarFallback.innerText() ).includes(
			'No explicit CTA in Variant A. Fallback tracking is active for Inserted CTA button.'
		),
		'Expected Tracking to explain when the active variant is currently using fallback CTA detection'
	);
	assert(
		(
			( await frame
				.locator( '.wp-block-abtest-block-test__cta-badge' )
				.textContent() ) ?? ''
		).trim() === 'Variant A CTA: Fallback tracking is active',
		'Expected the editor canvas to show a compact fallback CTA badge for the active variant'
	);
	await selectParentBlock( adminPage, 'e2einstats1' );
	const fallbackCompareSidebar = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	const fallbackCompareVariantBText = normalizeWhitespace(
		await getCompareCards( fallbackCompareSidebar ).nth( 1 ).innerText()
	);
	assert(
		fallbackCompareVariantBText.includes( 'CTA differs' ) &&
			fallbackCompareVariantBText.includes( 'CTA' ) &&
			fallbackCompareVariantBText.includes( 'No CTA detected yet' ) &&
			fallbackCompareVariantBText.includes(
				'Baseline: Fallback CTA: Inserted CTA button'
			),
		'Expected Compare variants to show the fallback CTA state only when it differs from the active baseline'
	);
	const restoreTrackingSidebar = await openSidebarPanel(
		adminPage,
		'Tracking'
	);
	await restoreTrackingSidebar
		.getByRole( 'button', { name: 'Mark as primary CTA' } )
		.click();
	await adminPage.waitForTimeout( 400 );
	await adminPage.waitForFunction(
		() =>
			document.body.textContent?.includes(
				'Primary CTA selected in Variant A'
			)
	);
	const trackingSidebarAfterRestore = await openSidebarPanel(
		adminPage,
		'Tracking'
	);
	assert(
		( await trackingSidebarAfterRestore.innerText() ).includes(
			'Primary CTA selected in Variant A: Inserted CTA button.'
		),
		'Expected Tracking to describe the active variant as explicitly marked once the Primary CTA toggle is restored'
	);
	assert(
		(
			( await frame
				.locator( '.wp-block-abtest-block-test__cta-badge' )
				.textContent() ) ?? ''
		).trim() === 'Variant A CTA: Primary CTA selected',
		'Expected the editor canvas CTA badge to update after restoring an explicit primary CTA'
	);
	await selectParentBlock( adminPage, 'e2einstats1' );
	const explicitCompareSidebar = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	const explicitCompareVariantBText = normalizeWhitespace(
		await getCompareCards( explicitCompareSidebar ).nth( 1 ).innerText()
	);
	assert(
		explicitCompareVariantBText.includes( 'CTA differs' ) &&
			explicitCompareVariantBText.includes( 'CTA' ) &&
			explicitCompareVariantBText.includes( 'No CTA detected yet' ) &&
			explicitCompareVariantBText.includes(
				'Baseline: Primary CTA: Inserted CTA button'
			),
		'Expected Compare variants to update the CTA comparison when the active baseline switches from fallback tracking to an explicit primary CTA'
	);

	await openEditor( adminPage, templatePostId );
	const templateFrame = await selectParentBlock( adminPage, 'e2etemplate1' );
	await templateFrame
		.getByText( 'Quick-start templates' )
		.waitFor( { state: 'visible', timeout: 8000 } );
	await templateFrame
		.getByRole( 'button', { name: 'Headline + body + button' } )
		.click();
	await adminPage.waitForTimeout( 600 );
	const templateTexts = await getVariantCanvasTexts(
		adminPage,
		templateFrame,
		[ 'a', 'b', 'c' ]
	);
	assert(
		templateTexts.a.includes( 'Free shipping on your first order' ) &&
			templateTexts.b.includes( 'Checkout in one fast step' ) &&
			templateTexts.c.includes( 'Limited-time bonus for new customers' ),
		'Expected the starter template picker to seed variant-specific copy into every variant'
	);
	await selectInnerBlockByName(
		adminPage,
		'e2etemplate1',
		'a',
		'core/button'
	);
	await adminPage.waitForTimeout( 400 );
	assert(
		( await getSelectedBlockClassName( adminPage ) ).includes(
			'abtest-cta'
		),
		'Expected starter templates to pre-mark the seeded CTA button as the primary CTA'
	);
	await selectParentBlock( adminPage, 'e2etemplate1' );
	await adminPage
		.getByRole( 'button', { name: 'Open quick summary and actions' } )
		.click();
	const templateMenu = adminPage.locator(
		'.wp-block-abtest-block-test__toolbar-dropdown-content'
	);
	assert(
		( await templateMenu
			.getByRole( 'menuitem', { name: 'Headline + body + button' } )
			.isDisabled() ) === true,
		'Expected starter template actions to disable once the experiment already contains seeded content'
	);
	await adminPage.keyboard.press( 'Escape' );
	await insertHeadingIntoVariant(
		adminPage,
		'e2etemplate1',
		'a',
		'Template Drift Heading'
	);
	await adminPage.waitForTimeout( 500 );
	await selectParentBlock( adminPage, 'e2etemplate1' );
	const compareSidebar = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	const compareSidebarText = normalizeWhitespace(
		await compareSidebar.innerText()
	);
	const compareCards = getCompareCards( compareSidebar );
	assert(
		compareSidebarText.includes(
			'Comparing every variant against the active structure in Variant A.'
		),
		'Expected Compare variants to describe the active baseline before listing changed fields'
	);
	assert(
		normalizeWhitespace( await compareCards.nth( 0 ).innerText() ).includes(
			'Active baseline'
		) &&
			normalizeWhitespace(
				await compareCards.nth( 0 ).innerText()
			).includes( 'Primary CTA: Explore free shipping' ) &&
			normalizeWhitespace(
				await compareCards.nth( 0 ).innerText()
			).includes( '34%' ),
		'Expected the baseline compare card to keep the active variant summary pinned at the top of the compare view'
	);
	const compareVariantBText = normalizeWhitespace(
		await compareCards.nth( 1 ).innerText()
	);
	assert(
		compareSidebarText.includes( 'Variant A' ) &&
			compareSidebarText.includes(
				'Variants B and C differ from Variant A.'
			),
		'Expected Compare variants to surface the active-structure mismatch summary when one variant drifts'
	);
	assert(
		compareVariantBText.includes( 'CTA' ) &&
			compareVariantBText.includes( 'CTA differs' ) &&
			compareVariantBText.includes(
				'Primary CTA: See one-click checkout'
			) &&
			compareVariantBText.includes( 'Weight' ) &&
			compareVariantBText.includes( 'Weight differs' ) &&
			compareVariantBText.includes( '33%' ) &&
			compareVariantBText.includes( 'Structure' ) &&
			compareVariantBText.includes( 'Structure differs' ) &&
			compareVariantBText.includes( 'Added from baseline: Heading' ) &&
			! compareVariantBText.includes( 'Relevance' ),
		'Expected target compare cards to show only changed fields plus a compact changed-blocks structure summary'
	);
	await compareSidebar
		.getByRole( 'button', { name: 'Open Variant structure' } )
		.click();
	await adminPage.waitForTimeout( 300 );
	assert(
		( await adminPage
			.locator( '.interface-interface-skeleton__sidebar' )
			.getByText( 'Sync structure from active variant' )
			.count() ) === 1,
		'Expected Compare variants to link directly into the Variant structure sync controls when structures differ'
	);
	await selectParentBlock( adminPage, 'e2etemplate1' );
	const compareSidebarBeforeEdit = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	await getCompareCards( compareSidebarBeforeEdit )
		.nth( 1 )
		.getByRole( 'button', { name: 'Edit Variant B' } )
		.click();
	await adminPage.waitForTimeout( 400 );
	assert(
		( await getVisibleVariantCanvasText( templateFrame ) ).includes(
			'Checkout in one fast step'
		),
		'Expected Edit Variant B from Compare variants to jump straight into the requested variant canvas'
	);
	await selectParentBlock( adminPage, 'e2etemplate1' );
	const compareSidebarAfterEdit = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	await getCompareCards( compareSidebarAfterEdit )
		.nth( 1 )
		.getByRole( 'button', { name: 'Sync structure now' } )
		.click();
	await adminPage.waitForTimeout( 500 );
	const compareSidebarAfterSync = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	const compareVariantBAfterSync = getCompareCards(
		compareSidebarAfterSync
	).nth( 1 );
	const compareVariantBAfterSyncText = normalizeWhitespace(
		await compareVariantBAfterSync.innerText()
	);
	assert(
		! compareVariantBAfterSyncText.includes( 'Structure differs' ) &&
			! compareVariantBAfterSyncText.includes(
				'Added from baseline: Heading'
			) &&
			( await compareVariantBAfterSync
				.getByRole( 'button', { name: 'Sync structure now' } )
				.count() ) === 0,
		'Expected Sync structure now from Compare variants to clear the structure-only change row once the target variant is aligned'
	);

	await openEditor( adminPage, lifecyclePostId );
	const lifecycleFrame = await selectParentBlock(
		adminPage,
		'e2elifecycle1'
	);
	const lifecycleBefore =
		await getSelectedExperimentAttributeSnapshot( adminPage );
	const lifecycleSidebar = await openSidebarPanel(
		adminPage,
		'Experiment lifecycle'
	);
	assert(
		( await lifecycleSidebar
			.getByRole( 'button', {
				name: 'Use current winner as new baseline',
			} )
			.isDisabled() ) === false,
		'Expected lifecycle controls to enable the winner baseline action when a winner is already resolved'
	);
	await lifecycleSidebar
		.getByRole( 'button', { name: 'Use current winner as new baseline' } )
		.click();
	await adminPage.waitForTimeout( 600 );
	const lifecycleAfterBaseline =
		await getSelectedExperimentAttributeSnapshot( adminPage );
	assert(
		lifecycleAfterBaseline.experimentId !== lifecycleBefore.experimentId &&
			lifecycleAfterBaseline.blockInstanceId !==
				lifecycleBefore.blockInstanceId,
		'Expected lifecycle baseline action to rotate both experiment identity keys for a fresh experiment history'
	);
	assert(
		lifecycleAfterBaseline.winnerMode === 'off' &&
			Number( lifecycleAfterBaseline.weights?.a ?? 0 ) === 50 &&
			Number( lifecycleAfterBaseline.weights?.b ?? 0 ) === 50,
		'Expected lifecycle baseline action to clear winner mode and equalize weights'
	);
	await lifecycleFrame
		.getByText( 'Lifecycle Variant B body' )
		.first()
		.waitFor( { state: 'visible', timeout: 8000 } );
	const lifecycleBaselineTexts = await getVariantCanvasTexts(
		adminPage,
		lifecycleFrame,
		[ 'a', 'b' ]
	);
	assert(
		lifecycleBaselineTexts.a.includes( 'Lifecycle Variant B body' ) &&
			lifecycleBaselineTexts.b.includes( 'Lifecycle Variant B body' ),
		`Expected lifecycle baseline action to copy the resolved winner content into every variant. Snapshot: ${ JSON.stringify(
			lifecycleBaselineTexts
		) }`
	);
	await lifecycleSidebar
		.getByRole( 'button', { name: 'Start new experiment' } )
		.click();
	await adminPage.waitForTimeout( 600 );
	const lifecycleAfterRestart =
		await getSelectedExperimentAttributeSnapshot( adminPage );
	assert(
		lifecycleAfterRestart.experimentId !==
			lifecycleAfterBaseline.experimentId &&
			lifecycleAfterRestart.blockInstanceId !==
				lifecycleAfterBaseline.blockInstanceId,
		'Expected Start new experiment to rotate experiment and block identity again'
	);
	await lifecycleFrame
		.getByText( 'Lifecycle Variant B body' )
		.first()
		.waitFor( { state: 'visible', timeout: 8000 } );
	const lifecycleRestartTexts = await getVariantCanvasTexts(
		adminPage,
		lifecycleFrame,
		[ 'a', 'b' ]
	);
	assert(
		lifecycleRestartTexts.a.includes( 'Lifecycle Variant B body' ) &&
			lifecycleRestartTexts.b.includes( 'Lifecycle Variant B body' ),
		'Expected Start new experiment to keep the current variant content in place'
	);

	await openEditor( adminPage, authoringPostId );
	const authoringFrame = await selectParentBlock(
		adminPage,
		'e2eauthoring1'
	);
	const authoringBefore = await getVariantCanvasTexts(
		adminPage,
		authoringFrame,
		[ 'a', 'b' ]
	);
	await adminPage
		.getByRole( 'button', { name: 'Open quick summary and actions' } )
		.click();
	const authoringMenu = adminPage.locator(
		'.wp-block-abtest-block-test__toolbar-dropdown-content'
	);
	await authoringMenu
		.getByRole( 'menuitem', { name: 'Swap A and B' } )
		.click();
	await adminPage.waitForTimeout( 500 );
	const authoringAfterSwap = await getVariantCanvasTexts(
		adminPage,
		authoringFrame,
		[ 'a', 'b' ]
	);
	assert(
		authoringAfterSwap.a === authoringBefore.b &&
			authoringAfterSwap.b === authoringBefore.a,
		'Expected Swap A and B to exchange the two variant block trees without breaking their content'
	);
	await adminPage
		.locator( '[role="toolbar"] button[aria-label="Edit Variant A"]' )
		.click();
	await adminPage.waitForTimeout( 400 );
	await adminPage
		.getByRole( 'button', { name: 'Open quick summary and actions' } )
		.click();
	await authoringMenu
		.getByRole( 'menuitem', { name: 'Copy active variant to Variant B' } )
		.click();
	await adminPage.waitForTimeout( 500 );
	const authoringAfterCopy = await getVariantCanvasTexts(
		adminPage,
		authoringFrame,
		[ 'a', 'b' ]
	);
	assert(
		authoringAfterCopy.a === authoringAfterCopy.b,
		'Expected Copy active variant to duplicate the visible variant block tree into the requested target variant'
	);

	await openEditor( adminPage, structureSyncPostId );
	const structureFrame = await selectParentBlock(
		adminPage,
		'e2estructure1'
	);
	await insertHeadingIntoVariant(
		adminPage,
		'e2estructure1',
		'a',
		'Structure Sync Heading'
	);
	await structureFrame
		.getByText( 'Structure Sync Heading' )
		.waitFor( { state: 'visible', timeout: 8000 } );
	await selectParentBlock( adminPage, 'e2estructure1' );
	const structureSidebar = await openSidebarPanel(
		adminPage,
		'Variant structure'
	);
	const structureSidebarBeforeSync = (
		await structureSidebar.innerText()
	).replace( /\s+/g, ' ' );
	assert(
		structureSidebarBeforeSync.includes(
			'Variant B differs from Variant A.'
		),
		'Expected Variant structure to summarize which target variant differs from the active structure'
	);
	assert(
		structureSidebarBeforeSync.includes( 'Variant B' ) &&
			structureSidebarBeforeSync.includes( 'differs' ),
		'Expected Variant structure to show Variant B as a differing target before sync'
	);
	const structureCanvasNotice = structureFrame.locator(
		'.wp-block-abtest-block-test__inline-notice'
	);
	await structureCanvasNotice
		.getByText(
			'Variant B differs from the active structure in Variant A.'
		)
		.waitFor( {
			state: 'visible',
			timeout: 8000,
		} );
	await structureCanvasNotice
		.getByRole( 'button', { name: 'Sync now' } )
		.click();
	await adminPage.waitForTimeout( 500 );
	await structureSidebar
		.getByRole( 'button', { name: 'Sync structure from active variant' } )
		.waitFor( { state: 'visible', timeout: 8000 } );
	const structureSidebarText = ( await structureSidebar.innerText() )
		.replace( /\s+/g, ' ' )
		.trim();
	assert(
		structureSidebarText.includes( 'Synced structure to Variant B.' ),
		'Expected Variant structure to confirm the A/B sync targets'
	);
	assert(
		structureSidebarText.includes(
			'All variants match the active structure.'
		) &&
			structureSidebarText.includes( 'Variant B' ) &&
			structureSidebarText.includes( 'matches' ),
		'Expected Variant structure to update its summary and status rows after syncing from the canvas notice'
	);
	assert(
		( await structureSidebar
			.getByRole( 'button', {
				name: 'Sync structure from active variant',
			} )
			.isDisabled() ) === true,
		'Expected Variant structure sync button to disable once every target variant matches the active structure'
	);
	assert(
		( await structureFrame
			.locator( '.wp-block-abtest-block-test__inline-notice' )
			.getByText(
				'Variant B differs from the active structure in Variant A.'
			)
			.count() ) === 0,
		'Expected the canvas structure notice to disappear after the variants are aligned'
	);
	const structureAfterInsert = await getVariantCanvasTexts(
		adminPage,
		structureFrame,
		[ 'a', 'b' ]
	);
	assert(
		structureAfterInsert.b.includes( 'Structure Sync Variant B body' ) &&
			structureAfterInsert.b.includes( 'Structure B CTA' ) &&
			structureAfterInsert.b.includes( 'Structure Sync Heading' ),
		'Expected structure sync to add the missing block while preserving existing Variant B content'
	);
	await adminPage
		.locator( '[role="toolbar"] button[aria-label="Edit Variant A"]' )
		.click();
	await adminPage.waitForTimeout( 400 );
	await moveLastBlockToTopInVariant( adminPage, 'e2estructure1', 'a' );
	await adminPage.waitForTimeout( 500 );
	await selectParentBlock( adminPage, 'e2estructure1' );
	const structureSourceOrder = await getVariantInnerBlockNames(
		adminPage,
		'e2estructure1',
		'a'
	);
	const structureSidebarAfterReorder = await openSidebarPanel(
		adminPage,
		'Variant structure'
	);
	const structureReorderText = (
		await structureSidebarAfterReorder.innerText()
	).replace( /\s+/g, ' ' );
	assert(
		structureReorderText.includes( 'Variant B' ) &&
			structureReorderText.includes( 'differs' ),
		'Expected Variant structure to detect block reordering differences before syncing them'
	);
	assert(
		( await structureSidebarAfterReorder
			.getByRole( 'button', {
				name: 'Sync structure from active variant',
			} )
			.isDisabled() ) === false,
		'Expected Variant structure sync button to re-enable when the active structure is reordered'
	);
	await structureSidebar
		.getByRole( 'button', {
			name: 'Sync structure from active variant',
		} )
		.click();
	await adminPage.waitForTimeout( 500 );
	const structureAfterReorder = await getVariantCanvasTexts(
		adminPage,
		structureFrame,
		[ 'a', 'b' ]
	);
	const structureTargetOrder = await getVariantInnerBlockNames(
		adminPage,
		'e2estructure1',
		'b'
	);
	assert(
		JSON.stringify( structureTargetOrder ) ===
			JSON.stringify( structureSourceOrder ) &&
			structureAfterReorder.b.includes(
				'Structure Sync Variant B body'
			) &&
			structureAfterReorder.b.includes( 'Structure B CTA' ),
		`Expected structure sync to reorder matching blocks while keeping Variant B content intact. Source: ${ JSON.stringify(
			structureSourceOrder
		) }, target: ${ JSON.stringify( structureTargetOrder ) }, text: ${
			structureAfterReorder.b
		}`
	);
	assert(
		( await structureSidebarAfterReorder.innerText() )
			.replace( /\s+/g, ' ' )
			.includes( 'All variants match the active structure.' ),
		'Expected Variant structure to report that the structures now match after the reorder sync'
	);
	assert(
		( await structureSidebarAfterReorder
			.getByRole( 'button', {
				name: 'Sync structure from active variant',
			} )
			.isDisabled() ) === true,
		'Expected Variant structure sync button to disable again after the reorder differences are resolved'
	);

	await openEditor( adminPage, structureSyncThreeVariantPostId );
	const structureThreeFrame = await selectParentBlock(
		adminPage,
		'e2estructure3'
	);
	await insertHeadingIntoVariant(
		adminPage,
		'e2estructure3',
		'a',
		'Three Variant Structure Heading'
	);
	await structureThreeFrame
		.getByText( 'Three Variant Structure Heading' )
		.waitFor( { state: 'visible', timeout: 8000 } );
	await selectParentBlock( adminPage, 'e2estructure3' );
	const structureThreeSidebar = await openSidebarPanel(
		adminPage,
		'Variant structure'
	);
	const structureThreeBeforeSync = (
		await structureThreeSidebar.innerText()
	).replace( /\s+/g, ' ' );
	assert(
		structureThreeBeforeSync.includes(
			'Variants B and C differ from Variant A.'
		) &&
			structureThreeBeforeSync.includes( 'Variant B' ) &&
			structureThreeBeforeSync.includes( 'differs' ) &&
			structureThreeBeforeSync.includes( 'Variant C' ) &&
			structureThreeBeforeSync.includes( 'differs' ),
		'Expected Variant structure to show both differing target variants before the A/B/C sync'
	);
	await structureThreeSidebar
		.getByRole( 'button', {
			name: 'Sync structure from active variant',
		} )
		.click();
	await adminPage.waitForTimeout( 500 );
	const structureThreeSidebarText = (
		await structureThreeSidebar.innerText()
	).replace( /\s+/g, ' ' );
	assert(
		structureThreeSidebarText.includes(
			'Synced structure to Variant B and Variant C.'
		) &&
			structureThreeSidebarText.includes(
				'All variants match the active structure.'
			) &&
			structureThreeSidebarText.includes( 'Variant B' ) &&
			structureThreeSidebarText.includes( 'matches' ) &&
			structureThreeSidebarText.includes( 'Variant C' ) &&
			structureThreeSidebarText.includes( 'matches' ),
		'Expected Variant structure to report both target variants in the A/B/C sync flow'
	);
	assert(
		( await structureThreeSidebar
			.getByRole( 'button', {
				name: 'Sync structure from active variant',
			} )
			.isDisabled() ) === true,
		'Expected Variant structure sync button to disable after the A/B/C variants are aligned'
	);
	const structureThreeTexts = await getVariantCanvasTexts(
		adminPage,
		structureThreeFrame,
		[ 'a', 'b', 'c' ]
	);
	assert(
		structureThreeTexts.b.includes( 'Three Variant Structure Heading' ) &&
			structureThreeTexts.b.includes(
				'Structure Three Variant B body'
			) &&
			structureThreeTexts.b.includes( 'Structure Three B CTA' ) &&
			structureThreeTexts.c.includes(
				'Three Variant Structure Heading'
			) &&
			structureThreeTexts.c.includes(
				'Structure Three Variant C body'
			) &&
			structureThreeTexts.c.includes( 'Structure Three C CTA' ),
		'Expected Variant structure sync to apply the same source structure to both Variant B and Variant C while preserving their content'
	);

	await openEditor( adminPage, reasonPostId );
	await selectParentBlock( adminPage, 'e2ereason1' );
	const rulesSidebar = await openSidebarPanel( adminPage, 'Winning Rules' );
	await rulesSidebar
		.getByRole( 'button', { name: 'Reevaluate now' } )
		.click();
	await adminPage.waitForTimeout( 800 );
	const reasonSidebar = await openDiagnosticsPanel( adminPage );
	const reasonSidebarText = ( await reasonSidebar.innerText() ).replace(
		/\s+/g,
		' '
	);
	assert(
		reasonSidebarText.includes( 'Automatic winner' ) &&
			reasonSidebarText.includes( 'No winner yet: not enough data' ) &&
			reasonSidebarText.includes( 'Impressions 0 / 100, clicks 0 / 1' ),
		'Expected Diagnostics to explain the automatic winner state with the new no-data reason text'
	);

	await openEditor( adminPage, candidatePostId );
	await selectParentBlock( adminPage, 'e2ecandidate1' );
	const candidateRulesSidebar = await openSidebarPanel(
		adminPage,
		'Winning Rules'
	);
	assert(
		( await candidateRulesSidebar
			.getByRole( 'button', { name: 'Use candidate as manual winner' } )
			.isDisabled() ) === false,
		'Expected Winning Rules to enable the candidate-to-manual action when a candidate exists'
	);
	await candidateRulesSidebar
		.getByRole( 'button', { name: 'Use candidate as manual winner' } )
		.click();
	await adminPage.waitForTimeout( 500 );
	const candidateCompareManualSidebar = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	const candidateManualCompareText = normalizeWhitespace(
		await getCompareCards( candidateCompareManualSidebar )
			.nth( 1 )
			.innerText()
	);
	assert(
		candidateManualCompareText.includes( 'Manual winner' ),
		'Expected Compare variants to surface the manual winner badge when the candidate is promoted to a manual winner'
	);
	const candidateManualSidebar = await openDiagnosticsPanel( adminPage );
	const candidateManualText = (
		await candidateManualSidebar.innerText()
	).replace( /\s+/g, ' ' );
	assert(
		candidateManualText.includes( 'Manual winner is in use: Variant B' ),
		'Expected Diagnostics to reflect the manual winner summary after applying the candidate'
	);
	await openSidebarPanel( adminPage, 'Winning Rules' );
	await candidateRulesSidebar
		.getByRole( 'button', { name: 'Return to automatic winner' } )
		.click();
	await adminPage.waitForTimeout( 500 );
	await adminPage
		.getByRole( 'button', { name: 'Preview winner mode' } )
		.click();
	await adminPage.waitForTimeout( 400 );
	const candidateCompareWinnerSidebar = await openSidebarPanel(
		adminPage,
		'Compare variants'
	);
	const candidateWinnerCompareText = normalizeWhitespace(
		await getCompareCards( candidateCompareWinnerSidebar )
			.nth( 1 )
			.innerText()
	);
	assert(
		candidateWinnerCompareText.includes( 'Automatic candidate' ) &&
			candidateWinnerCompareText.includes( 'Shown in winner preview' ),
		'Expected Compare variants to surface candidate and winner-preview decision badges for the active winner-preview target'
	);
	const candidateAutomaticSidebar = await openDiagnosticsPanel( adminPage );
	const candidateAutomaticText = (
		await candidateAutomaticSidebar.innerText()
	).replace( /\s+/g, ' ' );
	assert(
		candidateAutomaticText.includes(
			'Automatic winner candidate: Variant B'
		),
		'Expected Diagnostics to return to the automatic candidate summary after clearing the manual override'
	);

	await openEditor( adminPage, malformedPostId );
	await selectParentBlock( adminPage, 'e2eeditormalformed1' );
	await adminPage.waitForTimeout( 500 );
	const malformedSidebar = await openDiagnosticsPanel( adminPage );
	const malformedSidebarText = ( await malformedSidebar.innerText() ).replace(
		/\s+/g,
		' '
	);

	assert(
		malformedSidebarText.includes(
			'Saved content was missing Variant B.'
		) &&
			malformedSidebarText.includes(
				'front-end output would fall back to Variant A until you save this repaired block.'
			),
		'Expected Diagnostics to explain the dom-prune fallback path for malformed saved variant content'
	);
}

async function run() {
	writeLog( `Playwright smoke mode: ${ SMOKE_MODE }` );

	const statsPostId = createFixturePost(
		'E2E Stats Fixture',
		`${ buildExperimentBlock( {
			blockInstanceId: 'e2einstats1',
			emitDataLayer: true,
			experimentId: 'e2e_stats_fixture',
			experimentLabel: 'Stats Fixture',
			stickyAssignment: true,
			stickyScope: 'instance',
			variantABody: 'Stats Variant A body',
			variantBBody: 'Stats Variant B body',
		} ) }${ buildParagraph( 'Outside block' ) }`
	);
	const malformedEditorPostId = createFixturePost(
		'E2E Editor DOM Prune Note Fixture',
		`${ buildSingleVariantExperimentBlock( {
			blockInstanceId: 'e2eeditormalformed1',
			experimentId: 'e2e_editor_dom_prune_fixture',
			experimentLabel: 'Editor DOM Prune Fixture',
			previewQueryKey: 'ab_e2e_editor_dom_prune_fixture',
			variantABody: 'Editor DOM prune Variant A body',
		} ) }${ buildParagraph( 'Outside block' ) }`
	);
	const templatePostId = createFixturePost(
		'E2E Starter Template Fixture',
		buildEmptyExperimentBlock( {
			blockInstanceId: 'e2etemplate1',
			experimentId: 'e2e_template_fixture',
			experimentLabel: 'Starter Template Fixture',
			variantCount: 3,
		} )
	);
	const lifecyclePostId = createFixturePost(
		'E2E Experiment Lifecycle Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2elifecycle1',
			experimentId: 'e2e_lifecycle_fixture',
			experimentLabel: 'Lifecycle Fixture',
			manualWinner: 'b',
			variantABody: 'Lifecycle Variant A body',
			variantBBody: 'Lifecycle Variant B body',
			weights: {
				a: 70,
				b: 30,
			},
			winnerMode: 'manual',
		} )
	);
	const authoringPostId = createFixturePost(
		'E2E Variant Authoring Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2eauthoring1',
			experimentId: 'e2e_authoring_fixture',
			experimentLabel: 'Authoring Fixture',
			variantABody: 'Authoring Variant A body',
			variantAContent: `${ buildParagraph(
				'Authoring Variant A body'
			) }${ buildParagraph( 'Authoring Variant A detail' ) }`,
			variantBBody: 'Authoring Variant B body',
			variantBContent: `${ buildParagraph(
				'Authoring Variant B body'
			) }${ buildParagraph( 'Authoring Variant B detail' ) }`,
		} )
	);
	const structureSyncPostId = createFixturePost(
		'E2E Variant Structure Sync Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2estructure1',
			experimentId: 'e2e_structure_sync_fixture',
			experimentLabel: 'Structure Sync Fixture',
			variantABody: 'Structure Sync Variant A body',
			variantAContent: `${ buildParagraph(
				'Structure Sync Variant A body'
			) }${ buildButton( 'Structure A CTA' ) }`,
			variantBBody: 'Structure Sync Variant B body',
			variantBContent: `${ buildParagraph(
				'Structure Sync Variant B body'
			) }${ buildButton( 'Structure B CTA' ) }`,
		} )
	);
	const structureSyncThreeVariantPostId = createFixturePost(
		'E2E Variant Structure Sync Three-Up Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2estructure3',
			experimentId: 'e2e_structure_sync_three_fixture',
			experimentLabel: 'Structure Sync Three Fixture',
			variantABody: 'Structure Three Variant A body',
			variantAContent: `${ buildParagraph(
				'Structure Three Variant A body'
			) }${ buildButton( 'Structure Three A CTA' ) }`,
			variantBBody: 'Structure Three Variant B body',
			variantBContent: `${ buildParagraph(
				'Structure Three Variant B body'
			) }${ buildButton( 'Structure Three B CTA' ) }`,
			variantCBody: 'Structure Three Variant C body',
			variantCContent: `${ buildParagraph(
				'Structure Three Variant C body'
			) }${ buildButton( 'Structure Three C CTA' ) }`,
			variantCount: 3,
		} )
	);
	const reasonPostId = createFixturePost(
		'E2E Winner Reason Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2ereason1',
			experimentId: 'e2e_reason_fixture',
			experimentLabel: 'Reason Fixture',
			variantABody: 'Reason Variant A body',
			variantBBody: 'Reason Variant B body',
			winnerMode: 'automatic',
		} )
	);
	const candidatePostId = createFixturePost(
		'E2E Winner Candidate Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2ecandidate1',
			experimentId: 'e2e_candidate_fixture',
			experimentLabel: 'Candidate Fixture',
			variantABody: 'Candidate Variant A body',
			variantBBody: 'Candidate Variant B body',
			winnerMode: 'automatic',
		} )
	);
	seedWinnerState( candidatePostId, 'e2ecandidate1', {
		evaluatedAt: Math.floor( Date.now() / 1000 ),
		metric: 'ctr',
		reasonCode: 'candidate',
		status: 'candidate',
		variants: [
			{
				clicks: 1,
				ctr: 0,
				impressions: 1,
				variantKey: 'a',
			},
			{
				clicks: 2,
				ctr: 0.5,
				impressions: 4,
				variantKey: 'b',
			},
		],
		winner: 'b',
		windowDays: 14,
	} );

	if ( RUN_CORE_CHECKS ) {
		await runCoreSmoke( statsPostId );
	}

	if ( RUN_EDITOR_CHECKS ) {
		await runEditorSmoke(
			statsPostId,
			templatePostId,
			malformedEditorPostId,
			lifecyclePostId,
			authoringPostId,
			structureSyncPostId,
			structureSyncThreeVariantPostId,
			reasonPostId,
			candidatePostId
		);
	}

	writeLog( 'Playwright smoke passed.' );
}

async function main() {
	try {
		await run();
	} finally {
		for ( const browser of browsers.splice( 0 ) ) {
			await browser.close().catch( () => undefined );
		}

		for ( const postId of createdPostIds.splice( 0 ) ) {
			try {
				runWp( [ 'post', 'delete', String( postId ), '--force' ] );
			} catch ( error ) {
				writeWarning(
					`Failed to delete fixture post ${ postId }: ${ String(
						error
					) }`
				);
			}
		}
	}
}

void main();
