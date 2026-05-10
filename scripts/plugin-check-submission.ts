/* eslint-disable no-console */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
	DEFAULT_STAGE_ROOT,
	PLUGIN_SLUG,
	stageWordPressOrgLayout,
} from './wordpress-org-utils';

const REPO_ROOT = process.cwd();
const WP_ENV_BIN = path.join( REPO_ROOT, 'node_modules', '.bin', 'wp-env' );

function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string; input?: string } = {}
) {
	execFileSync( command, args, {
		cwd: options.cwd,
		input: options.input,
		stdio: [ 'pipe', 'inherit', 'inherit' ],
	} );
}

function getAvailablePort() {
	return new Promise< number >( ( resolve, reject ) => {
		const server = net.createServer();

		server.unref();
		server.on( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			const address = server.address();

			if ( ! address || typeof address === 'string' ) {
				server.close();
				reject(
					new Error( 'Unable to resolve an available local port.' )
				);
				return;
			}

			const { port } = address;
			server.close( ( closeError ) => {
				if ( closeError ) {
					reject( closeError );
					return;
				}

				resolve( port );
			} );
		} );
	} );
}

async function getDistinctAvailablePorts( count: number ) {
	const ports = new Set< number >();

	while ( ports.size < count ) {
		ports.add( await getAvailablePort() );
	}

	return [ ...ports ];
}

async function main() {
	runCommand( 'bun', [ 'run', 'plugin-zip' ] );
	const staged = stageWordPressOrgLayout( DEFAULT_STAGE_ROOT );
	const tempRoot = fs.mkdtempSync(
		path.join( os.tmpdir(), 'ab-test-block-plugin-check-' )
	);
	const pluginRoot = path.join( tempRoot, 'plugins', PLUGIN_SLUG );
	const wpEnvRoot = path.join( tempRoot, 'submission-env' );

	fs.mkdirSync( pluginRoot, { recursive: true } );
	fs.cpSync( staged.trunkDir, pluginRoot, { recursive: true } );
	fs.mkdirSync( wpEnvRoot, { recursive: true } );

	const [ port, testsPort ] = await getDistinctAvailablePorts( 2 );

	fs.writeFileSync(
		path.join( wpEnvRoot, '.wp-env.json' ),
		`${ JSON.stringify(
			{
				$schema: 'https://schemas.wp.org/trunk/wp-env.json',
				config: {
					SCRIPT_DEBUG: true,
					WP_DEBUG: true,
				},
				core: 'WordPress/WordPress#6.9',
				plugins: [ '../plugins/ab-test-block' ],
				port,
				testsPort,
			},
			null,
			'\t'
		) }\n`
	);

	try {
		runCommand( WP_ENV_BIN, [ 'start' ], { cwd: wpEnvRoot } );
		runCommand(
			WP_ENV_BIN,
			[
				'run',
				'cli',
				'wp',
				'plugin',
				'install',
				'plugin-check',
				'--activate',
			],
			{ cwd: wpEnvRoot }
		);
		runCommand(
			WP_ENV_BIN,
			[
				'run',
				'cli',
				'wp',
				'plugin',
				'check',
				PLUGIN_SLUG,
				'--require=/var/www/html/wp-content/plugins/plugin-check/cli.php',
			],
			{ cwd: wpEnvRoot }
		);
	} finally {
		try {
			runCommand( WP_ENV_BIN, [ 'stop' ], { cwd: wpEnvRoot } );
		} catch ( error ) {
			console.warn(
				'Warning: failed to stop temporary wp-env cleanly.',
				error
			);
		}

		fs.rmSync( tempRoot, { force: true, recursive: true } );
	}
}

main().catch( ( error ) => {
	console.error( '❌ Submission plugin check failed:', error );
	process.exit( 1 );
} );
