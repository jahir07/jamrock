<?php
/**
 * Assessments Controller
 *
 * Provides REST endpoints for listing assessment records with
 * pagination and optional filtering by provider/candidness.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Assessments
 */
class Assessments {


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
			'/assessments',
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
	 * Handle GET /assessments.
	 *
	 * @param \WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function list( \WP_REST_Request $req ) {
		global $wpdb;

		$t = $wpdb->prefix . 'jamrock_assessments';
		$a = $wpdb->prefix . 'jamrock_applicants';

		// Pagination.
		$page_param = (int) $req->get_param( 'page' );
		$page       = ( $page_param > 0 ) ? $page_param : 1;

		$per_param = (int) $req->get_param( 'per_page' );
		if ( $per_param < 1 || $per_param > 100 ) {
			$per_param = 10;
		}
		$per    = $per_param;
		$offset = ( $page - 1 ) * $per;

		// Filters.
		$provider_raw = $req->get_param( 'provider' );
		$provider     = is_string( $provider_raw ) ? sanitize_text_field( $provider_raw ) : '';

		$candid_raw = $req->get_param( 'candidness' );
		$candid     = is_string( $candid_raw ) ? sanitize_text_field( $candid_raw ) : '';

		$where_parts = array( '1=1' );
		$params      = array();

		if ( '' !== $provider ) {
			$where_parts[] = 's.provider = %s';
			$params[]      = $provider;
		}

		if ( '' !== $candid ) {
			$where_parts[] = 's.candidness = %s';
			$params[]      = $candid;
		}

		$where = implode( ' AND ', $where_parts );

		// Total count.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Table/where parts cannot be placeholders; values are still prepared via $params.
		$sql_total = $wpdb->prepare( "SELECT COUNT(*) FROM {$t} s WHERE {$where}", $params );
		$total     = (int) $wpdb->get_var( $sql_total ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		// Rows with JOIN + LIMIT/OFFSET.
		$params_with_paging = array_merge( $params, array( $per, $offset ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Table/where parts cannot be placeholders; values & paging are prepared.
		$sql = $wpdb->prepare(
			"SELECT
				s.id,
				s.provider,
				s.overall_score,
				s.candidness,
				s.completed_at,
				s.created_at,
				ap.first_name,
				ap.last_name,
				ap.email
			FROM {$t} s
			LEFT JOIN {$a} ap ON ap.id = s.applicant_id
			WHERE {$where}
			ORDER BY s.id DESC
			LIMIT %d OFFSET %d",
			$params_with_paging
		);

		$rows = $wpdb->get_results( $sql, ARRAY_A ) ?: array(); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared

		return rest_ensure_response(
			array(
				'items' => $rows,
				'total' => $total,
			)
		);
	}
}
