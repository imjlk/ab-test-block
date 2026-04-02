<?php
/**
 * Plugin Name:       A/B Test Block
 * Description:       Block Directory-ready A/B and A/B/C experiment block with weighted delivery and winner selection.
 * Version:           0.3.1
 * Requires at least: 6.7
 * Requires PHP:      7.4
 * Author:            imjlk
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       ab-test-block
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AB_TEST_BLOCK_STORAGE_VERSION', '2.0.0' );
define( 'AB_TEST_BLOCK_PUBLIC_WRITE_TTL', HOUR_IN_SECONDS );
define( 'AB_TEST_BLOCK_WINNER_META_KEY', '_ab_test_block_winner_state' );

function ab_test_block_get_block_build_dir( $relative_path ) {
	$candidates = array(
		__DIR__ . '/build/' . $relative_path,
		__DIR__ . '/build/blocks/' . $relative_path,
	);

	foreach ( $candidates as $candidate ) {
		if ( file_exists( trailingslashit( $candidate ) . 'block.json' ) ) {
			return $candidate;
		}
	}

	return null;
}

function ab_test_block_get_api_schema_dir() {
	$candidates = array(
		__DIR__ . '/build/api-schemas',
		__DIR__ . '/build/blocks/api-schemas',
	);

	foreach ( $candidates as $candidate ) {
		if ( is_dir( $candidate ) ) {
			return $candidate;
		}
	}

	return null;
}

function ab_test_block_get_stats_table_name() {
	global $wpdb;

	return $wpdb->prefix . 'abtest_block_stats';
}

function ab_test_block_variant_keys( $variant_count ) {
	return 3 === (int) $variant_count ? array( 'a', 'b', 'c' ) : array( 'a', 'b' );
}

function ab_test_block_get_default_weights( $variant_count ) {
	return 3 === (int) $variant_count
		? array(
			'a' => 34,
			'b' => 33,
			'c' => 33,
		)
		: array(
			'a' => 50,
			'b' => 50,
		);
}

function ab_test_block_clamp_weight( $value ) {
	return max( 0, min( 100, (int) round( (float) $value ) ) );
}

function ab_test_block_sanitize_weights( $weights, $variant_count ) {
	$sanitized = ab_test_block_get_default_weights( $variant_count );

	if ( ! is_array( $weights ) ) {
		return $sanitized;
	}

	foreach ( ab_test_block_variant_keys( $variant_count ) as $variant_key ) {
		if ( array_key_exists( $variant_key, $weights ) ) {
			$sanitized[ $variant_key ] = ab_test_block_clamp_weight( $weights[ $variant_key ] );
		}
	}

	return $sanitized;
}

function ab_test_block_generate_block_instance_id() {
	return strtolower( wp_generate_password( 16, false, false ) );
}

function ab_test_block_generate_experiment_id( $block_instance_id ) {
	return 'experiment_' . substr( sanitize_key( $block_instance_id ), 0, 8 );
}

function ab_test_block_generate_experiment_label() {
	return 'Experiment';
}

function ab_test_block_sanitize_variant_key( $variant_key, $variant_count ) {
	$variant_key = is_string( $variant_key ) ? strtolower( trim( $variant_key ) ) : '';

	return in_array( $variant_key, ab_test_block_variant_keys( $variant_count ), true )
		? $variant_key
		: null;
}

function ab_test_block_sanitize_experiment_attributes( $attributes ) {
	$attributes        = is_array( $attributes ) ? $attributes : array();
	$variant_count     = 3 === (int) ( $attributes['variantCount'] ?? 2 ) ? 3 : 2;
	$block_instance_id = isset( $attributes['blockInstanceId'] ) ? sanitize_key( (string) $attributes['blockInstanceId'] ) : '';
	$block_instance_id = strlen( $block_instance_id ) >= 8 ? $block_instance_id : ab_test_block_generate_block_instance_id();
	$experiment_id     = isset( $attributes['experimentId'] ) ? sanitize_key( (string) $attributes['experimentId'] ) : '';
	$experiment_id     = ( '' !== $experiment_id && 'experiment' !== $experiment_id )
		? $experiment_id
		: ab_test_block_generate_experiment_id( $block_instance_id );
	$experiment_label  = isset( $attributes['experimentLabel'] ) ? sanitize_text_field( (string) $attributes['experimentLabel'] ) : '';
	$experiment_label  = '' !== $experiment_label ? substr( $experiment_label, 0, 120 ) : ab_test_block_generate_experiment_label();
	$preview_query_key = isset( $attributes['previewQueryKey'] ) ? sanitize_key( (string) $attributes['previewQueryKey'] ) : '';
	$preview_query_key = '' !== $preview_query_key ? $preview_query_key : 'ab_' . $experiment_id;
	$sticky_scope      = isset( $attributes['stickyScope'] ) ? (string) $attributes['stickyScope'] : 'instance';
	$sticky_scope      = in_array( $sticky_scope, array( 'instance', 'experiment' ), true ) ? $sticky_scope : 'instance';
	$winner_mode       = isset( $attributes['winnerMode'] ) ? (string) $attributes['winnerMode'] : 'off';
	$winner_mode       = in_array( $winner_mode, array( 'off', 'manual', 'automatic' ), true ) ? $winner_mode : 'off';
	$manual_winner     = ab_test_block_sanitize_variant_key( $attributes['manualWinner'] ?? null, $variant_count );
	$variant_keys      = ab_test_block_variant_keys( $variant_count );
	$fallback_winner   = $variant_keys[0];

	return array(
		'automaticMetric'              => 'ctr',
		'blockInstanceId'              => $block_instance_id,
		'emitBrowserEvents'            => ! empty( $attributes['emitBrowserEvents'] ),
		'emitClarityHook'              => ! empty( $attributes['emitClarityHook'] ),
		'emitDataLayer'                => ! empty( $attributes['emitDataLayer'] ),
		'emitKexpLayer'                => ! empty( $attributes['emitKexpLayer'] ),
		'evaluationWindowDays'         => max( 1, min( 365, (int) ( $attributes['evaluationWindowDays'] ?? 14 ) ) ),
		'experimentId'                 => $experiment_id,
		'experimentLabel'              => $experiment_label,
		'lockWinnerAfterSelection'     => ! empty( $attributes['lockWinnerAfterSelection'] ),
		'manualWinner'                 => 'manual' === $winner_mode ? ( $manual_winner ?: $fallback_winner ) : null,
		'minimumClicksPerVariant'      => max( 0, (int) ( $attributes['minimumClicksPerVariant'] ?? 1 ) ),
		'minimumImpressionsPerVariant' => max( 0, (int) ( $attributes['minimumImpressionsPerVariant'] ?? 100 ) ),
		'previewQueryKey'              => $preview_query_key,
		'stickyAssignment'             => array_key_exists( 'stickyAssignment', $attributes ) ? ! empty( $attributes['stickyAssignment'] ) : true,
		'stickyScope'                  => $sticky_scope,
		'trackClicks'                  => array_key_exists( 'trackClicks', $attributes ) ? ! empty( $attributes['trackClicks'] ) : true,
		'trackImpressions'             => array_key_exists( 'trackImpressions', $attributes ) ? ! empty( $attributes['trackImpressions'] ) : true,
		'variantCount'                 => $variant_count,
		'weights'                      => ab_test_block_sanitize_weights( $attributes['weights'] ?? null, $variant_count ),
		'winnerMode'                   => $winner_mode,
	);
}

function ab_test_block_is_tracking_enabled() {
	if ( defined( 'AB_TEST_BLOCK_DISABLE_TRACKING' ) && AB_TEST_BLOCK_DISABLE_TRACKING ) {
		return false;
	}

	return (bool) apply_filters( 'ab_test_block_tracking_enabled', true );
}

function ab_test_block_get_default_winner_state( $window_days = 14 ) {
	return array(
		'evaluatedAt' => null,
		'lockedAt'    => null,
		'metric'      => 'ctr',
		'status'      => 'no-winner',
		'variants'    => array(),
		'windowDays'  => (int) $window_days,
		'winner'      => null,
	);
}

function ab_test_block_prepare_winner_state_for_context( $state, $variant_count, $window_days = 14 ) {
	$normalized = ab_test_block_sanitize_winner_state( $state, $variant_count, $window_days );

	if ( empty( $normalized['evaluatedAt'] ) ) {
		unset( $normalized['evaluatedAt'] );
	}

	if ( empty( $normalized['lockedAt'] ) ) {
		unset( $normalized['lockedAt'] );
	}

	if ( empty( $normalized['winner'] ) ) {
		unset( $normalized['winner'] );
	}

	return $normalized;
}

function ab_test_block_sanitize_winner_state( $state, $variant_count, $window_days = 14 ) {
	$state      = is_array( $state ) ? $state : array();
	$defaults   = ab_test_block_get_default_winner_state( $window_days );
	$variantMap = array_flip( ab_test_block_variant_keys( $variant_count ) );
	$status     = isset( $state['status'] ) && in_array( $state['status'], array( 'candidate', 'winner-locked' ), true )
		? $state['status']
		: 'no-winner';
	$winner     = isset( $state['winner'] ) && isset( $variantMap[ $state['winner'] ] )
		? $state['winner']
		: null;
	$variants   = array();

	if ( ! empty( $state['variants'] ) && is_array( $state['variants'] ) ) {
		foreach ( $state['variants'] as $variant_row ) {
			if ( ! is_array( $variant_row ) ) {
				continue;
			}

			$variant_key = isset( $variant_row['variantKey'] ) ? $variant_row['variantKey'] : ( $variant_row['variant'] ?? null );
			if ( ! isset( $variantMap[ $variant_key ] ) ) {
				continue;
			}

			$variants[] = array(
				'clicks'      => max( 0, (int) ( $variant_row['clicks'] ?? 0 ) ),
				'ctr'         => max( 0, (float) ( $variant_row['ctr'] ?? 0 ) ),
				'impressions' => max( 0, (int) ( $variant_row['impressions'] ?? 0 ) ),
				'variantKey'  => $variant_key,
			);
		}
	}

	return array(
		'evaluatedAt' => isset( $state['evaluatedAt'] ) ? (int) $state['evaluatedAt'] : $defaults['evaluatedAt'],
		'lockedAt'    => isset( $state['lockedAt'] ) ? (int) $state['lockedAt'] : $defaults['lockedAt'],
		'metric'      => 'ctr',
		'status'      => $winner ? $status : 'no-winner',
		'variants'    => $variants,
		'windowDays'  => isset( $state['windowDays'] ) ? max( 1, min( 365, (int) $state['windowDays'] ) ) : $defaults['windowDays'],
		'winner'      => $winner,
	);
}

function ab_test_block_get_winner_state_map( $post_id ) {
	$state = get_post_meta( $post_id, AB_TEST_BLOCK_WINNER_META_KEY, true );

	return is_array( $state ) ? $state : array();
}

function ab_test_block_get_winner_state( $post_id, $block_instance_id, $variant_count, $window_days = 14 ) {
	$state_map = ab_test_block_get_winner_state_map( $post_id );
	$state     = isset( $state_map[ $block_instance_id ] ) ? $state_map[ $block_instance_id ] : array();

	return ab_test_block_sanitize_winner_state( $state, $variant_count, $window_days );
}

function ab_test_block_register_meta() {
	register_meta(
		'post',
		AB_TEST_BLOCK_WINNER_META_KEY,
		array(
			'auth_callback'     => static function() {
				return current_user_can( 'edit_posts' );
			},
			'sanitize_callback' => static function( $value ) {
				return is_array( $value ) ? $value : array();
			},
			'show_in_rest'      => array(
				'schema' => array(
					'additionalProperties' => true,
					'default'              => array(),
					'type'                 => 'object',
				),
			),
			'single'            => true,
			'type'              => 'object',
		)
	);
}

function ab_test_block_update_winner_state( $post_id, $block_instance_id, $state, $variant_count, $window_days = 14 ) {
	$state_map                         = ab_test_block_get_winner_state_map( $post_id );
	$state_map[ $block_instance_id ]   = ab_test_block_sanitize_winner_state( $state, $variant_count, $window_days );
	update_post_meta( $post_id, AB_TEST_BLOCK_WINNER_META_KEY, $state_map );

	return $state_map[ $block_instance_id ];
}

function ab_test_block_find_experiment_attributes_in_blocks( $blocks, $experiment_id = null, $block_instance_id = null ) {
	if ( ! is_array( $blocks ) ) {
		return null;
	}

	foreach ( $blocks as $block ) {
		if ( ! is_array( $block ) ) {
			continue;
		}

		if ( 'abtest-block/test' === ( $block['blockName'] ?? null ) ) {
			$attributes = ab_test_block_sanitize_experiment_attributes( $block['attrs'] ?? array() );

			$matches_experiment = null === $experiment_id || (string) $attributes['experimentId'] === (string) $experiment_id;
			$matches_instance   = null === $block_instance_id || (string) $attributes['blockInstanceId'] === (string) $block_instance_id;

			if ( $matches_experiment && $matches_instance ) {
				return $attributes;
			}
		}

		$inner_match = ab_test_block_find_experiment_attributes_in_blocks(
			$block['innerBlocks'] ?? array(),
			$experiment_id,
			$block_instance_id
		);

		if ( is_array( $inner_match ) ) {
			return $inner_match;
		}
	}

	return null;
}

function ab_test_block_collect_experiment_attributes_in_blocks( $blocks, $experiment_id = null ) {
	if ( ! is_array( $blocks ) ) {
		return array();
	}

	$matches = array();

	foreach ( $blocks as $block ) {
		if ( ! is_array( $block ) ) {
			continue;
		}

		if ( 'abtest-block/test' === ( $block['blockName'] ?? null ) ) {
			$attributes = ab_test_block_sanitize_experiment_attributes( $block['attrs'] ?? array() );

			if ( null === $experiment_id || (string) $attributes['experimentId'] === (string) $experiment_id ) {
				$matches[] = $attributes;
			}
		}

		$matches = array_merge(
			$matches,
			ab_test_block_collect_experiment_attributes_in_blocks(
				$block['innerBlocks'] ?? array(),
				$experiment_id
			)
		);
	}

	return $matches;
}

function ab_test_block_get_post_experiment_attributes( $post_id, $experiment_id = null, $block_instance_id = null ) {
	$post = get_post( (int) $post_id );

	if ( ! $post instanceof WP_Post || '' === (string) $post->post_content ) {
		return null;
	}

	return ab_test_block_find_experiment_attributes_in_blocks(
		parse_blocks( $post->post_content ),
		$experiment_id,
		$block_instance_id
	);
}

function ab_test_block_get_recent_authored_experiment_summary( $experiment_id, $limit = 25 ) {
	global $wpdb;

	$post_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT ID
			FROM {$wpdb->posts}
			WHERE post_content LIKE %s
				AND post_status NOT IN ( 'auto-draft', 'trash' )
			ORDER BY post_modified_gmt DESC, ID DESC
			LIMIT %d",
			'%' . $wpdb->esc_like( (string) $experiment_id ) . '%',
			max( 1, min( 100, (int) $limit ) )
		)
	);

	$summary = array(
		'attributes'          => null,
		'blockInstanceCount'  => 0,
		'postCount'           => 0,
		'postId'              => 0,
		'updatedAt'           => null,
	);

	foreach ( $post_ids as $post_id ) {
		$post = get_post( (int) $post_id );

		if ( ! $post instanceof WP_Post || '' === (string) $post->post_content ) {
			continue;
		}

		$matches = ab_test_block_collect_experiment_attributes_in_blocks(
			parse_blocks( $post->post_content ),
			$experiment_id
		);

		if ( empty( $matches ) ) {
			continue;
		}

		if ( ! is_array( $summary['attributes'] ) ) {
			$summary['attributes'] = $matches[0];
			$summary['postId']     = (int) $post_id;
		}

		$summary['blockInstanceCount'] += count( $matches );
		$summary['postCount']          += 1;

		$updated_at = ab_test_block_normalize_stats_updated_at( (string) $post->post_modified_gmt );
		if ( ! empty( $updated_at ) && ( empty( $summary['updatedAt'] ) || $updated_at > $summary['updatedAt'] ) ) {
			$summary['updatedAt'] = $updated_at;
		}
	}

	return $summary['postCount'] > 0 ? $summary : null;
}

function ab_test_block_find_recent_experiment_attributes( $experiment_id, $limit = 25 ) {
	$summary = ab_test_block_get_recent_authored_experiment_summary( $experiment_id, $limit );

	if ( ! is_array( $summary ) || ! is_array( $summary['attributes'] ) ) {
		return null;
	}

	$attributes           = $summary['attributes'];
	$attributes['postId'] = (int) $summary['postId'];

	return $attributes;
}

function ab_test_block_maybe_install_storage() {
	global $wpdb;

	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	$table_name      = ab_test_block_get_stats_table_name();
	$charset_collate = $wpdb->get_charset_collate();
	$sql             = "CREATE TABLE {$table_name} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		post_id bigint(20) unsigned NOT NULL,
		block_instance_id varchar(64) NOT NULL,
		experiment_id varchar(191) NOT NULL,
		variant_key char(1) NOT NULL,
		event_type varchar(32) NOT NULL,
		event_date date NOT NULL,
		event_count bigint(20) unsigned NOT NULL DEFAULT 0,
		created_at datetime NOT NULL,
		updated_at datetime NOT NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY event_day (post_id, block_instance_id, variant_key, event_type, event_date),
		KEY experiment_id (experiment_id),
		KEY post_block (post_id, block_instance_id)
	) {$charset_collate};";

	dbDelta( $sql );

	update_option( 'ab_test_block_storage_version', AB_TEST_BLOCK_STORAGE_VERSION );
}

function ab_test_block_ensure_storage_installed() {
	if ( AB_TEST_BLOCK_STORAGE_VERSION !== get_option( 'ab_test_block_storage_version', '' ) ) {
		ab_test_block_maybe_install_storage();
	}
}

function ab_test_block_load_schema( $schema_name ) {
	$schema_dir = ab_test_block_get_api_schema_dir();
	if ( ! $schema_dir ) {
		return null;
	}

	$path = trailingslashit( $schema_dir ) . $schema_name . '.schema.json';
	if ( ! file_exists( $path ) ) {
		return null;
	}

	$decoded = json_decode( file_get_contents( $path ), true );

	return is_array( $decoded ) ? $decoded : null;
}

function ab_test_block_sanitize_rest_schema( $schema ) {
	if ( ! is_array( $schema ) ) {
		return $schema;
	}

	unset( $schema['$schema'], $schema['title'] );

	if ( isset( $schema['properties'] ) && is_array( $schema['properties'] ) ) {
		foreach ( $schema['properties'] as $key => $property_schema ) {
			$schema['properties'][ $key ] = ab_test_block_sanitize_rest_schema( $property_schema );
		}
	}

	if ( isset( $schema['items'] ) && is_array( $schema['items'] ) ) {
		$schema['items'] = ab_test_block_sanitize_rest_schema( $schema['items'] );
	}

	return $schema;
}

function ab_test_block_validate_and_sanitize_request( $value, $schema_name, $param_name ) {
	$schema = ab_test_block_load_schema( $schema_name );
	if ( ! is_array( $schema ) ) {
		return new WP_Error( 'missing_schema', 'Missing REST schema.', array( 'status' => 500 ) );
	}

	$rest_schema = ab_test_block_sanitize_rest_schema( $schema );
	$validation  = rest_validate_value_from_schema( $value, $rest_schema, $param_name );
	if ( is_wp_error( $validation ) ) {
		return $validation;
	}

	return rest_sanitize_value_from_schema( $value, $rest_schema, $param_name );
}

function ab_test_block_base64url_encode( $value ) {
	return rtrim( strtr( base64_encode( $value ), '+/', '-_' ), '=' );
}

function ab_test_block_base64url_decode( $value ) {
	if ( ! is_string( $value ) || '' === $value ) {
		return false;
	}

	$padding = strlen( $value ) % 4;
	if ( $padding > 0 ) {
		$value .= str_repeat( '=', 4 - $padding );
	}

	return base64_decode( strtr( $value, '-_', '+/' ), true );
}

function ab_test_block_create_public_write_token( $post_id, $block_instance_id, $experiment_id ) {
	$expires_at = time() + (int) AB_TEST_BLOCK_PUBLIC_WRITE_TTL;
	$payload    = array(
		'exp'             => $expires_at,
		'experimentId'    => (string) $experiment_id,
		'postId'          => (int) $post_id,
		'blockInstanceId' => (string) $block_instance_id,
		'scope'           => 'abtest-block/runtime',
	);
	$json       = wp_json_encode( $payload );

	if ( ! is_string( $json ) || '' === $json ) {
		return array(
			'expiresAt' => $expires_at,
			'token'     => '',
		);
	}

	$payload_segment   = ab_test_block_base64url_encode( $json );
	$signature_segment = ab_test_block_base64url_encode(
		hash_hmac( 'sha256', $payload_segment, wp_salt( 'nonce' ), true )
	);

	return array(
		'expiresAt' => $expires_at,
		'token'     => $payload_segment . '.' . $signature_segment,
	);
}

function ab_test_block_verify_public_write_token( $token, $post_id, $block_instance_id, $experiment_id ) {
	if ( ! is_string( $token ) || '' === $token ) {
		return new WP_Error( 'rest_forbidden', 'The public write token is missing.', array( 'status' => 403 ) );
	}

	$segments = explode( '.', $token );
	if ( 2 !== count( $segments ) ) {
		return new WP_Error( 'rest_forbidden', 'The public write token format is invalid.', array( 'status' => 403 ) );
	}

	list( $payload_segment, $signature_segment ) = $segments;
	$expected_signature                           = ab_test_block_base64url_encode(
		hash_hmac( 'sha256', $payload_segment, wp_salt( 'nonce' ), true )
	);

	if ( ! hash_equals( $expected_signature, $signature_segment ) ) {
		return new WP_Error( 'rest_forbidden', 'The public write token signature is invalid.', array( 'status' => 403 ) );
	}

	$payload_json = ab_test_block_base64url_decode( $payload_segment );
	if ( false === $payload_json ) {
		return new WP_Error( 'rest_forbidden', 'The public write token payload is invalid.', array( 'status' => 403 ) );
	}

	$payload = json_decode( $payload_json, true );
	if ( ! is_array( $payload ) ) {
		return new WP_Error( 'rest_forbidden', 'The public write token payload is invalid.', array( 'status' => 403 ) );
	}

	if ( 'abtest-block/runtime' !== ( isset( $payload['scope'] ) ? (string) $payload['scope'] : '' ) ) {
		return new WP_Error( 'rest_forbidden', 'The public write token scope is invalid.', array( 'status' => 403 ) );
	}

	if ( (int) ( $payload['exp'] ?? 0 ) < time() ) {
		return new WP_Error( 'rest_forbidden', 'The public write token has expired.', array( 'status' => 403 ) );
	}

	if ( (int) $post_id !== (int) ( $payload['postId'] ?? 0 ) ) {
		return new WP_Error( 'rest_forbidden', 'The public write token is not valid for this post.', array( 'status' => 403 ) );
	}

	if ( (string) $block_instance_id !== (string) ( $payload['blockInstanceId'] ?? '' ) ) {
		return new WP_Error( 'rest_forbidden', 'The public write token is not valid for this block instance.', array( 'status' => 403 ) );
	}

	if ( (string) $experiment_id !== (string) ( $payload['experimentId'] ?? '' ) ) {
		return new WP_Error( 'rest_forbidden', 'The public write token is not valid for this experiment.', array( 'status' => 403 ) );
	}

	return true;
}

function ab_test_block_can_write_publicly( WP_REST_Request $request ) {
	$payload = $request->get_json_params();
	$payload = is_array( $payload ) ? $payload : array();

	$post_id           = isset( $payload['postId'] ) ? (int) $payload['postId'] : 0;
	$block_instance_id = isset( $payload['blockInstanceId'] ) ? sanitize_key( (string) $payload['blockInstanceId'] ) : '';
	$experiment_id     = isset( $payload['experimentId'] ) ? sanitize_key( (string) $payload['experimentId'] ) : '';
	$token             = isset( $payload['publicWriteToken'] ) ? (string) $payload['publicWriteToken'] : '';

	return ab_test_block_verify_public_write_token( $token, $post_id, $block_instance_id, $experiment_id );
}

function ab_test_block_can_read_stats( WP_REST_Request $request ) {
	$post_id = (int) $request->get_param( 'postId' );

	return $post_id > 0
		? current_user_can( 'edit_post', $post_id )
		: current_user_can( 'edit_posts' );
}

function ab_test_block_record_event( $payload ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$event_date = gmdate( 'Y-m-d', (int) $payload['timestamp'] );
	$timestamp  = current_time( 'mysql', true );
	$result     = $wpdb->query(
		$wpdb->prepare(
			"INSERT INTO {$table_name} (
				post_id,
				block_instance_id,
				experiment_id,
				variant_key,
				event_type,
				event_date,
				event_count,
				created_at,
				updated_at
			) VALUES ( %d, %s, %s, %s, %s, %s, %d, %s, %s )
			ON DUPLICATE KEY UPDATE
				event_count = event_count + VALUES(event_count),
				updated_at = VALUES(updated_at)",
			(int) $payload['postId'],
			(string) $payload['blockInstanceId'],
			(string) $payload['experimentId'],
			(string) $payload['variant'],
			(string) $payload['eventType'],
			$event_date,
			1,
			$timestamp,
			$timestamp
		)
	);

	if ( false === $result ) {
		return new WP_Error( 'ab_test_block_event_failed', 'Failed to record the event.', array( 'status' => 500 ) );
	}

	return true;
}

function ab_test_block_normalize_stats_updated_at( $updated_at ) {
	if ( ! is_string( $updated_at ) || '' === $updated_at ) {
		return null;
	}

	$timestamp = strtotime( $updated_at . ' UTC' );

	return false === $timestamp ? null : (int) $timestamp;
}

function ab_test_block_get_instance_variant_aggregates( $post_id, $block_instance_id, $variant_count, $window_days ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$cutoff     = gmdate( 'Y-m-d', time() - DAY_IN_SECONDS * max( 0, ( (int) $window_days ) - 1 ) );
	$rows       = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT
				variant_key,
				SUM( CASE WHEN event_type = 'impression' THEN event_count ELSE 0 END ) AS impressions,
				SUM( CASE WHEN event_type = 'click' THEN event_count ELSE 0 END ) AS clicks
			FROM {$table_name}
			WHERE post_id = %d
				AND block_instance_id = %s
				AND event_date >= %s
			GROUP BY variant_key",
			(int) $post_id,
			(string) $block_instance_id,
			$cutoff
		),
		ARRAY_A
	);
	$lookup     = array();

	foreach ( $rows as $row ) {
		$lookup[ $row['variant_key'] ] = array(
			'clicks'      => max( 0, (int) $row['clicks'] ),
			'impressions' => max( 0, (int) $row['impressions'] ),
		);
	}

	$aggregates = array();
	foreach ( ab_test_block_variant_keys( $variant_count ) as $variant_key ) {
		$impressions = isset( $lookup[ $variant_key ] ) ? $lookup[ $variant_key ]['impressions'] : 0;
		$clicks      = isset( $lookup[ $variant_key ] ) ? $lookup[ $variant_key ]['clicks'] : 0;

		$aggregates[] = array(
			'clicks'      => $clicks,
			'ctr'         => $impressions > 0 ? (float) ( $clicks / $impressions ) : 0,
			'impressions' => $impressions,
			'variant'     => $variant_key,
		);
	}

	return $aggregates;
}

function ab_test_block_get_instance_stats_summary( $post_id, $block_instance_id, $window_days ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$cutoff     = gmdate( 'Y-m-d', time() - DAY_IN_SECONDS * max( 0, ( (int) $window_days ) - 1 ) );
	$row        = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT MAX(updated_at) AS updated_at
			FROM {$table_name}
			WHERE post_id = %d
				AND block_instance_id = %s
				AND event_date >= %s",
			(int) $post_id,
			(string) $block_instance_id,
			$cutoff
		),
		ARRAY_A
	);

	return array(
		'updatedAt' => ab_test_block_normalize_stats_updated_at( $row['updated_at'] ?? null ),
	);
}

function ab_test_block_get_experiment_variant_aggregates( $experiment_id, $variant_count, $window_days ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$cutoff     = gmdate( 'Y-m-d', time() - DAY_IN_SECONDS * max( 0, ( (int) $window_days ) - 1 ) );
	$rows       = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT
				variant_key,
				SUM( CASE WHEN event_type = 'impression' THEN event_count ELSE 0 END ) AS impressions,
				SUM( CASE WHEN event_type = 'click' THEN event_count ELSE 0 END ) AS clicks
			FROM {$table_name}
			WHERE experiment_id = %s
				AND event_date >= %s
			GROUP BY variant_key",
			(string) $experiment_id,
			$cutoff
		),
		ARRAY_A
	);
	$lookup     = array();

	foreach ( $rows as $row ) {
		$lookup[ $row['variant_key'] ] = array(
			'clicks'      => max( 0, (int) $row['clicks'] ),
			'impressions' => max( 0, (int) $row['impressions'] ),
		);
	}

	$aggregates = array();
	foreach ( ab_test_block_variant_keys( $variant_count ) as $variant_key ) {
		$impressions = isset( $lookup[ $variant_key ] ) ? $lookup[ $variant_key ]['impressions'] : 0;
		$clicks      = isset( $lookup[ $variant_key ] ) ? $lookup[ $variant_key ]['clicks'] : 0;

		$aggregates[] = array(
			'clicks'      => $clicks,
			'ctr'         => $impressions > 0 ? (float) ( $clicks / $impressions ) : 0,
			'impressions' => $impressions,
			'variant'     => $variant_key,
		);
	}

	return $aggregates;
}

function ab_test_block_get_experiment_stats_summary( $experiment_id, $window_days ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$cutoff     = gmdate( 'Y-m-d', time() - DAY_IN_SECONDS * max( 0, ( (int) $window_days ) - 1 ) );
	$row        = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT
				COUNT(DISTINCT post_id) AS post_count,
				COUNT(DISTINCT CONCAT(post_id, ':', block_instance_id)) AS block_instance_count,
				MAX(updated_at) AS updated_at
			FROM {$table_name}
			WHERE experiment_id = %s
				AND event_date >= %s",
			(string) $experiment_id,
			$cutoff
		),
		ARRAY_A
	);

	$summary = array(
		'blockInstanceCount' => max( 0, (int) ( $row['block_instance_count'] ?? 0 ) ),
		'postCount'          => max( 0, (int) ( $row['post_count'] ?? 0 ) ),
		'updatedAt'          => ab_test_block_normalize_stats_updated_at( $row['updated_at'] ?? null ),
	);

	if ( $summary['postCount'] > 0 || $summary['blockInstanceCount'] > 0 || ! empty( $summary['updatedAt'] ) ) {
		return $summary;
	}

	$authored_summary = ab_test_block_get_recent_authored_experiment_summary( $experiment_id );

	if ( ! is_array( $authored_summary ) ) {
		return $summary;
	}

	return array(
		'blockInstanceCount' => (int) $authored_summary['blockInstanceCount'],
		'postCount'          => (int) $authored_summary['postCount'],
		'updatedAt'          => ! empty( $authored_summary['updatedAt'] ) ? (int) $authored_summary['updatedAt'] : null,
	);
}

function ab_test_block_build_stats_scope_snapshot( $experiment_id, $variant_count, $aggregates, $summary, $extra = array() ) {
	$snapshot = array(
		'experimentId' => (string) $experiment_id,
		'variantCount' => (int) $variant_count,
		'variants'     => array_map(
			static function( $aggregate ) {
				return array(
					'clicks'      => (int) $aggregate['clicks'],
					'ctr'         => (float) $aggregate['ctr'],
					'impressions' => (int) $aggregate['impressions'],
					'variantKey'  => (string) $aggregate['variant'],
				);
			},
			$aggregates
		),
	);

	if ( isset( $extra['postId'] ) ) {
		$snapshot['postId'] = (int) $extra['postId'];
	}

	if ( isset( $extra['blockInstanceId'] ) ) {
		$snapshot['blockInstanceId'] = (string) $extra['blockInstanceId'];
	}

	if ( isset( $summary['postCount'] ) ) {
		$snapshot['postCount'] = (int) $summary['postCount'];
	}

	if ( isset( $summary['blockInstanceCount'] ) ) {
		$snapshot['blockInstanceCount'] = (int) $summary['blockInstanceCount'];
	}

	if ( ! empty( $summary['updatedAt'] ) ) {
		$snapshot['updatedAt'] = (int) $summary['updatedAt'];
	}

	return $snapshot;
}

function ab_test_block_get_stats_snapshot( $post_id, $block_instance_id, $experiment_id, $variant_count, $window_days, $instance_aggregates = null ) {
	$instance_aggregates = is_array( $instance_aggregates )
		? $instance_aggregates
		: ab_test_block_get_instance_variant_aggregates(
			(int) $post_id,
			(string) $block_instance_id,
			(int) $variant_count,
			(int) $window_days
		);
	$instance_summary   = ab_test_block_get_instance_stats_summary(
		(int) $post_id,
		(string) $block_instance_id,
		(int) $window_days
	);
	$experiment_aggregates = ab_test_block_get_experiment_variant_aggregates(
		(string) $experiment_id,
		(int) $variant_count,
		(int) $window_days
	);
	$experiment_summary = ab_test_block_get_experiment_stats_summary(
		(string) $experiment_id,
		(int) $window_days
	);

	return array(
		'experiment' => ab_test_block_build_stats_scope_snapshot(
			(string) $experiment_id,
			(int) $variant_count,
			$experiment_aggregates,
			$experiment_summary
		),
		'instance'   => ab_test_block_build_stats_scope_snapshot(
			(string) $experiment_id,
			(int) $variant_count,
			$instance_aggregates,
			$instance_summary,
			array(
				'blockInstanceId' => (string) $block_instance_id,
				'postId'          => (int) $post_id,
			)
		),
	);
}

function ab_test_block_get_variant_aggregates( $post_id, $block_instance_id, $variant_count, $window_days ) {
	return ab_test_block_get_instance_variant_aggregates( $post_id, $block_instance_id, $variant_count, $window_days );
}

function ab_test_block_get_instance_reference_from_stats( $post_id, $block_instance_id ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$row        = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT
				experiment_id,
				MAX( CASE WHEN variant_key = 'c' THEN 1 ELSE 0 END ) AS has_variant_c
			FROM {$table_name}
			WHERE post_id = %d
				AND block_instance_id = %s
			GROUP BY experiment_id
			ORDER BY MAX(updated_at) DESC
			LIMIT 1",
			(int) $post_id,
			(string) $block_instance_id
		),
		ARRAY_A
	);

	if ( ! is_array( $row ) ) {
		return null;
	}

	return array(
		'experimentId' => (string) $row['experiment_id'],
		'variantCount' => ! empty( $row['has_variant_c'] ) ? 3 : 2,
	);
}

function ab_test_block_get_experiment_reference_from_stats( $experiment_id ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$row        = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT post_id, block_instance_id
			FROM {$table_name}
			WHERE experiment_id = %s
			ORDER BY updated_at DESC, id DESC
			LIMIT 1",
			(string) $experiment_id
		),
		ARRAY_A
	);

	if ( ! is_array( $row ) ) {
		return null;
	}

	return array(
		'blockInstanceId' => (string) $row['block_instance_id'],
		'postId'          => (int) $row['post_id'],
	);
}

function ab_test_block_get_experiment_index( $limit = 20 ) {
	global $wpdb;

	$table_name = ab_test_block_get_stats_table_name();
	$rows       = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT
				experiment_id,
				COUNT(DISTINCT post_id) AS post_count,
				COUNT(DISTINCT CONCAT(post_id, ':', block_instance_id)) AS block_instance_count,
				MAX(updated_at) AS updated_at
			FROM {$table_name}
			GROUP BY experiment_id
			ORDER BY MAX(updated_at) DESC
			LIMIT %d",
			max( 1, min( 200, (int) $limit ) )
		),
		ARRAY_A
	);
	$items      = array();

	foreach ( $rows as $row ) {
		$reference  = ab_test_block_get_experiment_reference_from_stats( $row['experiment_id'] );
		$attributes = is_array( $reference )
			? ab_test_block_get_post_experiment_attributes(
				$reference['postId'],
				$row['experiment_id'],
				$reference['blockInstanceId']
			)
			: null;

		$items[] = array(
			'block_instance_count' => max( 0, (int) ( $row['block_instance_count'] ?? 0 ) ),
			'experiment_id'        => (string) $row['experiment_id'],
			'experiment_label'     => is_array( $attributes ) ? (string) $attributes['experimentLabel'] : '',
			'post_count'           => max( 0, (int) ( $row['post_count'] ?? 0 ) ),
			'updated_at'           => ab_test_block_normalize_stats_updated_at( $row['updated_at'] ?? null ),
		);
	}

	return $items;
}

function ab_test_block_evaluate_winner( $aggregates, $payload ) {
	$candidates = array_values(
		array_filter(
			$aggregates,
			static function( $row ) use ( $payload ) {
				return $row['impressions'] >= (int) $payload['minimumImpressionsPerVariant']
					&& $row['clicks'] >= (int) $payload['minimumClicksPerVariant'];
			}
		)
	);

	usort(
		$candidates,
		static function( $left, $right ) {
			if ( $right['ctr'] === $left['ctr'] ) {
				return strcmp( $left['variant'], $right['variant'] );
			}

			return $right['ctr'] <=> $left['ctr'];
		}
	);

	if ( empty( $candidates ) ) {
		return null;
	}

	if ( 1 === count( $candidates ) ) {
		return $candidates[0]['variant'];
	}

	return $candidates[0]['ctr'] > $candidates[1]['ctr'] ? $candidates[0]['variant'] : null;
}

function ab_test_block_build_record_event_response( $payload, $counted, $stats ) {
	return array(
		'accepted'        => true,
		'blockInstanceId' => (string) $payload['blockInstanceId'],
		'counted'         => (bool) $counted,
		'eventType'       => (string) $payload['eventType'],
		'experimentId'    => (string) $payload['experimentId'],
		'postId'          => (int) $payload['postId'],
		'stats'           => $stats,
		'variant'         => (string) $payload['variant'],
	);
}

function ab_test_block_build_reevaluate_response( $state, $aggregates, $stats ) {
	$response = array(
		'evaluatedAt' => (int) ( $state['evaluatedAt'] ?? time() ),
		'metric'      => 'ctr',
		'status'      => (string) $state['status'],
		'stats'       => $stats,
		'variants'    => $aggregates,
	);

	if ( ! empty( $state['lockedAt'] ) ) {
		$response['lockedAt'] = (int) $state['lockedAt'];
	}

	if ( ! empty( $state['winner'] ) ) {
		$response['winner'] = (string) $state['winner'];
	}

	return $response;
}

function ab_test_block_cli_print_json( $value ) {
	if ( ! class_exists( 'WP_CLI' ) ) {
		return;
	}

	WP_CLI::line( wp_json_encode( $value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) );
}

function ab_test_block_cli_format_timestamp( $value ) {
	return ! empty( $value ) ? gmdate( 'Y-m-d H:i:s', (int) $value ) . ' UTC' : '';
}

function ab_test_block_cli_get_instance_context( $post_id, $block_instance_id ) {
	$attributes = ab_test_block_get_post_experiment_attributes(
		(int) $post_id,
		null,
		(string) $block_instance_id
	);

	if ( is_array( $attributes ) ) {
		return $attributes;
	}

	$reference = ab_test_block_get_instance_reference_from_stats(
		(int) $post_id,
		(string) $block_instance_id
	);

	if ( ! is_array( $reference ) ) {
		return null;
	}

	return array(
		'blockInstanceId'      => (string) $block_instance_id,
		'evaluationWindowDays' => 14,
		'experimentId'         => (string) $reference['experimentId'],
		'experimentLabel'      => '',
		'variantCount'         => (int) $reference['variantCount'],
	);
}

function ab_test_block_cli_get_experiment_context( $experiment_id ) {
	$reference = ab_test_block_get_experiment_reference_from_stats( $experiment_id );

	if ( ! is_array( $reference ) ) {
		$authored_summary = ab_test_block_get_recent_authored_experiment_summary( $experiment_id );

		if ( is_array( $authored_summary ) && is_array( $authored_summary['attributes'] ) ) {
			$attributes           = $authored_summary['attributes'];
			$attributes['postId'] = (int) $authored_summary['postId'];
			return $attributes;
		}

		return null;
	}

	$attributes = ab_test_block_get_post_experiment_attributes(
		(int) $reference['postId'],
		(string) $experiment_id,
		(string) $reference['blockInstanceId']
	);

	if ( is_array( $attributes ) ) {
		$attributes['postId'] = (int) $reference['postId'];
		return $attributes;
	}

	return array(
		'blockInstanceId'      => (string) $reference['blockInstanceId'],
		'evaluationWindowDays' => 14,
		'experimentId'         => (string) $experiment_id,
		'experimentLabel'      => '',
		'postId'               => (int) $reference['postId'],
		'variantCount'         => 2,
	);
}

if ( class_exists( 'WP_CLI_Command' ) ) {
	/**
	 * Read-only operational commands for the A/B Test Block plugin.
	 */
	class Ab_Test_Block_CLI_Command extends WP_CLI_Command {
		/**
		 * List tracked experiments.
		 *
		 * ## OPTIONS
		 *
		 * [--format=<format>]
		 * : Output format.
		 * ---
		 * default: table
		 * options:
		 *   - table
		 *   - json
		 * ---
		 *
		 * [--limit=<limit>]
		 * : Maximum number of experiments to show.
		 * ---
		 * default: 20
		 * ---
		 */
		public function experiments( $args, $assoc_args ) {
			$format = isset( $assoc_args['format'] ) ? (string) $assoc_args['format'] : 'table';
			$items  = ab_test_block_get_experiment_index( (int) ( $assoc_args['limit'] ?? 20 ) );

			if ( 'json' === $format ) {
				ab_test_block_cli_print_json( $items );
				return;
			}

			if ( empty( $items ) ) {
				WP_CLI::log( 'No tracked experiments found.' );
				return;
			}

			$rows = array_map(
				static function( $item ) {
					return array(
						'block_instance_count' => (int) $item['block_instance_count'],
						'experiment_id'        => (string) $item['experiment_id'],
						'experiment_label'     => (string) $item['experiment_label'],
						'post_count'           => (int) $item['post_count'],
						'updated_at'           => ab_test_block_cli_format_timestamp( $item['updated_at'] ),
					);
				},
				$items
			);

			WP_CLI\Utils\format_items(
				'table',
				$rows,
				array( 'experiment_id', 'experiment_label', 'post_count', 'block_instance_count', 'updated_at' )
			);
		}

		/**
		 * Show stats for one block instance or one shared experiment.
		 *
		 * ## OPTIONS
		 *
		 * [--post=<post-id>]
		 * : Post ID for a single block instance lookup.
		 *
		 * [--block-instance=<block-instance-id>]
		 * : Block instance ID for a single block instance lookup.
		 *
		 * [--experiment=<experiment-id>]
		 * : Experiment ID for a shared aggregate lookup.
		 *
		 * [--format=<format>]
		 * : Output format.
		 * ---
		 * default: table
		 * options:
		 *   - table
		 *   - json
		 * ---
		 */
		public function stats( $args, $assoc_args ) {
			$format          = isset( $assoc_args['format'] ) ? (string) $assoc_args['format'] : 'table';
			$post_id         = isset( $assoc_args['post'] ) ? (int) $assoc_args['post'] : 0;
			$block_instance  = isset( $assoc_args['block-instance'] ) ? sanitize_key( (string) $assoc_args['block-instance'] ) : '';
			$experiment_id   = isset( $assoc_args['experiment'] ) ? sanitize_key( (string) $assoc_args['experiment'] ) : '';
			$context         = null;
			$scope           = '';

			if ( $post_id > 0 && '' !== $block_instance ) {
				$scope   = 'instance';
				$context = ab_test_block_cli_get_instance_context( $post_id, $block_instance );
			} elseif ( '' !== $experiment_id ) {
				$scope   = 'experiment';
				$context = ab_test_block_cli_get_experiment_context( $experiment_id );
			} else {
				WP_CLI::error( 'Provide either --post and --block-instance, or --experiment.' );
			}

			if ( ! is_array( $context ) ) {
				WP_CLI::error( 'Could not resolve the requested experiment context.' );
			}

			$snapshot = ab_test_block_get_stats_snapshot(
				(int) ( $post_id ?: ( $context['postId'] ?? 0 ) ),
				(string) ( $block_instance ?: ( $context['blockInstanceId'] ?? '' ) ),
				(string) $context['experimentId'],
				(int) $context['variantCount'],
				(int) $context['evaluationWindowDays']
			);
			$target   = 'experiment' === $scope ? $snapshot['experiment'] : $snapshot['instance'];

			if ( 'json' === $format ) {
				ab_test_block_cli_print_json( $target );
				return;
			}

			WP_CLI::log( 'Scope: ' . $scope );
			WP_CLI::log( 'Experiment ID: ' . (string) $target['experimentId'] );
			if ( isset( $target['postId'] ) ) {
				WP_CLI::log( 'Post ID: ' . (int) $target['postId'] );
			}
			if ( isset( $target['blockInstanceId'] ) ) {
				WP_CLI::log( 'Block instance: ' . (string) $target['blockInstanceId'] );
			}
			if ( isset( $target['postCount'] ) ) {
				WP_CLI::log( 'Posts: ' . (int) $target['postCount'] );
			}
			if ( isset( $target['blockInstanceCount'] ) ) {
				WP_CLI::log( 'Block instances: ' . (int) $target['blockInstanceCount'] );
			}
			WP_CLI::log( 'Updated: ' . ab_test_block_cli_format_timestamp( $target['updatedAt'] ?? null ) );

			$rows = array_map(
				static function( $variant ) {
					return array(
						'clicks'      => (int) $variant['clicks'],
						'ctr'         => number_format_i18n( (float) $variant['ctr'] * 100, 1 ) . '%',
						'impressions' => (int) $variant['impressions'],
						'variant'     => strtoupper( (string) $variant['variantKey'] ),
					);
				},
				$target['variants']
			);

			WP_CLI\Utils\format_items( 'table', $rows, array( 'variant', 'impressions', 'clicks', 'ctr' ) );
		}

		/**
		 * Show stored winner state for one block instance.
		 *
		 * ## OPTIONS
		 *
		 * --post=<post-id>
		 * : Post ID that contains the block instance.
		 *
		 * --block-instance=<block-instance-id>
		 * : Block instance ID to inspect.
		 *
		 * [--format=<format>]
		 * : Output format.
		 * ---
		 * default: json
		 * options:
		 *   - json
		 * ---
		 */
		public function winner_state( $args, $assoc_args ) {
			$post_id        = isset( $assoc_args['post'] ) ? (int) $assoc_args['post'] : 0;
			$block_instance = isset( $assoc_args['block-instance'] ) ? sanitize_key( (string) $assoc_args['block-instance'] ) : '';
			$format         = isset( $assoc_args['format'] ) ? (string) $assoc_args['format'] : 'json';

			if ( $post_id <= 0 || '' === $block_instance ) {
				WP_CLI::error( 'Provide both --post and --block-instance.' );
			}

			if ( 'json' !== $format ) {
				WP_CLI::error( 'winner-state currently supports --format=json only.' );
			}

			$context = ab_test_block_cli_get_instance_context( $post_id, $block_instance );
			if ( ! is_array( $context ) ) {
				WP_CLI::error( 'Could not resolve the requested block instance.' );
			}

			ab_test_block_cli_print_json(
				array(
					'blockInstanceId' => (string) $block_instance,
					'experimentId'    => (string) $context['experimentId'],
					'postId'          => (int) $post_id,
					'state'           => ab_test_block_get_winner_state(
						$post_id,
						$block_instance,
						(int) $context['variantCount'],
						(int) $context['evaluationWindowDays']
					),
				)
			);
		}
	}
}

function ab_test_block_handle_record_event( WP_REST_Request $request ) {
	$payload = ab_test_block_validate_and_sanitize_request( $request->get_json_params(), 'record-event-request', 'body' );
	if ( is_wp_error( $payload ) ) {
		return $payload;
	}

	if ( ! ab_test_block_is_tracking_enabled() ) {
		return rest_ensure_response(
			ab_test_block_build_record_event_response(
				$payload,
				false,
				ab_test_block_get_stats_snapshot(
					(int) $payload['postId'],
					(string) $payload['blockInstanceId'],
					(string) $payload['experimentId'],
					(int) $payload['variantCount'],
					(int) $payload['evaluationWindowDays']
				)
			)
		);
	}

	if ( ! empty( $payload['preview'] ) ) {
		return rest_ensure_response(
			ab_test_block_build_record_event_response(
				$payload,
				false,
				ab_test_block_get_stats_snapshot(
					(int) $payload['postId'],
					(string) $payload['blockInstanceId'],
					(string) $payload['experimentId'],
					(int) $payload['variantCount'],
					(int) $payload['evaluationWindowDays']
				)
			)
		);
	}

	$recorded = ab_test_block_record_event( $payload );
	if ( is_wp_error( $recorded ) ) {
		return $recorded;
	}

	$stats = ab_test_block_get_stats_snapshot(
		(int) $payload['postId'],
		(string) $payload['blockInstanceId'],
		(string) $payload['experimentId'],
		(int) $payload['variantCount'],
		(int) $payload['evaluationWindowDays']
	);

	return rest_ensure_response( ab_test_block_build_record_event_response( $payload, true, $stats ) );
}

function ab_test_block_handle_reevaluate( WP_REST_Request $request ) {
	$payload = ab_test_block_validate_and_sanitize_request( $request->get_json_params(), 'reevaluate-request', 'body' );
	if ( is_wp_error( $payload ) ) {
		return $payload;
	}

	$existing_state = ab_test_block_get_winner_state(
		(int) $payload['postId'],
		(string) $payload['blockInstanceId'],
		(int) $payload['variantCount'],
		(int) $payload['evaluationWindowDays']
	);
	$aggregates     = ab_test_block_get_variant_aggregates(
		(int) $payload['postId'],
		(string) $payload['blockInstanceId'],
		(int) $payload['variantCount'],
		(int) $payload['evaluationWindowDays']
	);

	if ( ! ab_test_block_is_tracking_enabled() ) {
		$stats = ab_test_block_get_stats_snapshot(
			(int) $payload['postId'],
			(string) $payload['blockInstanceId'],
			(string) $payload['experimentId'],
			(int) $payload['variantCount'],
			(int) $payload['evaluationWindowDays'],
			$aggregates
		);

		return rest_ensure_response(
			ab_test_block_build_reevaluate_response( $existing_state, $aggregates, $stats )
		);
	}

	if (
		! empty( $payload['lockWinnerAfterSelection'] ) &&
		'winner-locked' === $existing_state['status'] &&
		! empty( $existing_state['winner'] )
	) {
		$stats = ab_test_block_get_stats_snapshot(
			(int) $payload['postId'],
			(string) $payload['blockInstanceId'],
			(string) $payload['experimentId'],
			(int) $payload['variantCount'],
			(int) $payload['evaluationWindowDays'],
			$aggregates
		);

		return rest_ensure_response(
			ab_test_block_build_reevaluate_response( $existing_state, $aggregates, $stats )
		);
	}

	$winner       = ab_test_block_evaluate_winner( $aggregates, $payload );
	$evaluated_at = time();
	$next_state   = array(
		'evaluatedAt' => $evaluated_at,
		'lockedAt'    => null,
		'metric'      => 'ctr',
		'status'      => $winner
			? ( ! empty( $payload['lockWinnerAfterSelection'] ) ? 'winner-locked' : 'candidate' )
			: 'no-winner',
		'variants'    => array_map(
			static function( $aggregate ) {
				return array(
					'clicks'      => (int) $aggregate['clicks'],
					'ctr'         => (float) $aggregate['ctr'],
					'impressions' => (int) $aggregate['impressions'],
					'variantKey'  => (string) $aggregate['variant'],
				);
			},
			$aggregates
		),
		'windowDays'  => (int) $payload['evaluationWindowDays'],
		'winner'      => $winner,
	);

	if ( 'winner-locked' === $next_state['status'] ) {
		$next_state['lockedAt'] = $evaluated_at;
	}

	$stored_state = ab_test_block_update_winner_state(
		(int) $payload['postId'],
		(string) $payload['blockInstanceId'],
		$next_state,
		(int) $payload['variantCount'],
		(int) $payload['evaluationWindowDays']
	);
	$stats        = ab_test_block_get_stats_snapshot(
		(int) $payload['postId'],
		(string) $payload['blockInstanceId'],
		(string) $payload['experimentId'],
		(int) $payload['variantCount'],
		(int) $payload['evaluationWindowDays'],
		$aggregates
	);

	return rest_ensure_response(
		ab_test_block_build_reevaluate_response( $stored_state, $aggregates, $stats )
	);
}

function ab_test_block_handle_stats( WP_REST_Request $request ) {
	$query_params = $request->get_query_params();
	$query_params = is_array( $query_params ) ? $query_params : array();
	unset( $query_params['rest_route'] );
	$payload = ab_test_block_validate_and_sanitize_request( $query_params, 'stats-request', 'query' );
	if ( is_wp_error( $payload ) ) {
		return $payload;
	}

	return rest_ensure_response(
		ab_test_block_get_stats_snapshot(
			(int) $payload['postId'],
			(string) $payload['blockInstanceId'],
			(string) $payload['experimentId'],
			(int) $payload['variantCount'],
			(int) $payload['evaluationWindowDays']
		)
	);
}

function ab_test_block_register_routes() {
	register_rest_route(
		'abtest-block/v1',
		'/event',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'ab_test_block_handle_record_event',
			'permission_callback' => 'ab_test_block_can_write_publicly',
		)
	);

	register_rest_route(
		'abtest-block/v1',
		'/reevaluate',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'ab_test_block_handle_reevaluate',
			'permission_callback' => 'ab_test_block_can_write_publicly',
		)
	);

	register_rest_route(
		'abtest-block/v1',
		'/stats',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'ab_test_block_handle_stats',
			'permission_callback' => 'ab_test_block_can_read_stats',
		)
	);
}

function ab_test_block_register_blocks() {
	$block_dirs = array_filter(
		array(
			ab_test_block_get_block_build_dir( 'test' ),
			ab_test_block_get_block_build_dir( 'variant' ),
		)
	);

	foreach ( $block_dirs as $block_dir ) {
		register_block_type( $block_dir );
	}
}

function ab_test_block_register_cli_commands() {
	if ( ! class_exists( 'WP_CLI' ) || ! class_exists( 'Ab_Test_Block_CLI_Command' ) ) {
		return;
	}

	$command = new Ab_Test_Block_CLI_Command();

	WP_CLI::add_command( 'abtest-block', $command );
	WP_CLI::add_command( 'abtest-block winner-state', array( $command, 'winner_state' ) );
}

register_activation_hook( __FILE__, 'ab_test_block_maybe_install_storage' );
add_action( 'init', 'ab_test_block_ensure_storage_installed' );
add_action( 'init', 'ab_test_block_register_meta' );
add_action( 'init', 'ab_test_block_register_blocks' );
add_action( 'rest_api_init', 'ab_test_block_register_routes' );
add_action( 'cli_init', 'ab_test_block_register_cli_commands' );
