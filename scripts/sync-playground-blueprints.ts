/* eslint-disable no-console */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

import { buildCanonicalExperimentMarkup } from './canonical-demo';

const DEFAULT_BRANCH = 'playground-build';
const DEFAULT_LANDING_PAGE = '/wp-admin/post.php?post=1001&action=edit';
const DEFAULT_PHP_VERSION = '8.3';
const DEFAULT_WP_VERSION = 'latest';
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

function getPlaygroundDemoPostContent() {
	return buildCanonicalExperimentMarkup( {
		blockInstanceId: 'playdemo01',
		experimentId: 'playground_demo',
		experimentLabel: 'Playground demo',
		previewQueryKey: 'ab_playground_demo',
	} );
}

function buildRunPhpCode( demoPostContent: string ) {
	return `<?php
if ( ! function_exists( 'wp_insert_post' ) ) {
\trequire_once '/wordpress/wp-load.php';
}

\tglobal $wpdb;

$post_id = 1001;
$post_title = 'A/B Test Block Playground Demo';
$post_excerpt = 'Seeded editor demo for the A/B Test block plugin.';
$post_slug = 'ab-test-block-playground-demo';
$post_date = current_time( 'mysql' );
$post_date_gmt = current_time( 'mysql', true );
$post_content = <<<'HTML'
${ demoPostContent }
HTML;

$postarr = array(
\t'ID' => $post_id,
\t'post_author' => 1,
\t'post_content' => $post_content,
\t'post_excerpt' => $post_excerpt,
\t'post_name' => $post_slug,
\t'post_status' => 'publish',
\t'post_title' => $post_title,
\t'post_type' => 'post',
);

if ( get_post( $post_id ) ) {
\twp_update_post( $postarr );
} else {
\t$wpdb->insert(
\t\t$wpdb->posts,
\t\tarray(
\t\t\t'ID' => $post_id,
\t\t\t'post_author' => 1,
\t\t\t'post_date' => $post_date,
\t\t\t'post_date_gmt' => $post_date_gmt,
\t\t\t'post_content' => $post_content,
\t\t\t'post_title' => $post_title,
\t\t\t'post_excerpt' => $post_excerpt,
\t\t\t'post_status' => 'publish',
\t\t\t'comment_status' => 'closed',
\t\t\t'ping_status' => 'closed',
\t\t\t'post_password' => '',
\t\t\t'post_name' => $post_slug,
\t\t\t'to_ping' => '',
\t\t\t'pinged' => '',
\t\t\t'post_modified' => $post_date,
\t\t\t'post_modified_gmt' => $post_date_gmt,
\t\t\t'post_content_filtered' => '',
\t\t\t'post_parent' => 0,
\t\t\t'guid' => home_url( '/?p=' . $post_id ),
\t\t\t'menu_order' => 0,
\t\t\t'post_type' => 'post',
\t\t\t'post_mime_type' => '',
\t\t\t'comment_count' => 0,
\t\t),
\t\tarray(
\t\t\t'%d',
\t\t\t'%d',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%d',
\t\t\t'%s',
\t\t\t'%d',
\t\t\t'%s',
\t\t\t'%s',
\t\t\t'%d',
\t\t)
\t);
}

clean_post_cache( $post_id );
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

function getRawGithubZipUrl( repositorySlug: string, branch: string ) {
	return `https://raw.githubusercontent.com/${ repositorySlug }/${ branch }/${ DEFAULT_PLUGIN_ZIP_NAME }`;
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
	const branch = getBranchName();
	const demoPostContent = getPlaygroundDemoPostContent();

	fs.writeFileSync( DEMO_POST_CONTENT, `${ demoPostContent }\n` );
	const githubBlueprint = hydrateTemplate( GITHUB_TEMPLATE, {
		LANDING_PAGE: DEFAULT_LANDING_PAGE,
		PHP_VERSION: DEFAULT_PHP_VERSION,
		PLUGIN_ZIP_URL:
			getArgValue( '--plugin-zip-url' ) ??
			getRawGithubZipUrl( repositorySlug, branch ),
		RUN_PHP_CODE: buildRunPhpCode( demoPostContent ),
		WP_VERSION: DEFAULT_WP_VERSION,
	} );
	const wordpressOrgBlueprint = hydrateTemplate( WORDPRESS_ORG_TEMPLATE, {
		LANDING_PAGE: DEFAULT_LANDING_PAGE,
		PHP_VERSION: DEFAULT_PHP_VERSION,
		RUN_PHP_CODE: buildRunPhpCode( demoPostContent ),
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
	const branch = getBranchName();
	const githubBlueprint = hydrateTemplate( GITHUB_TEMPLATE, {
		LANDING_PAGE: DEFAULT_LANDING_PAGE,
		PHP_VERSION: DEFAULT_PHP_VERSION,
		PLUGIN_ZIP_URL:
			getArgValue( '--plugin-zip-url' ) ??
			getRawGithubZipUrl( repositorySlug, branch ),
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
