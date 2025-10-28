<?php
/**
 * Courses Controller: REST endpoints for Jamrock courses.
 *
 * @package Jamrock
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Courses.
 *
 * Registers REST routes and handlers for listing courses.
 *
 * @since 1.0.0
 */
class Courses {


	/**
	 * Hook into WordPress actions.
	 *
	 * @since 1.0.0
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST API routes.
	 *
	 * @since 1.0.0
	 */
	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/courses',
			array(
				array(
					'methods'             => 'GET',
					'permission_callback' => static function (): bool {
						return current_user_can( 'manage_options' );
					},
					'callback'            => array( $this, 'list' ),
					'args'                => array(
						'page'     => array(
							'description'       => 'Page number.',
							'type'              => 'integer',
							'default'           => 1,
							'minimum'           => 1,
							'sanitize_callback' => 'absint',
						),
						'per_page' => array(
							'description'       => 'Items per page.',
							'type'              => 'integer',
							'default'           => 10,
							'minimum'           => 1,
							'maximum'           => 100,
							'sanitize_callback' => 'absint',
						),
						'status'   => array(
							'description'       => 'Filter by status.',
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
							'validate_callback' => static function ( $value ): bool {
								if ( $value === '' || $value === null ) {
									return true;
								}
								// If you have a known set of statuses, whitelist them here.
								$allowed = array( 'completed', 'in_progress', 'expired' );
								return in_array( $value, $allowed, true );
							},
						),
					),
				),
			)
		);
	}

	/**
	 * List courses with optional status filter and pagination.
	 *
	 * @since 1.0.0
	 *
	 * @param \WP_REST_Request $req REST request.
	 * @return \WP_Error|\WP_REST_Response Response or error.
	 */
	public function list( \WP_REST_Request $req ) {
		global $wpdb;

		$table  = $wpdb->prefix . 'jamrock_courses';
		$page   = max( 1, absint( $req->get_param( 'page' ) ?? 1 ) );
		$per    = min( 100, max( 1, absint( $req->get_param( 'per_page' ) ?? 10 ) ) );
		$offset = ( $page - 1 ) * $per;

		$status = (string) ( $req->get_param( 'status' ) ?? '' );

		// Build WHERE and args without interpolating $where into SQL.
		$where_sql = ' WHERE 1=1';
		$args      = array();

		if ( $status !== '' ) {
			$where_sql .= ' AND status = %s';
			$args[]     = $status;
		}

		// --- Caching keys (simple object cache) to satisfy PHPCS warnings.
		$cache_group     = 'jamrock_courses';
		$cache_key_total = 'total_' . md5( $table . '|' . wp_json_encode( $args ) . '|' . $where_sql );
		$cache_key_rows  = 'rows_' . md5( $table . '|' . wp_json_encode( array_merge( $args, array( $per, $offset ) ) ) . '|' . $where_sql );

		// --- TOTAL COUNT.
		$total = wp_cache_get( $cache_key_total, $cache_group );
		if ( false === $total ) {
			$sql_total = 'SELECT COUNT(*) FROM ' . $table . $where_sql;

			if ( ! empty( $args ) ) {
				// Only prepare if there are placeholders.
				$sql_total = $wpdb->prepare( $sql_total, $args );
			}

			$total = (int) $wpdb->get_var( $sql_total ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- cached below.
			wp_cache_set( $cache_key_total, $total, $cache_group, 60 );
		}

		// --- PAGE RESULTS.
		$rows = wp_cache_get( $cache_key_rows, $cache_group );
		if ( false === $rows ) {
			$sql_items = 'SELECT id, user_id, course_id, status, score, certificate_url, expiry_date, updated_at FROM ' . $table . $where_sql . ' ORDER BY id DESC LIMIT %d OFFSET %d';

			$item_args = array_merge( $args, array( $per, $offset ) );

			// There are always at least two placeholders for LIMIT/OFFSET here.
			$sql_items = $wpdb->prepare( $sql_items, $item_args );

			$rows = $wpdb->get_results( $sql_items, ARRAY_A ) ?: array(); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- cached below.
			wp_cache_set( $cache_key_rows, $rows, $cache_group, 60 );
		}

		// Build response with pagination headers like core.
		$response = rest_ensure_response(
			array(
				'items' => $rows,
			)
		);

		$total_pages = ( $per > 0 ) ? (int) ceil( $total / $per ) : 0;
		$response->header( 'X-WP-Total', (string) $total );
		$response->header( 'X-WP-TotalPages', (string) $total_pages );

		return $response;
	}
}
