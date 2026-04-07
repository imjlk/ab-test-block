<?php
/**
 * Dynamic render entry for the A/B Test parent block.
 *
 * @package AbTestBlock
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$attributes  = is_array( $attributes ) ? $attributes : array();
$attributes  = function_exists( 'ab_test_block_sanitize_experiment_attributes' )
	? ab_test_block_sanitize_experiment_attributes( $attributes )
	: $attributes;
$post_id     = is_object( $block ) && isset( $block->context['postId'] )
	? (int) $block->context['postId']
	: (int) get_queried_object_id();
$winner_data = function_exists( 'ab_test_block_get_winner_state' )
	? ab_test_block_get_winner_state(
		$post_id,
		(string) $attributes['blockInstanceId'],
		(int) $attributes['variantCount']
	)
	: array(
		'metric'     => 'ctr',
		'status'     => 'no-winner',
		'variants'   => array(),
		'windowDays' => (int) $attributes['evaluationWindowDays'],
	);
$tracking_enabled = function_exists( 'ab_test_block_is_tracking_enabled' )
	? ab_test_block_is_tracking_enabled()
	: true;
$resolved_assignment = function_exists( 'ab_test_block_resolve_front_assignment' )
	? ab_test_block_resolve_front_assignment( $attributes, $post_id, $winner_data )
	: array(
		'preview' => false,
		'source'  => 'weighted-random',
		'variant' => 'a',
	);
$front_render_mode = isset( $attributes['frontRenderMode'] ) ? (string) $attributes['frontRenderMode'] : 'dom-prune';
$sticky_cookie_name = function_exists( 'ab_test_block_get_sticky_cookie_name' )
	? ab_test_block_get_sticky_cookie_name(
		$post_id,
		(string) $attributes['blockInstanceId'],
		(string) $attributes['experimentId'],
		(string) $attributes['stickyScope']
	)
	: '';
$sticky_storage_key = function_exists( 'ab_test_block_get_sticky_storage_key' )
	? ab_test_block_get_sticky_storage_key(
		$post_id,
		(string) $attributes['blockInstanceId'],
		(string) $attributes['experimentId'],
		(string) $attributes['stickyScope']
	)
	: '';
$runtime_label = ! empty( $attributes['showRuntimeLabel'] ) && function_exists( 'ab_test_block_format_runtime_label' )
	? ab_test_block_format_runtime_label(
		(string) $attributes['experimentId'],
		(string) $resolved_assignment['variant'],
		(string) $resolved_assignment['source']
	)
	: '';
$context     = array(
	'automaticMetric'              => (string) $attributes['automaticMetric'],
	'blockInstanceId'              => (string) $attributes['blockInstanceId'],
	'emitBrowserEvents'            => $tracking_enabled && ! empty( $attributes['emitBrowserEvents'] ),
	'emitClarityHook'              => $tracking_enabled && ! empty( $attributes['emitClarityHook'] ),
	'emitDataLayer'                => $tracking_enabled && ! empty( $attributes['emitDataLayer'] ),
	'emitKexpLayer'                => $tracking_enabled && ! empty( $attributes['emitKexpLayer'] ),
	'evaluationWindowDays'         => (int) $attributes['evaluationWindowDays'],
	'experimentId'                 => (string) $attributes['experimentId'],
	'frontRenderMode'              => $front_render_mode,
	'isPreview'                    => ! empty( $resolved_assignment['preview'] ),
	'lockWinnerAfterSelection'     => ! empty( $attributes['lockWinnerAfterSelection'] ),
	'minimumClicksPerVariant'      => (int) $attributes['minimumClicksPerVariant'],
	'minimumImpressionsPerVariant' => (int) $attributes['minimumImpressionsPerVariant'],
	'postId'                       => $post_id,
	'previewQueryKey'              => (string) $attributes['previewQueryKey'],
	'resolvedSource'               => (string) $resolved_assignment['source'],
	'resolvedVariant'              => (string) $resolved_assignment['variant'],
	'showRuntimeLabel'             => ! empty( $attributes['showRuntimeLabel'] ),
	'stickyAssignment'             => ! empty( $attributes['stickyAssignment'] ),
	'stickyCookieName'             => $sticky_cookie_name,
	'stickyCookieTtlDays'          => function_exists( 'ab_test_block_get_sticky_cookie_ttl_days' )
		? (int) ab_test_block_get_sticky_cookie_ttl_days()
		: 30,
	'stickyScope'                  => (string) $attributes['stickyScope'],
	'stickyStorageKey'             => $sticky_storage_key,
	'trackClicks'                  => $tracking_enabled && ! empty( $attributes['trackClicks'] ),
	'trackImpressions'             => $tracking_enabled && ! empty( $attributes['trackImpressions'] ),
	'variantCount'                 => (int) $attributes['variantCount'],
	'variantKeys'                  => function_exists( 'ab_test_block_variant_keys' )
		? ab_test_block_variant_keys( (int) $attributes['variantCount'] )
		: array( 'a', 'b' ),
	'weights'                      => $attributes['weights'],
	'winnerEvaluation'             => function_exists( 'ab_test_block_prepare_winner_state_for_context' )
		? ab_test_block_prepare_winner_state_for_context(
			$winner_data,
			(int) $attributes['variantCount'],
			(int) $attributes['evaluationWindowDays']
		)
		: $winner_data,
	'winnerMode'                   => (string) $attributes['winnerMode'],
);

if ( ! empty( $attributes['manualWinner'] ) ) {
	$context['manualWinner'] = (string) $attributes['manualWinner'];
}

if ( $tracking_enabled && $post_id > 0 && function_exists( 'ab_test_block_create_public_write_token' ) ) {
	$public_write = ab_test_block_create_public_write_token(
		$post_id,
		(string) $attributes['blockInstanceId'],
		(string) $attributes['experimentId']
	);
	if ( is_array( $public_write ) ) {
		if ( ! empty( $public_write['token'] ) ) {
			$context['publicWriteToken'] = (string) $public_write['token'];
		}
		if ( ! empty( $public_write['expiresAt'] ) ) {
			$context['publicWriteExpiresAt'] = (int) $public_write['expiresAt'];
		}
	}
}

$rendered_variants = $content;

if ( 'dom-prune' === $front_render_mode && is_object( $block ) && ! empty( $resolved_assignment['variant'] ) ) {
	$parsed_inner_blocks = isset( $block->parsed_block['innerBlocks'] ) && is_array( $block->parsed_block['innerBlocks'] )
		? $block->parsed_block['innerBlocks']
		: array();

	foreach ( $parsed_inner_blocks as $inner_block ) {
		$variant_key = isset( $inner_block['attrs']['variantKey'] ) ? (string) $inner_block['attrs']['variantKey'] : '';

		if ( $variant_key !== (string) $resolved_assignment['variant'] ) {
			continue;
		}

		$rendered_variants = render_block( $inner_block );
		break;
	}
}

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'data-abtest-front-render-mode' => $front_render_mode,
		'data-wp-context'            => wp_json_encode( $context ),
		'data-wp-interactive'        => 'abtest-block',
		'data-wp-init'               => 'callbacks.init',
		'data-wp-init---mounted'     => 'callbacks.mounted',
	)
);
?>

<section <?php echo $wrapper_attributes; ?>>
	<p
		class="wp-block-abtest-block-test__runtime-label"
		<?php echo '' === $runtime_label ? 'hidden' : ''; ?>
	><?php echo esc_html( $runtime_label ); ?></p>
	<p
		class="wp-block-abtest-block-test__runtime-error"
		data-wp-bind--hidden="!state.error"
		data-wp-text="state.error"
		hidden
	></p>
	<div class="wp-block-abtest-block-test__runtime-variants">
		<?php echo $rendered_variants; ?>
	</div>
</section>
