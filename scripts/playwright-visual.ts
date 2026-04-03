import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type Browser, type Locator, type Page } from 'playwright';

type VariantKey = 'a' | 'b';

const BASE_URL = process.env.AB_TEST_BLOCK_SITE_URL ?? 'http://localhost:8890';
const ADMIN_USER = process.env.AB_TEST_BLOCK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.AB_TEST_BLOCK_ADMIN_PASSWORD ?? 'password';
const WP_ENV_BIN = join( process.cwd(), 'node_modules', '.bin', 'wp-env' );
const BASELINE_DIR = join(
	process.cwd(),
	'tests',
	'visual-baselines',
	'ab-test-block'
);
const TEMP_DIR = join(
	process.cwd(),
	'.tmp-visual-artifacts',
	'ab-test-block'
);
const UPDATE_BASELINES = process.argv.includes( '--update' );

const createdPostIds: number[] = [];
const browsers: Browser[] = [];

function writeLog( value: string ) {
	process.stdout.write( `${ value }\n` );
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

function buildHeading( text: string ) {
	return `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${ text }</h3><!-- /wp:heading -->`;
}

function buildParagraph( text: string ) {
	return `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
}

function buildButtons( href: string, label: string ) {
	return `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button {"url":"${ href }","className":"abtest-cta"} --><div class="wp-block-button abtest-cta"><a class="wp-block-button__link wp-element-button" href="${ href }">${ label }</a></div><!-- /wp:button --></div><!-- /wp:buttons -->`;
}

function buildVariantBlock( variantKey: VariantKey, innerBlocks: string ) {
	return `<!-- wp:abtest-block/variant ${ JSON.stringify( {
		variantKey,
		variantLabel: `Variant ${ variantKey.toUpperCase() }`,
	} ) } --><div class="wp-block-abtest-block-variant" data-abtest-variant="${ variantKey }" data-variant-label="Variant ${ variantKey.toUpperCase() }">${ innerBlocks }</div><!-- /wp:abtest-block/variant -->`;
}

function buildExperimentBlock() {
	return `<!-- wp:abtest-block/test ${ JSON.stringify( {
		automaticMetric: 'ctr',
		blockInstanceId: 'visualfixture1',
		emitBrowserEvents: true,
		emitClarityHook: false,
		emitDataLayer: false,
		emitKexpLayer: false,
		evaluationWindowDays: 14,
		experimentId: 'visual_fixture',
		experimentLabel: 'Visual parity fixture',
		lockWinnerAfterSelection: true,
		minimumClicksPerVariant: 1,
		minimumImpressionsPerVariant: 100,
		previewQueryKey: 'ab_visual_fixture',
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
	} ) } -->${ buildVariantBlock(
		'a',
		`${ buildHeading(
			'Variant A: Free shipping framing'
		) }${ buildParagraph(
			'Use this canonical fixture to validate editor and front-end parity around shell styling, spacing, and CTA rhythm.'
		) }${ buildButtons( '#variant-a', 'Explore Variant A' ) }`
	) }${ buildVariantBlock(
		'b',
		`${ buildHeading(
			'Variant B: Limited-time framing'
		) }${ buildParagraph(
			'This alternate variant keeps the same structure while changing the copy so the two active states stay visually comparable.'
		) }${ buildButtons( '#variant-b', 'Explore Variant B' ) }`
	) }<!-- /wp:abtest-block/test -->`;
}

async function launchContext() {
	const browser = await chromium.launch( { headless: true } );
	const context = await browser.newContext( {
		deviceScaleFactor: 1,
		viewport: {
			width: 1440,
			height: 1400,
		},
	} );

	browsers.push( browser );

	return context;
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

async function selectVariantBlock(
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
								selectBlock: ( clientId: string ) => void;
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

			dispatcher.selectBlock( variantBlock.clientId );
		},
		{
			blockInstanceId,
			variantKey,
		}
	);

	await page.waitForTimeout( 800 );
}

function ensureCleanDirectory( directory: string ) {
	rmSync( directory, { force: true, recursive: true } );
	mkdirSync( directory, { recursive: true } );
}

async function waitForRoot( locator: Locator ) {
	await locator.waitFor( { state: 'visible', timeout: 30000 } );
}

async function prepareFrontRootForCapture( locator: Locator ) {
	await locator.evaluate( ( element ) => {
		element
			.querySelector( '.wp-block-abtest-block-test__runtime-label' )
			?.remove();
	} );
}

async function captureLocator( locator: Locator, outputPath: string ) {
	await locator.screenshot( {
		animations: 'disabled',
		path: outputPath,
	} );
}

function compareOrWriteBaseline( fileName: string, outputDirectory: string ) {
	const currentPath = join( outputDirectory, fileName );
	const baselinePath = join( BASELINE_DIR, fileName );

	if ( UPDATE_BASELINES ) {
		const buffer = readFileSync( currentPath );
		writeFileSync( baselinePath, buffer );
		return;
	}

	assert(
		readFileSync( baselinePath ).equals( readFileSync( currentPath ) ),
		`Visual baseline mismatch for ${ fileName }. Re-run bun run visual:e2e:update if the change is intentional.`
	);
}

async function captureVisualBaselines() {
	const fixturePostId = createFixturePost(
		'Visual Parity Fixture',
		`${ buildExperimentBlock() }${ buildParagraph( 'Outside block' ) }`
	);
	const outputDirectory = UPDATE_BASELINES ? BASELINE_DIR : TEMP_DIR;

	ensureCleanDirectory( outputDirectory );
	mkdirSync( BASELINE_DIR, { recursive: true } );

	const frontContext = await launchContext();
	const frontPage = await frontContext.newPage();

	for ( const variantKey of [ 'a', 'b' ] as const ) {
		await frontPage.goto(
			`${ BASE_URL }/?p=${ fixturePostId }&ab_visual_fixture=${ variantKey }`,
			{ waitUntil: 'domcontentloaded' }
		);
		const root = frontPage.locator( '.wp-block-abtest-block-test' ).first();
		await waitForRoot( root );
		await frontPage.waitForTimeout( 1200 );
		await prepareFrontRootForCapture( root );
		await captureLocator(
			root,
			join( outputDirectory, `front-${ variantKey }.png` )
		);
	}

	const adminContext = await launchContext();
	const adminPage = await adminContext.newPage();

	await loginToWpAdmin( adminPage );
	await openEditor( adminPage, fixturePostId );
	let frame = await selectParentBlock( adminPage, 'visualfixture1' );
	await adminPage
		.locator( '[role="toolbar"] button[aria-label="Edit Variant A"]' )
		.click();
	await adminPage.waitForTimeout( 500 );
	const editorRoot = frame.locator( '.wp-block-abtest-block-test' ).first();
	await waitForRoot( editorRoot );
	await captureLocator(
		editorRoot,
		join( outputDirectory, 'editor-parent-selected.png' )
	);

	await selectVariantBlock( adminPage, 'visualfixture1', 'b' );
	frame = adminPage.frameLocator( 'iframe[name="editor-canvas"]' );
	await captureLocator(
		frame.locator( '.wp-block-abtest-block-test' ).first(),
		join( outputDirectory, 'editor-child-selected.png' )
	);

	for ( const fileName of [
		'front-a.png',
		'front-b.png',
		'editor-parent-selected.png',
		'editor-child-selected.png',
	] ) {
		compareOrWriteBaseline( fileName, outputDirectory );
	}
}

async function main() {
	try {
		await captureVisualBaselines();
		writeLog(
			UPDATE_BASELINES
				? 'Updated visual baselines.'
				: 'Visual baseline check passed.'
		);
	} finally {
		for ( const browser of browsers.splice( 0 ) ) {
			await browser.close().catch( () => undefined );
		}

		for ( const postId of createdPostIds.splice( 0 ) ) {
			try {
				runWp( [ 'post', 'delete', String( postId ), '--force' ] );
			} catch {
				// Best-effort cleanup for local visual fixtures.
			}
		}
	}
}

void main();
