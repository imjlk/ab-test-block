<?php
/**
 * Plugin Name:       Ab Test Block
 * Description:       A/B test block starter built on the wp-typia persistence scaffold with spec-aligned experiment contracts
 * Version:           0.1.0
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

define( 'ab_test_block_DATA_STORAGE_MODE', 'custom-table' );
define( 'ab_test_block_PUBLIC_WRITE_TTL', HOUR_IN_SECONDS );

function ab_test_block_get_build_dir() {
	$candidates = array(
		__DIR__ . '/build',
		__DIR__ . '/build/ab-test-block',
	);

	foreach ( $candidates as $candidate ) {
		if ( file_exists( $candidate . '/block.json' ) ) {
			return $candidate;
		}
	}

	return null;
}

function ab_test_block_get_counter_table_name() {
	global $wpdb;
	return $wpdb->prefix . 'ab_test_block_counters';
}

function ab_test_block_get_counter_lock_name( $post_id, $resource_key ) {
	return 'ab_test_block_counter_' . (int) $post_id . '_' . md5( (string) $resource_key );
}

function ab_test_block_with_counter_lock( $post_id, $resource_key, $callback ) {
	global $wpdb;

	$lock_name = ab_test_block_get_counter_lock_name( $post_id, $resource_key );
	$acquired  = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT GET_LOCK(%s, 5)',
			$lock_name
		)
	);

	if ( 1 !== $acquired ) {
		return new WP_Error( 'counter_lock_timeout', 'Could not acquire the counter lock.', array( 'status' => 503 ) );
	}

	try {
		return $callback();
	} finally {
		$wpdb->get_var(
			$wpdb->prepare(
				'SELECT RELEASE_LOCK(%s)',
				$lock_name
			)
		);
	}
}

function ab_test_block_maybe_install_storage() {
	if ( 'custom-table' !== 'custom-table' ) {
		return;
	}

	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';

	$table_name      = ab_test_block_get_counter_table_name();
	$charset_collate = $wpdb->get_charset_collate();
	$sql             = "CREATE TABLE {$table_name} (
		post_id bigint(20) unsigned NOT NULL,
		resource_key varchar(100) NOT NULL,
		count bigint(20) unsigned NOT NULL DEFAULT 0,
		updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY  (post_id, resource_key)
	) {$charset_collate};";

	dbDelta( $sql );
	$table_exists = $wpdb->get_var(
		$wpdb->prepare(
			'SHOW TABLES LIKE %s',
			$table_name
		)
	);

	if ( $table_name === $table_exists ) {
		update_option( 'ab_test_block_storage_version', '1.0.0' );
	}
}

function ab_test_block_ensure_storage_installed() {
	if ( 'custom-table' === 'custom-table' && '1.0.0' !== get_option( 'ab_test_block_storage_version', '' ) ) {
		ab_test_block_maybe_install_storage();
	}
}

function ab_test_block_load_schema( $schema_name ) {
	$build_dir = ab_test_block_get_build_dir();
	if ( ! $build_dir ) {
		return null;
	}

	$path = $build_dir . '/api-schemas/' . $schema_name . '.schema.json';
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

function ab_test_block_get_public_write_action() {
	return 'create-block/ab-test-block/counter/increment';
}

function ab_test_block_create_public_write_token( $post_id, $resource_key ) {
	$expires_at = time() + (int) ab_test_block_PUBLIC_WRITE_TTL;
	$payload    = array(
		'action'      => ab_test_block_get_public_write_action(),
		'exp'         => $expires_at,
		'postId'      => (int) $post_id,
		'resourceKey' => (string) $resource_key,
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

function ab_test_block_verify_public_write_token( $token, $post_id, $resource_key ) {
	if ( ! is_string( $token ) || '' === $token ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token is missing.',
			array( 'status' => 403 )
		);
	}

	$segments = explode( '.', $token );
	if ( 2 !== count( $segments ) ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token format is invalid.',
			array( 'status' => 403 )
		);
	}

	list( $payload_segment, $signature_segment ) = $segments;
	$expected_signature = ab_test_block_base64url_encode(
		hash_hmac( 'sha256', $payload_segment, wp_salt( 'nonce' ), true )
	);

	if ( ! hash_equals( $expected_signature, $signature_segment ) ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token signature is invalid.',
			array( 'status' => 403 )
		);
	}

	$payload_json = ab_test_block_base64url_decode( $payload_segment );
	if ( false === $payload_json ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token payload is invalid.',
			array( 'status' => 403 )
		);
	}

	$payload = json_decode( $payload_json, true );
	if ( ! is_array( $payload ) ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token payload is invalid.',
			array( 'status' => 403 )
		);
	}

	$expires_at = isset( $payload['exp'] ) ? (int) $payload['exp'] : 0;
	if ( $expires_at < time() ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token has expired. Reload the page and try again.',
			array( 'status' => 403 )
		);
	}

	if ( ab_test_block_get_public_write_action() !== ( isset( $payload['action'] ) ? (string) $payload['action'] : '' ) ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token action is invalid.',
			array( 'status' => 403 )
		);
	}

	if ( (int) $post_id !== (int) ( isset( $payload['postId'] ) ? $payload['postId'] : 0 ) ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token is not valid for this post.',
			array( 'status' => 403 )
		);
	}

	if ( (string) $resource_key !== (string) ( isset( $payload['resourceKey'] ) ? $payload['resourceKey'] : '' ) ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write token is not valid for this resource key.',
			array( 'status' => 403 )
		);
	}

	return true;
}

function ab_test_block_can_write_publicly( WP_REST_Request $request ) {
	$payload = $request->get_json_params();
	if ( ! is_array( $payload ) ) {
		$payload = array();
	}

	$post_id      = isset( $payload['postId'] ) ? (int) $payload['postId'] : 0;
	$resource_key = isset( $payload['resourceKey'] ) ? (string) $payload['resourceKey'] : '';
	$token        = isset( $payload['publicWriteToken'] ) ? (string) $payload['publicWriteToken'] : '';

	if ( '' === $token ) {
		$fallback = $request->get_param( 'publicWriteToken' );
		$token    = is_string( $fallback ) ? $fallback : '';
	}

	if ( $post_id <= 0 || '' === $resource_key ) {
		return new WP_Error(
			'rest_forbidden',
			'The public write request is missing its target identifiers.',
			array( 'status' => 403 )
		);
	}

	return ab_test_block_verify_public_write_token( $token, $post_id, $resource_key );
}

function ab_test_block_get_counter( $post_id, $resource_key ) {
	global $wpdb;

	if ( 'custom-table' === 'custom-table' ) {
		$table_name = ab_test_block_get_counter_table_name();
		$count      = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT count FROM {$table_name} WHERE post_id = %d AND resource_key = %s",
				$post_id,
				$resource_key
			)
		);

		return null === $count ? 0 : (int) $count;
	}

	$meta_key = '_' . 'ab_test_block' . '_counter_' . sanitize_key( $resource_key );
	return (int) get_post_meta( $post_id, $meta_key, true );
}

function ab_test_block_increment_counter( $post_id, $resource_key, $delta ) {
	global $wpdb;

	if ( 'custom-table' === 'custom-table' ) {
		$table_name   = ab_test_block_get_counter_table_name();
		$delta_value  = (int) $delta;
		$insert_count = max( 0, $delta_value );
		$result       = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$table_name} (post_id, resource_key, count, updated_at)
				VALUES (%d, %s, %d, %s)
				ON DUPLICATE KEY UPDATE
					count = GREATEST(0, count + VALUES(count)),
					updated_at = VALUES(updated_at)",
				$post_id,
				$resource_key,
				$insert_count,
				current_time( 'mysql', true )
			)
		);

		if ( false === $result ) {
			return new WP_Error( 'counter_update_failed', 'Failed to update the counter.', array( 'status' => 500 ) );
		}

		return ab_test_block_get_counter( $post_id, $resource_key );
	}

	return ab_test_block_with_counter_lock(
		$post_id,
		$resource_key,
		function() use ( $delta, $post_id, $resource_key ) {
			$meta_key   = '_' . 'ab_test_block' . '_counter_' . sanitize_key( $resource_key );
			$next_count = max( 0, ab_test_block_get_counter( $post_id, $resource_key ) + (int) $delta );
			update_post_meta( $post_id, $meta_key, $next_count );
			return $next_count;
		}
	);
}

function ab_test_block_build_counter_response( $post_id, $resource_key, $count ) {
	return array(
		'postId'      => (int) $post_id,
		'resourceKey' => (string) $resource_key,
		'count'       => (int) $count,
		'storage'     => 'custom-table',
	);
}

function ab_test_block_handle_get_counter( WP_REST_Request $request ) {
	$payload = ab_test_block_validate_and_sanitize_request(
		array(
			'postId'      => $request->get_param( 'postId' ),
			'resourceKey' => $request->get_param( 'resourceKey' ),
		),
		'counter-query',
		'query'
	);

	if ( is_wp_error( $payload ) ) {
		return $payload;
	}

	$count = ab_test_block_get_counter( (int) $payload['postId'], (string) $payload['resourceKey'] );
	return rest_ensure_response(
		ab_test_block_build_counter_response(
			(int) $payload['postId'],
			(string) $payload['resourceKey'],
			$count
		)
	);
}

function ab_test_block_handle_increment_counter( WP_REST_Request $request ) {
	$payload = ab_test_block_validate_and_sanitize_request(
		$request->get_json_params(),
		'increment-request',
		'body'
	);

	if ( is_wp_error( $payload ) ) {
		return $payload;
	}

	$count = ab_test_block_increment_counter(
		(int) $payload['postId'],
		(string) $payload['resourceKey'],
		isset( $payload['delta'] ) ? (int) $payload['delta'] : 1
	);

	if ( is_wp_error( $count ) ) {
		return $count;
	}

	return rest_ensure_response(
		ab_test_block_build_counter_response(
			(int) $payload['postId'],
			(string) $payload['resourceKey'],
			$count
		)
	);
}

function ab_test_block_register_routes() {
	register_rest_route(
		'create-block/v1',
		'/ab-test-block/counter',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'ab_test_block_handle_get_counter',
				'permission_callback' => '__return_true',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'ab_test_block_handle_increment_counter',
				'permission_callback' => 'ab_test_block_can_write_publicly',
			),
		)
	);
}

function ab_test_block_register_block() {
	$build_dir = ab_test_block_get_build_dir();
	if ( ! $build_dir ) {
		return;
	}

	register_block_type( $build_dir );
}

register_activation_hook( __FILE__, 'ab_test_block_maybe_install_storage' );
add_action( 'init', 'ab_test_block_ensure_storage_installed' );
add_action( 'init', 'ab_test_block_register_block' );
add_action( 'rest_api_init', 'ab_test_block_register_routes' );
