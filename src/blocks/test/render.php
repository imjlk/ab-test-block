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
		'reasonCode' => 'insufficient-data',
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
$rendered_variants = $content;
$render_error      = '';
$has_rendered_variant = true;

if ( 'dom-prune' === $front_render_mode && is_object( $block ) ) {
	$parsed_inner_blocks = isset( $block->parsed_block['innerBlocks'] ) && is_array( $block->parsed_block['innerBlocks'] )
		? $block->parsed_block['innerBlocks']
		: array();
	$pruned_result = function_exists( 'ab_test_block_render_pruned_variant' )
		? ab_test_block_render_pruned_variant(
			$parsed_inner_blocks,
			(string) $resolved_assignment['variant'],
			(int) $attributes['variantCount']
		)
		: null;

	if ( is_array( $pruned_result ) ) {
		$rendered_variants = isset( $pruned_result['html'] ) ? (string) $pruned_result['html'] : '';
		$render_error      = isset( $pruned_result['error'] ) ? (string) $pruned_result['error'] : '';
		$has_rendered_variant = ! empty( $pruned_result['variant'] ) && '' !== $rendered_variants;

		if ( ! empty( $pruned_result['variant'] ) ) {
			$resolved_assignment['variant'] = (string) $pruned_result['variant'];
		}
	}
}

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
	'trackClicks'                  => $tracking_enabled && $has_rendered_variant && ! empty( $attributes['trackClicks'] ),
	'trackImpressions'             => $tracking_enabled && $has_rendered_variant && ! empty( $attributes['trackImpressions'] ),
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

if ( '' !== $render_error ) {
	$context['initialError'] = $render_error;
}

if ( ! empty( $attributes['manualWinner'] ) ) {
	$context['manualWinner'] = (string) $attributes['manualWinner'];
}

if ( $tracking_enabled && $has_rendered_variant && $post_id > 0 && function_exists( 'ab_test_block_create_public_write_token' ) ) {
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

<section
	<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- get_block_wrapper_attributes() returns a safe attribute string.
	echo $wrapper_attributes;
	?>
>
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
		<?php
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Variant HTML is rendered from trusted parsed block content.
		echo $rendered_variants;
		?>
	</div>
</section>
