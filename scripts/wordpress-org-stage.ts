/* eslint-disable no-console */
import {
	DEFAULT_STAGE_ROOT,
	getArgValue,
	stageWordPressOrgLayout,
} from './wordpress-org-utils';

function main() {
	const targetRoot = getArgValue( '--target' ) ?? DEFAULT_STAGE_ROOT;
	const staged = stageWordPressOrgLayout( targetRoot );

	console.log(
		`✅ Staged WordPress.org payload for ${ staged.version } at ${ staged.targetRoot }`
	);
	console.log( `   trunk: ${ staged.trunkDir }` );
	console.log( `   tag:   ${ staged.tagDir }` );
	console.log( `   assets:${ staged.assetsDir }` );
}

main();
