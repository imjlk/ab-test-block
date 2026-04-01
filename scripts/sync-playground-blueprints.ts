/* eslint-disable no-console */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const DEFAULT_BRANCH = 'main';
const DEFAULT_LANDING_PAGE = '/wp-admin/post.php?post=1001&action=edit';
const DEFAULT_PHP_VERSION = '8.3';
const DEFAULT_WP_VERSION = '6.8';
const BLUEPRINT_DIR = '.wordpress-org/blueprints';
const WORDPRESS_ORG_TEMPLATE = `${ BLUEPRINT_DIR }/blueprint.template.json`;
const GITHUB_TEMPLATE = `${ BLUEPRINT_DIR }/github-blueprint.template.json`;
const WORDPRESS_ORG_BLUEPRINT = `${ BLUEPRINT_DIR }/blueprint.json`;
const GITHUB_BLUEPRINT = `${ BLUEPRINT_DIR }/github-blueprint.json`;
const DEMO_POST_CONTENT = `${ BLUEPRINT_DIR }/demo-post-content.html`;
const DEFAULT_PLUGIN_ZIP_NAME = 'ab-test-block.zip';

type JsonRecord = Record< string, unknown >;

function getArgValue( flag: string ) {
	const direct = process.argv.find( ( arg ) =>
		arg.startsWith( `${ flag }=` )
	);
	if ( direct ) {
		return direct.slice( flag.length + 1 );
	}

	const index = process.argv.indexOf( flag );
	if ( index >= 0 ) {
		return process.argv[ index + 1 ];
	}

	return undefined;
}

function hasFlag( flag: string ) {
	return process.argv.includes( flag );
}

function normalizeRepositorySlug( value: string ) {
	const trimmed = value.trim().replace( /\.git$/, '' );
	const sshMatch = trimmed.match( /^git@github\.com:(.+\/.+)$/ );

	if ( sshMatch?.[ 1 ] ) {
		return sshMatch[ 1 ];
	}

	const httpsMatch = trimmed.match( /^https:\/\/github\.com\/(.+\/.+)$/ );

	if ( httpsMatch?.[ 1 ] ) {
		return httpsMatch[ 1 ];
	}

	return trimmed;
}

function getRepositorySlug() {
	const repoUrl = getArgValue( '--repo-url' );
	if ( repoUrl ) {
		return normalizeRepositorySlug( repoUrl );
	}

	if (
		typeof process.env.GITHUB_REPOSITORY === 'string' &&
		process.env.GITHUB_REPOSITORY.length > 0
	) {
		return process.env.GITHUB_REPOSITORY;
	}

	const remoteUrl = execSync( 'git remote get-url origin', {
		encoding: 'utf8',
	} ).trim();

	return normalizeRepositorySlug( remoteUrl );
}

function getBranchName() {
	return getArgValue( '--branch' ) ?? DEFAULT_BRANCH;
}

function replaceQuotedPlaceholder(
	template: string,
	token: string,
	value: string
) {
	return template.replaceAll( `"__${ token }__"`, JSON.stringify( value ) );
}

function buildRunPhpCode() {
	const demoPostContent = fs.readFileSync( DEMO_POST_CONTENT, 'utf8' ).trim();

	return `<?php
if ( ! function_exists( 'wp_insert_post' ) ) {
\trequire_once 'wordpress/wp-load.php';
}

$post_id = 1001;
$post_content = <<<'HTML'
${ demoPostContent }
HTML;

$postarr = array(
\t'ID' => $post_id,
\t'import_id' => $post_id,
\t'post_author' => 1,
\t'post_content' => $post_content,
\t'post_excerpt' => 'Seeded editor demo for the A/B Test block plugin.',
\t'post_name' => 'ab-test-block-playground-demo',
\t'post_status' => 'publish',
\t'post_title' => 'A/B Test Block Playground Demo',
\t'post_type' => 'post',
);

if ( get_post( $post_id ) ) {
\twp_update_post( $postarr );
} else {
\twp_insert_post( $postarr );
}
`;
}

function hydrateTemplate(
	templatePath: string,
	replacements: Record< string, string >
) {
	let template = fs.readFileSync( templatePath, 'utf8' );

	for ( const [ token, value ] of Object.entries( replacements ) ) {
		template = replaceQuotedPlaceholder( template, token, value );
	}

	return JSON.parse( template ) as JsonRecord;
}

function getLatestReleaseZipUrl( repositorySlug: string ) {
	return `https://github.com/${ repositorySlug }/releases/latest/download/${ DEFAULT_PLUGIN_ZIP_NAME }`;
}

function getRawGithubBlueprintUrl( repositorySlug: string, branch: string ) {
	return `https://raw.githubusercontent.com/${ repositorySlug }/${ branch }/.wordpress-org/blueprints/github-blueprint.json`;
}

function buildPlaygroundUrl( blueprintUrl: string ) {
	return `https://playground.wordpress.net/?blueprint-url=${ encodeURIComponent(
		blueprintUrl
	) }`;
}

function writeJsonFile( targetPath: string, data: unknown ) {
	fs.writeFileSync( targetPath, `${ JSON.stringify( data, null, '\t' ) }\n` );
}

function syncBlueprintFiles() {
	const repositorySlug = getRepositorySlug();
	const githubBlueprint = hydrateTemplate( GITHUB_TEMPLATE, {
		LANDING_PAGE: DEFAULT_LANDING_PAGE,
		PHP_VERSION: DEFAULT_PHP_VERSION,
		PLUGIN_ZIP_URL:
			getArgValue( '--plugin-zip-url' ) ??
			getLatestReleaseZipUrl( repositorySlug ),
		RUN_PHP_CODE: buildRunPhpCode(),
		WP_VERSION: DEFAULT_WP_VERSION,
	} );
	const wordpressOrgBlueprint = hydrateTemplate( WORDPRESS_ORG_TEMPLATE, {
		LANDING_PAGE: DEFAULT_LANDING_PAGE,
		PHP_VERSION: DEFAULT_PHP_VERSION,
		RUN_PHP_CODE: buildRunPhpCode(),
		WP_VERSION: DEFAULT_WP_VERSION,
	} );

	writeJsonFile( WORDPRESS_ORG_BLUEPRINT, wordpressOrgBlueprint );
	writeJsonFile( GITHUB_BLUEPRINT, githubBlueprint );

	console.log( `✅ Synced ${ WORDPRESS_ORG_BLUEPRINT }` );
	console.log( `✅ Synced ${ GITHUB_BLUEPRINT }` );
}

function printLinks() {
	const repositorySlug = getRepositorySlug();
	const branch = getBranchName();
	const blueprintUrl = getRawGithubBlueprintUrl( repositorySlug, branch );

	console.log( `Blueprint URL: ${ blueprintUrl }` );
	console.log( `Playground URL: ${ buildPlaygroundUrl( blueprintUrl ) }` );
}

function printInlineBlueprint() {
	const repositorySlug = getRepositorySlug();
	const githubBlueprint = hydrateTemplate( GITHUB_TEMPLATE, {
		LANDING_PAGE: DEFAULT_LANDING_PAGE,
		PHP_VERSION: DEFAULT_PHP_VERSION,
		PLUGIN_ZIP_URL:
			getArgValue( '--plugin-zip-url' ) ??
			getLatestReleaseZipUrl( repositorySlug ),
		RUN_PHP_CODE: buildRunPhpCode(),
		WP_VERSION: DEFAULT_WP_VERSION,
	} );

	process.stdout.write( `${ JSON.stringify( githubBlueprint ) }\n` );
}

function main() {
	if ( hasFlag( '--stdout-blueprint' ) ) {
		printInlineBlueprint();
		return;
	}

	if ( hasFlag( '--print-links' ) ) {
		printLinks();
		return;
	}

	syncBlueprintFiles();
}

main();
