import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright';

type StickyScope = 'experiment' | 'instance';
type VariantKey = 'a' | 'b';

const BASE_URL = process.env.AB_TEST_BLOCK_SITE_URL ?? 'http://localhost:8890';
const ADMIN_USER = process.env.AB_TEST_BLOCK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.AB_TEST_BLOCK_ADMIN_PASSWORD ?? 'password';
const WP_ENV_BIN = join( process.cwd(), 'node_modules', '.bin', 'wp-env' );
const INCLUDE_EDITOR_CHECKS =
	process.env.AB_TEST_BLOCK_SMOKE_INCLUDE_EDITOR !== '0' &&
	process.env.CI !== 'true';

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
	stickyAssignment = true,
	stickyScope = 'instance',
	variantABody,
	variantBBody,
}: {
	blockInstanceId: string;
	experimentId: string;
	experimentLabel: string;
	emitDataLayer?: boolean;
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
		lockWinnerAfterSelection: true,
		minimumClicksPerVariant: 1,
		minimumImpressionsPerVariant: 100,
		previewQueryKey: `ab_${ experimentId }`,
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

async function launchContext( initScript?: () => void ) {
	const browser = await chromium.launch( { headless: true } );
	const context = await browser.newContext();

	browsers.push( browser );

	if ( initScript ) {
		await context.addInitScript( initScript );
	}

	return context;
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
				const diagnostics = await page.evaluate( () => ( {
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
						ready: element.getAttribute( 'data-abtest-ready' ),
						runtimeLabel:
							element.querySelector(
								'.wp-block-abtest-block-test__runtime-label'
							)?.textContent ?? null,
					} ) ),
					title: document.title,
				} ) );
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
	const toggle = sidebar
		.locator( 'button' )
		.filter( { hasText: new RegExp( `^${ title }$` ) } )
		.first();
	const expanded = await toggle.getAttribute( 'aria-expanded' );

	if ( expanded !== 'true' ) {
		await toggle.click();
		await page.waitForTimeout( 1000 );
	}

	return sidebar;
}

async function openDebugPanel( page: Page ) {
	return openSidebarPanel( page, 'Debug' );
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

async function run() {
	const statsPostId = createFixturePost(
		'E2E Stats Fixture',
		buildExperimentBlock( {
			blockInstanceId: 'e2einstats1',
			emitDataLayer: true,
			experimentId: 'e2e_stats_fixture',
			experimentLabel: 'Stats Fixture',
			stickyAssignment: true,
			stickyScope: 'instance',
			variantABody: 'Stats Variant A body',
			variantBBody: 'Stats Variant B body',
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
	const editorPostId = INCLUDE_EDITOR_CHECKS
		? createFixturePost(
				'E2E Editor Fixture',
				`${ buildExperimentBlock( {
					blockInstanceId: 'e2eeditorfixture1',
					experimentId: 'e2e_editor_fixture',
					experimentLabel: 'Editor Fixture',
					stickyAssignment: true,
					stickyScope: 'instance',
					variantABody: 'Editor Variant A body',
					variantBBody: 'Editor Variant B body',
				} ) }${ buildParagraph( 'Outside block' ) }`
		  )
		: undefined;

	let adminPage: Page | undefined;

	if ( INCLUDE_EDITOR_CHECKS ) {
		const adminContext = await launchContext();
		adminPage = await adminContext.newPage();

		await loginToWpAdmin( adminPage );
		await openEditor( adminPage, editorPostId ?? statsPostId );

		const frame = await selectParentBlock( adminPage, 'e2eeditorfixture1' );
		assert(
			( await frame
				.locator( '.wp-block-abtest-block-test__tabs' )
				.count() ) === 0,
			'Expected canvas variant tabs to be removed from the editor shell'
		);
		assert(
			await isParentBlockSelected( adminPage, 'e2eeditorfixture1' ),
			'Expected the A/B test parent block to stay selected after selection sync'
		);
		await adminPage
			.locator( '[role="toolbar"] button[aria-label="Edit Variant B"]' )
			.click();
		await adminPage.waitForTimeout( 500 );
		assert(
			await isParentBlockSelected( adminPage, 'e2eeditorfixture1' ),
			'Expected toolbar variant switching to keep parent block selection'
		);
		assert(
			(
				await frame
					.locator( '.wp-block-abtest-block-variant.is-active' )
					.first()
					.innerText()
			).includes( 'Editor Variant B body' ),
			'Expected toolbar variant switching to show Variant B content in the editor canvas'
		);
		await adminPage
			.locator( '[role="toolbar"] button[aria-label="Winner preview"]' )
			.click();
		await adminPage.waitForTimeout( 400 );
		assert(
			await isParentBlockSelected( adminPage, 'e2eeditorfixture1' ),
			'Expected Winner preview toolbar action to keep parent block selection'
		);
		await adminPage
			.locator( '[role="toolbar"] button[aria-label="Traffic mode"]' )
			.click();
		await adminPage.waitForTimeout( 400 );
		assert(
			await isParentBlockSelected( adminPage, 'e2eeditorfixture1' ),
			'Expected Traffic mode toolbar action to keep parent block selection'
		);

		const insertedHeading = 'Playwright smoke heading';
		await insertHeadingIntoVariant(
			adminPage,
			'e2eeditorfixture1',
			'b',
			insertedHeading
		);
		await frame
			.getByText( insertedHeading )
			.waitFor( { state: 'visible' } );
		await removeHeadingFromVariant( adminPage, 'e2eeditorfixture1', 'b' );
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

		const advancedSidebar = await openSidebarPanel( adminPage, 'Advanced' );
		const advancedSidebarText = await advancedSidebar.innerText();
		if ( advancedSidebarText.includes( 'Edit Experiment ID' ) ) {
			await adminPage.evaluate( () => {
				const sidebar = document.querySelector(
					'.interface-interface-skeleton__sidebar'
				);
				const button = Array.from(
					sidebar?.querySelectorAll( 'button' ) ?? []
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
				const sidebar = document.querySelector(
					'.interface-interface-skeleton__sidebar'
				);
				const button = Array.from(
					sidebar?.querySelectorAll( 'button' ) ?? []
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
				'Skipping Experiment ID editor smoke check because the Advanced panel control text was not discoverable in this editor session.'
			);
		}
	}

	const frontContext = await launchContext( () => {
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
	} );
	const frontPage = await frontContext.newPage();

	await frontPage.goto( `${ BASE_URL }/?p=${ statsPostId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await waitForFrontStatsEvent( frontPage );

	const visibleVariantTexts = await getVisibleVariantTexts( frontPage );
	assert(
		visibleVariantTexts.length === 1,
		'Expected exactly one active variant to be visible on the front end'
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
		( key ) => window.localStorage.getItem( key ),
		`abtest:${ statsPostId }:e2einstats1`
	);
	assert(
		instanceStickyValue === 'a' || instanceStickyValue === 'b',
		'Expected instance sticky assignment to be stored in localStorage'
	);

	const nonStickyContext = await launchContext();
	const nonStickyPage = await nonStickyContext.newPage();

	await nonStickyPage.goto( `${ BASE_URL }/?p=${ nonStickyPostId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await nonStickyPage.waitForTimeout( 2500 );
	const nonStickyValue = await nonStickyPage.evaluate(
		( key ) => window.localStorage.getItem( key ),
		`abtest:${ nonStickyPostId }:e2enonsticky1`
	);
	assert(
		nonStickyValue === null,
		'Expected stickyAssignment=false to avoid storing a sticky localStorage key'
	);

	const sharedContext = await launchContext();
	const sharedPage = await sharedContext.newPage();

	await sharedPage.goto( `${ BASE_URL }/?p=${ sharedScopePostOneId }`, {
		waitUntil: 'domcontentloaded',
	} );
	await sharedPage.waitForTimeout( 1000 );
	const sharedKey = 'abtest-exp:e2e_shared_scope_fixture';
	await sharedPage.evaluate( ( key ) => {
		window.localStorage.setItem( key, 'b' );
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

	if ( adminPage ) {
		await openEditor( adminPage, statsPostId );
		const frame = await selectParentBlock( adminPage, 'e2einstats1' );
		void frame;
		const sidebar = await openDebugPanel( adminPage );
		await sidebar.getByRole( 'button', { name: 'Refresh stats' } ).click();
		await adminPage.waitForTimeout( 1200 );

		const debugText = await sidebar.innerText();
		assert(
			debugText.includes( 'This block' ) &&
				debugText.includes( 'This experiment' ),
			'Expected Debug panel to show both block and experiment stats cards'
		);
		assert(
			debugText.includes( '1 impressions' ),
			'Expected Debug panel to reflect the counted front-end impression'
		);
		assert(
			debugText.includes( 'Assignment source in traffic mode:' ),
			'Expected Debug panel to show the current assignment source text'
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
