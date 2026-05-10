<?php
/**
 * Dynamic render entry for the A/B Test parent block.
 *
 * @package AbTestBlock
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$ab_test_block_attributes  = is_array( $attributes ) ? $attributes : array();
$ab_test_block_attributes  = function_exists( 'ab_test_block_sanitize_experiment_attributes' )
	? ab_test_block_sanitize_experiment_attributes( $ab_test_block_attributes )
	: $ab_test_block_attributes;
$ab_test_block_post_id     = is_object( $block ) && isset( $block->context['postId'] )
	? (int) $block->context['postId']
	: (int) get_queried_object_id();
$ab_test_block_winner_data = function_exists( 'ab_test_block_get_winner_state' )
	? ab_test_block_get_winner_state(
		$ab_test_block_post_id,
		(string) $ab_test_block_attributes['blockInstanceId'],
		(int) $ab_test_block_attributes['variantCount']
	)
	: array(
		'metric'     => 'ctr',
		'reasonCode' => 'insufficient-data',
		'status'     => 'no-winner',
		'variants'   => array(),
		'windowDays' => (int) $ab_test_block_attributes['evaluationWindowDays'],
	);
$ab_test_block_tracking_enabled = function_exists( 'ab_test_block_is_tracking_enabled' )
	? ab_test_block_is_tracking_enabled()
	: true;
$ab_test_block_resolved_assignment = function_exists( 'ab_test_block_resolve_front_assignment' )
	? ab_test_block_resolve_front_assignment( $ab_test_block_attributes, $ab_test_block_post_id, $ab_test_block_winner_data )
	: array(
		'preview' => false,
		'source'  => 'weighted-random',
		'variant' => 'a',
	);
$ab_test_block_front_render_mode = isset( $ab_test_block_attributes['frontRenderMode'] ) ? (string) $ab_test_block_attributes['frontRenderMode'] : 'dom-prune';
$ab_test_block_rendered_variants = $content;
$ab_test_block_render_error      = '';
$ab_test_block_has_rendered_variant = true;

if ( 'dom-prune' === $ab_test_block_front_render_mode && is_object( $block ) ) {
	$ab_test_block_parsed_inner_blocks = isset( $block->parsed_block['innerBlocks'] ) && is_array( $block->parsed_block['innerBlocks'] )
		? $block->parsed_block['innerBlocks']
		: array();
	$ab_test_block_pruned_result = function_exists( 'ab_test_block_render_pruned_variant' )
		? ab_test_block_render_pruned_variant(
			$ab_test_block_parsed_inner_blocks,
			(string) $ab_test_block_resolved_assignment['variant'],
			(int) $ab_test_block_attributes['variantCount']
		)
		: null;

	if ( is_array( $ab_test_block_pruned_result ) ) {
		$ab_test_block_rendered_variants = isset( $ab_test_block_pruned_result['html'] ) ? (string) $ab_test_block_pruned_result['html'] : '';
		$ab_test_block_render_error      = isset( $ab_test_block_pruned_result['error'] ) ? (string) $ab_test_block_pruned_result['error'] : '';
		$ab_test_block_has_rendered_variant = ! empty( $ab_test_block_pruned_result['variant'] ) && '' !== $ab_test_block_rendered_variants;

		if ( ! empty( $ab_test_block_pruned_result['variant'] ) ) {
			$ab_test_block_resolved_assignment['variant'] = (string) $ab_test_block_pruned_result['variant'];
		}
	}
}

$ab_test_block_sticky_cookie_name = function_exists( 'ab_test_block_get_sticky_cookie_name' )
	? ab_test_block_get_sticky_cookie_name(
		$ab_test_block_post_id,
		(string) $ab_test_block_attributes['blockInstanceId'],
		(string) $ab_test_block_attributes['experimentId'],
		(string) $ab_test_block_attributes['stickyScope']
	)
	: '';
$ab_test_block_sticky_storage_key = function_exists( 'ab_test_block_get_sticky_storage_key' )
	? ab_test_block_get_sticky_storage_key(
		$ab_test_block_post_id,
		(string) $ab_test_block_attributes['blockInstanceId'],
		(string) $ab_test_block_attributes['experimentId'],
		(string) $ab_test_block_attributes['stickyScope']
	)
	: '';
$ab_test_block_runtime_label = ! empty( $ab_test_block_attributes['showRuntimeLabel'] ) && function_exists( 'ab_test_block_format_runtime_label' )
	? ab_test_block_format_runtime_label(
		(string) $ab_test_block_attributes['experimentId'],
		(string) $ab_test_block_resolved_assignment['variant'],
		(string) $ab_test_block_resolved_assignment['source']
	)
	: '';
$ab_test_block_context     = array(
	'automaticMetric'              => (string) $ab_test_block_attributes['automaticMetric'],
	'blockInstanceId'              => (string) $ab_test_block_attributes['blockInstanceId'],
	'emitBrowserEvents'            => $ab_test_block_tracking_enabled && ! empty( $ab_test_block_attributes['emitBrowserEvents'] ),
	'emitClarityHook'              => $ab_test_block_tracking_enabled && ! empty( $ab_test_block_attributes['emitClarityHook'] ),
	'emitDataLayer'                => $ab_test_block_tracking_enabled && ! empty( $ab_test_block_attributes['emitDataLayer'] ),
	'emitKexpLayer'                => $ab_test_block_tracking_enabled && ! empty( $ab_test_block_attributes['emitKexpLayer'] ),
	'evaluationWindowDays'         => (int) $ab_test_block_attributes['evaluationWindowDays'],
	'experimentId'                 => (string) $ab_test_block_attributes['experimentId'],
	'frontRenderMode'              => $ab_test_block_front_render_mode,
	'isPreview'                    => ! empty( $ab_test_block_resolved_assignment['preview'] ),
	'lockWinnerAfterSelection'     => ! empty( $ab_test_block_attributes['lockWinnerAfterSelection'] ),
	'minimumClicksPerVariant'      => (int) $ab_test_block_attributes['minimumClicksPerVariant'],
	'minimumImpressionsPerVariant' => (int) $ab_test_block_attributes['minimumImpressionsPerVariant'],
	'postId'                       => $ab_test_block_post_id,
	'previewQueryKey'              => (string) $ab_test_block_attributes['previewQueryKey'],
	'resolvedSource'               => (string) $ab_test_block_resolved_assignment['source'],
	'resolvedVariant'              => (string) $ab_test_block_resolved_assignment['variant'],
	'showRuntimeLabel'             => ! empty( $ab_test_block_attributes['showRuntimeLabel'] ),
	'stickyAssignment'             => ! empty( $ab_test_block_attributes['stickyAssignment'] ),
	'stickyCookieName'             => $ab_test_block_sticky_cookie_name,
	'stickyCookieTtlDays'          => function_exists( 'ab_test_block_get_sticky_cookie_ttl_days' )
		? (int) ab_test_block_get_sticky_cookie_ttl_days()
		: 30,
	'stickyScope'                  => (string) $ab_test_block_attributes['stickyScope'],
	'stickyStorageKey'             => $ab_test_block_sticky_storage_key,
	'trackClicks'                  => $ab_test_block_tracking_enabled && $ab_test_block_has_rendered_variant && ! empty( $ab_test_block_attributes['trackClicks'] ),
	'trackImpressions'             => $ab_test_block_tracking_enabled && $ab_test_block_has_rendered_variant && ! empty( $ab_test_block_attributes['trackImpressions'] ),
	'variantCount'                 => (int) $ab_test_block_attributes['variantCount'],
	'variantKeys'                  => function_exists( 'ab_test_block_variant_keys' )
		? ab_test_block_variant_keys( (int) $ab_test_block_attributes['variantCount'] )
		: array( 'a', 'b' ),
	'weights'                      => $ab_test_block_attributes['weights'],
	'winnerEvaluation'             => function_exists( 'ab_test_block_prepare_winner_state_for_context' )
		? ab_test_block_prepare_winner_state_for_context(
			$ab_test_block_winner_data,
			(int) $ab_test_block_attributes['variantCount'],
			(int) $ab_test_block_attributes['evaluationWindowDays']
		)
		: $ab_test_block_winner_data,
	'winnerMode'                   => (string) $ab_test_block_attributes['winnerMode'],
);

if ( '' !== $ab_test_block_render_error ) {
	$ab_test_block_context['initialError'] = $ab_test_block_render_error;
}

if ( ! empty( $ab_test_block_attributes['manualWinner'] ) ) {
	$ab_test_block_context['manualWinner'] = (string) $ab_test_block_attributes['manualWinner'];
}

if ( $ab_test_block_tracking_enabled && $ab_test_block_has_rendered_variant && $ab_test_block_post_id > 0 && function_exists( 'ab_test_block_create_public_write_token' ) ) {
	$ab_test_block_public_write = ab_test_block_create_public_write_token(
		$ab_test_block_post_id,
		(string) $ab_test_block_attributes['blockInstanceId'],
		(string) $ab_test_block_attributes['experimentId']
	);
	if ( is_array( $ab_test_block_public_write ) ) {
		if ( ! empty( $ab_test_block_public_write['token'] ) ) {
			$ab_test_block_context['publicWriteToken'] = (string) $ab_test_block_public_write['token'];
		}
		if ( ! empty( $ab_test_block_public_write['expiresAt'] ) ) {
			$ab_test_block_context['publicWriteExpiresAt'] = (int) $ab_test_block_public_write['expiresAt'];
		}
	}
}

$ab_test_block_wrapper_attributes = get_block_wrapper_attributes(
	array(
		'data-abtest-front-render-mode' => $ab_test_block_front_render_mode,
		'data-wp-context'            => wp_json_encode( $ab_test_block_context ),
		'data-wp-interactive'        => 'abtest-block',
		'data-wp-init'               => 'callbacks.init',
		'data-wp-init---mounted'     => 'callbacks.mounted',
	)
);
?>

<section
	<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- get_block_wrapper_attributes() returns a safe attribute string.
	echo $ab_test_block_wrapper_attributes;
	?>
>
	<p
		class="wp-block-abtest-block-test__runtime-label"
		<?php echo '' === $ab_test_block_runtime_label ? 'hidden' : ''; ?>
	><?php echo esc_html( $ab_test_block_runtime_label ); ?></p>
	<p
		class="wp-block-abtest-block-test__runtime-error"
		data-wp-bind--hidden="!state.error"
		data-wp-text="state.error"
		hidden
	></p>
	<div class="wp-block-abtest-block-test__runtime-variants">
		<?php
		// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Variant HTML is rendered from trusted parsed block content.
		echo $ab_test_block_rendered_variants;
		?>
	</div>
</section>
