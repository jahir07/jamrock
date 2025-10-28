<?php
/**
 * Hold Housing controller
 */
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class Housing {

	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}
	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/housing',
			array(
				'methods'             => 'GET',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
				'callback'            => array( $this, 'list' ),
			)
		);
	}
	public function list( \WP_REST_Request $req ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_housing_links';

		$rows = $wpdb->get_results(
			"SELECT id, title, url, visibility_status, updated_at FROM $t ORDER BY id DESC",
			ARRAY_A
		) ?: array();

		return rest_ensure_response(
			array(
				'items' => $rows,
				'total' => count( $rows ),
			)
		);
	}
}
