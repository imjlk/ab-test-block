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
$context     = array(
	'automaticMetric'              => (string) $attributes['automaticMetric'],
	'blockInstanceId'              => (string) $attributes['blockInstanceId'],
	'emitBrowserEvents'            => ! empty( $attributes['emitBrowserEvents'] ),
	'emitClarityHook'              => ! empty( $attributes['emitClarityHook'] ),
	'emitDataLayer'                => ! empty( $attributes['emitDataLayer'] ),
	'emitKexpLayer'                => ! empty( $attributes['emitKexpLayer'] ),
	'evaluationWindowDays'         => (int) $attributes['evaluationWindowDays'],
	'experimentId'                 => (string) $attributes['experimentId'],
	'lockWinnerAfterSelection'     => ! empty( $attributes['lockWinnerAfterSelection'] ),
	'minimumClicksPerVariant'      => (int) $attributes['minimumClicksPerVariant'],
	'minimumImpressionsPerVariant' => (int) $attributes['minimumImpressionsPerVariant'],
	'postId'                       => $post_id,
	'previewQueryKey'              => (string) $attributes['previewQueryKey'],
	'stickyAssignment'             => ! empty( $attributes['stickyAssignment'] ),
	'stickyStorageKey'             => sprintf(
		'abtest:%d:%s',
		$post_id,
		(string) $attributes['blockInstanceId']
	),
	'trackClicks'                  => ! empty( $attributes['trackClicks'] ),
	'trackImpressions'             => ! empty( $attributes['trackImpressions'] ),
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

if ( $post_id > 0 && function_exists( 'ab_test_block_create_public_write_token' ) ) {
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
		'data-wp-context'      => wp_json_encode( $context ),
		'data-wp-interactive'  => 'abtest-block',
		'data-wp-init'         => 'callbacks.init',
		'data-wp-run--mounted' => 'callbacks.mounted',
	)
);
?>

<section <?php echo $wrapper_attributes; ?>>
	<p
		class="wp-block-abtest-block-test__runtime-label"
		data-wp-bind--hidden="!state.debugLabel"
		data-wp-text="state.debugLabel"
		hidden
	></p>
	<p
		class="wp-block-abtest-block-test__runtime-error"
		data-wp-bind--hidden="!state.error"
		data-wp-text="state.error"
		hidden
	></p>
	<div class="wp-block-abtest-block-test__runtime-variants">
		<?php echo $content; ?>
	</div>
</section>
