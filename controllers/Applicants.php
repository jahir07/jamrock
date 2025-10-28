<?php
/**
 * Applicants Controller
 *
 * Handles REST API routes and logic related to applicants.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Applicants
 *
 * Provides REST endpoints for listing applicants with pagination and filtering.
 */
class Applicants {

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST routes.
	 *
	 * @return void
	 */
	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/applicants',
			array(
				'methods'             => 'GET',
				'permission_callback' => function (): bool {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'list' ),
			)
		);
	}

	/**
	 * Handle GET /applicants request.
	 *
	 * Supports pagination and optional status filtering.
	 *
	 * @param \WP_REST_Request $req REST request object.
	 * @return \WP_REST_Response
	 */
	public function list( \WP_REST_Request $req ) {
		global $wpdb;
		$table = $wpdb->prefix . 'jamrock_applicants';

		$page   = max( 1, (int) $req->get_param( 'page' ) );
		$per    = (int) $req->get_param( 'per_page' );
		$per    = ( $per > 0 && $per <= 100 ) ? $per : 10;
		$offset = ( $page - 1 ) * $per;

		$status = sanitize_text_field( (string) $req->get_param( 'status' ) );

		$where  = '1=1';
		$params = array();

		if ( ! empty( $status ) ) {
			$where    .= ' AND status = %s';
			$params [] = $status;
		}

		// Total count query.
		$sql_total = $wpdb->prepare(
			"SELECT COUNT(*) FROM {$table} WHERE {$where}",
			$params
		);
		$total     = (int) $wpdb->get_var( $sql_total );

		// Row query with placeholders.
		$params_with_limit = array_merge( $params, array( $per, $offset ) );

		$sql_rows = $wpdb->prepare(
			"SELECT id, jamrock_user_id, first_name, last_name, email, phone, status, score_total, created_at, updated_at
			FROM {$table}
			WHERE {$where}
			ORDER BY id DESC
			LIMIT %d OFFSET %d",
			$params_with_limit
		);

		$rows = $wpdb->get_results( $sql_rows, ARRAY_A ) ?: array();

		return rest_ensure_response(
			array(
				'items' => $rows,
				'total' => $total,
			)
		);
	}
}
