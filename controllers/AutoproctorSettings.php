<?php
/**
 * AutoProctor Settings REST (GET/POST)
 *
 * @package Jamrock
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class AutoproctorSettings {


	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/autoproctor/options',
			array(
				'methods'             => 'GET',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'get_options' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/autoproctor/options',
			array(
				'methods'             => 'POST',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'save_options' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/autoproctor/test',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => array( $this, 'test' ),
			)
		);
	}

	public function get_options(): \WP_REST_Response {
		$api_id  = (string) get_option( 'jrj_autoproctor_api_id', '' );
		$api_key = (string) get_option( 'jrj_autoproctor_api_key', '' );
		$def     = (array) get_option(
			'jrj_autoproctor_defaults',
			array(
				'enable' => false,
			)
		);

		// sanitize + normalize
		$out = array(
			'api_id'   => $api_id, // todo will hide later.
			'api_key'  => $api_key,
			'defaults' => array(
				'enable' => ! empty( $def['enable'] ),
			),
		);

		return rest_ensure_response( $out );
	}

	public function save_options( \WP_REST_Request $req ): \WP_REST_Response {
		$body = $req->get_json_params() ?: array();

		$api_id  = sanitize_text_field( $body['api_id'] ?? '' );
		$api_key = sanitize_text_field( $body['api_key'] ?? '' );

		$d        = is_array( $body['defaults'] ?? null ) ? $body['defaults'] : array();
		$defaults = array(
			'enable' => ! empty( $d['enable'] ),
		);

		update_option( 'jrj_autoproctor_api_id', $api_id );
		update_option( 'jrj_autoproctor_api_key', $api_key );
		update_option( 'jrj_autoproctor_defaults', $defaults );

		return rest_ensure_response(
			array(
				'ok'       => true,
				'message'  => 'Saved.',
				'api_id'   => $api_id,
				'api_key'  => $api_key, // todo will hide later.
				'defaults' => $defaults,
			)
		);
	}

	public function test( \WP_REST_Request $req ) {
		$clientId = (string) get_option( 'jrj_autoproctor_api_id', '' );
		$secret   = (string) get_option( 'jrj_autoproctor_api_key', '' );
		if ( ! $clientId || ! $secret ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'missing_client_or_secret',
				),
				400
			);
		}

		// Build a sample testAttemptId and hash (docs: HMAC_SHA256(message=testAttemptId, key=CLIENT_SECRET))
		$testAttemptId       = 'test-' . substr( wp_generate_uuid4(), 0, 12 );
		$hashedTestAttemptId = hash_hmac( 'sha256', $testAttemptId, $secret );

		// Optionally check SDK URL reachable (lightweight HEAD)
		$sdk    = wp_remote_head( 'https://dev.autoproctor.co/sdk/v1/autoproctor.js', array( 'timeout' => 8 ) );
		$sdk_ok = ! is_wp_error( $sdk ) && (int) wp_remote_retrieve_response_code( $sdk ) < 400;

		return rest_ensure_response(
			array(
				'ok'                  => true,
				'clientId'            => $clientId,
				'testAttemptId'       => $testAttemptId,
				'hashedTestAttemptId' => $hashedTestAttemptId,
				'sdk_reachable'       => $sdk_ok,
			)
		);
	}
}
