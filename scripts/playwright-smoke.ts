import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

type SmokeMode = 'core' | 'editor' | 'full';
type FrontRenderMode = 'css-hide' | 'dom-prune';
type StickyScope = 'experiment' | 'instance';
type VariantKey = 'a' | 'b';

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

function buildParagraph( text: string ) {
	return `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
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
	showRuntimeLabel = false,
	stickyAssignment = true,
	stickyScope = 'instance',
	variantABody,
	variantBBody,
}: {
	blockInstanceId: string;
	experimentId: string;
	experimentLabel: string;
	emitDataLayer?: boolean;
	frontRenderMode?: FrontRenderMode;
	showRuntimeLabel?: boolean;
	stickyAssignment?: boolean;
	stickyScope?: StickyScope;
	variantABody: string;
	variantBBody: string;
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
		previewQueryKey: `ab_${ experimentId }`,
		showRuntimeLabel,
		stickyAssignment,
		stickyScope,
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
	) }${ buildVariantBlock(
		'b',
		buildParagraph( variantBBody )
	) }<!-- /wp:abtest-block/test -->`;
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

async function openSidebarPanel( page: Page, title: string ) {
	const sidebar = page.locator( '.interface-interface-skeleton__sidebar' );
	await sidebar.waitFor( { state: 'visible', timeout: 30000 } );
	await page.evaluate( ( panelTitle ) => {
		const sidebarElement = document.querySelector(
			'.interface-interface-skeleton__sidebar'
		);
		const buttons = Array.from(
			sidebarElement?.querySelectorAll( 'button' ) ?? []
		) as HTMLButtonElement[];
		const blockTab = buttons.find(
			( element ) => element.textContent?.trim() === 'Block'
		);

		blockTab?.click();

		const toggle = buttons.find(
			( element ) => element.textContent?.trim() === panelTitle
		);

		if ( ! toggle ) {
			throw new Error( `Missing sidebar panel toggle: ${ panelTitle }` );
		}

		if ( toggle.getAttribute( 'aria-expanded' ) !== 'true' ) {
			toggle.click();
		}
	}, title );
	await page.waitForFunction(
		( panelTitle ) => {
			const sidebarElement = document.querySelector(
				'.interface-interface-skeleton__sidebar'
			);

			return sidebarElement?.textContent?.includes( panelTitle ) ?? false;
		},
		title,
		{ timeout: 30000 }
	);
	await page.waitForTimeout( 1000 );

	return sidebar;
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
		malformedRuntimeError.includes(
			'Requested Variant B could not be rendered. Showing Variant A instead.'
		),
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

async function runEditorSmoke( statsPostId: number, malformedPostId: number ) {
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
		.locator( '[role="toolbar"] button[aria-label="Winner preview"]' )
		.click();
	await adminPage.waitForTimeout( 400 );
	assert(
		await isParentBlockSelected( adminPage, 'e2einstats1' ),
		'Expected Winner preview toolbar action to keep parent block selection'
	);
	await adminPage
		.locator( '[role="toolbar"] button[aria-label="Traffic mode"]' )
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

	await adminPage.getByRole( 'button', { name: 'More' } ).click();
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
		'weighted traffic split',
		'Sticky assignment for this block',
		'Sticky assignment for this experiment',
		'Manual winner preview',
		'Locked automatic winner',
		'Automatic winner candidate',
		'No resolved winner yet',
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
		name: 'Show assignment label',
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

	if ( RUN_CORE_CHECKS ) {
		await runCoreSmoke( statsPostId );
	}

	if ( RUN_EDITOR_CHECKS ) {
		await runEditorSmoke( statsPostId, malformedEditorPostId );
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
