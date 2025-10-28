<?php
/**
 * Logs Controller
 *
 * Provides REST endpoints for listing Jamrock log entries with
 * pagination and optional filtering.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Logs
 *
 * Registers routes and handlers for /logs.
 */
class Logs {


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
			'/logs',
			array(
				'methods'             => 'GET',
				'permission_callback' => function (): bool {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'list' ),
				'args'                => array(
					'page'      => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
						'validate_callback' => function ( $value ) {
							return $value === null || ( is_numeric( $value ) && (int) $value >= 1 );
						},
					),
					'per_page'  => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
						'validate_callback' => function ( $value ) {
							return $value === null || ( is_numeric( $value ) && (int) $value >= 1 && (int) $value <= 100 );
						},
					),
					'event'     => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'date_from' => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'date_to'   => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
				),
			)
		);
	}

	/**
	 * Handle GET /logs.
	 *
	 * Supports pagination and filtering by event and date range.
	 *
	 * @param \WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function list( \WP_REST_Request $req ) {
		global $wpdb;

		$table = $wpdb->prefix . 'jamrock_logs';

		// Pagination (no short ternary; explicit validation).
		$page_param = (int) $req->get_param( 'page' );
		$page       = ( $page_param >= 1 ) ? $page_param : 1;

		$per_param = (int) $req->get_param( 'per_page' );
		if ( $per_param < 1 || $per_param > 100 ) {
			$per_param = 20;
		}
		$per    = $per_param;
		$offset = ( $page - 1 ) * $per;

		// Filters.
		$event_raw = $req->get_param( 'event' );
		$event     = is_string( $event_raw ) ? sanitize_text_field( $event_raw ) : '';

		$date_from_raw = $req->get_param( 'date_from' );
		$date_from     = is_string( $date_from_raw ) ? sanitize_text_field( $date_from_raw ) : '';

		$date_to_raw = $req->get_param( 'date_to' );
		$date_to     = is_string( $date_to_raw ) ? sanitize_text_field( $date_to_raw ) : '';

		$where_parts = array( '1=1' );
		$params      = array();

		if ( '' !== $event ) {
			$where_parts[] = 'event = %s';
			$params[]      = $event;
		}

		// Simple date filtering; expects MySQL DATETIME in created_at.
		if ( '' !== $date_from ) {
			$where_parts[] = 'created_at >= %s';
			$params[]      = $date_from;
		}
		if ( '' !== $date_to ) {
			$where_parts[] = 'created_at <= %s';
			$params[]      = $date_to;
		}

		$where = implode( ' AND ', $where_parts );

		// ===== Total count =====
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Table/where cannot be placeholders; values are prepared via $params.
		$sql_total = $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE {$where}", $params );
		$total     = (int) $wpdb->get_var( $sql_total ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		// ===== Rows =====
		$params_with_paging = array_merge( $params, array( $per, $offset ) );

		/**
		 * Note on JSON fields:
		 * - If MySQL supports JSON_* functions, the CASE/JSON_EXTRACT below returns the full payload as JSON.
		 * - Otherwise, payload_json column (TEXT) can be read as-is from application code.
		 */
        // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Table/where cannot be placeholders.
		$sql = $wpdb->prepare(
			"SELECT
				id,
				event,
				result,
				created_at,
				CASE
					WHEN JSON_VALID(payload_json)
					THEN JSON_EXTRACT(payload_json, '$')
					ELSE NULL
				END AS payload_json
			FROM {$table}
			WHERE {$where}
			ORDER BY id DESC
			LIMIT %d OFFSET %d",
			$params_with_paging
		);

		$rows = $wpdb->get_results( $sql, ARRAY_A ) ?: array(); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		return rest_ensure_response(
			array(
				'items'    => $rows,
				'total'    => $total,
				'page'     => $page,
				'per_page' => $per,
			)
		);
	}
}
