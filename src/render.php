<?php
/**
 * Dynamic render entry for the Ab Test Block block.
 *
 * @package AbTestBlock
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$validator_path = __DIR__ . '/typia-validator.php';
if ( ! file_exists( $validator_path ) ) {
	return '';
}

$validator = require $validator_path;
if ( ! is_object( $validator ) || ! method_exists( $validator, 'apply_defaults' ) || ! method_exists( $validator, 'validate' ) ) {
	return '';
}

$normalized  = $validator->apply_defaults( is_array( $attributes ) ? $attributes : array() );
$validation  = $validator->validate( $normalized );
$resourceKey = isset( $normalized['resourceKey'] ) ? (string) $normalized['resourceKey'] : '';

if ( empty( $validation['valid'] ) || '' === $resourceKey ) {
	return '';
}

$alignment          = isset( $normalized['alignment'] ) ? (string) $normalized['alignment'] : 'left';
$button_label       = isset( $normalized['buttonLabel'] ) ? (string) $normalized['buttonLabel'] : 'Persist Count';
$content            = isset( $normalized['content'] ) ? (string) $normalized['content'] : '';
$post_id            = is_object( $block ) && isset( $block->context['postId'] )
	? (int) $block->context['postId']
	: (int) get_queried_object_id();
$storage_mode       = 'custom-table';
$persistence_policy = 'public';
$can_write          = false;
$notice_message     = 'authenticated' === $persistence_policy
	? __( 'Sign in to persist this counter.', 'ab-test-block' )
	: __( 'Reload the page to refresh this write token.', 'ab-test-block' );
$context            = array(
	'buttonLabel'       => $button_label,
	'canWrite'          => false,
	'count'             => 0,
	'isVisible'         => ! empty( $normalized['isVisible'] ),
	'persistencePolicy' => $persistence_policy,
	'postId'            => (int) $post_id,
	'resourceKey'       => $resourceKey,
	'storage'           => $storage_mode,
);

if ( 'authenticated' === $persistence_policy ) {
	$can_write = $post_id > 0 && is_user_logged_in();
	if ( $can_write ) {
		$context['restNonce'] = wp_create_nonce( 'wp_rest' );
	}
} elseif ( $post_id > 0 && function_exists( 'ab_test_block_create_public_write_token' ) ) {
	$public_write = ab_test_block_create_public_write_token( (int) $post_id, $resourceKey );
	if ( is_array( $public_write ) ) {
		$token      = isset( $public_write['token'] ) ? (string) $public_write['token'] : '';
		$expires_at = isset( $public_write['expiresAt'] ) ? (int) $public_write['expiresAt'] : 0;

		if ( '' !== $token ) {
			$context['publicWriteToken'] = $token;
			$can_write                   = true;
		}

		if ( $expires_at > 0 ) {
			$context['publicWriteExpiresAt'] = $expires_at;
		}
	}
}

$context['canWrite'] = $can_write;

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'data-wp-context'       => wp_json_encode( $context ),
		'data-wp-interactive'   => 'ab-test-block',
		'data-wp-init'          => 'callbacks.init',
		'data-wp-run--mounted' => 'callbacks.mounted',
	)
);
?>

<div <?php echo $wrapper_attributes; ?>>
	<div class="wp-block-ab-test-block-frontend">
		<p class="wp-block-ab-test-block-frontend__content" style="<?php echo esc_attr( 'text-align:' . $alignment ); ?>">
			<?php echo esc_html( $content ); ?>
		</p>
		<?php if ( ! $can_write ) : ?>
			<p class="wp-block-ab-test-block-frontend__notice">
				<?php echo esc_html( $notice_message ); ?>
			</p>
		<?php endif; ?>
		<p
			class="wp-block-ab-test-block-frontend__error"
			data-wp-bind--hidden="!state.error"
			data-wp-text="state.error"
			hidden
		></p>
		<?php if ( ! empty( $normalized['showCount'] ) ) : ?>
			<span class="wp-block-ab-test-block-frontend__count" data-wp-text="state.count">
				0
			</span>
		<?php endif; ?>
		<button
			type="button"
			<?php echo $can_write ? '' : 'disabled'; ?>
			data-wp-bind--disabled="!context.canWrite"
			data-wp-on--click="actions.increment"
		>
			<?php echo esc_html( $button_label ); ?>
		</button>
	</div>
</div>
