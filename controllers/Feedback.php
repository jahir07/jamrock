<?php
/**
 * Feedback Controller
 *
 * REST endpoints for listing, updating, and deleting feedback rows.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Feedback
 */
class Feedback {

	/** @var \wpdb */
	private $db;

	/** @var string */
	private $table;

	/**
	 * Ensure $this->db and $this->table are initialized.
	 */
	private function init_db(): void {
		if ( ! $this->db || ! $this->table ) {
			global $wpdb;
			$this->db    = $wpdb;
			$this->table = $wpdb->prefix . 'jamrock_feedback';
		}
	}

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	/**
	 * Register REST routes.
	 *
	 * @return void
	 */
	public function register_rest_routes(): void {

		register_rest_route(
			'jamrock/v1',
			'/feedback',
			array(
				'methods'             => 'GET',
				'permission_callback' => array( $this, 'can_manage' ),
				'callback'            => array( $this, 'list' ),
				'args'                => array(
					'page'     => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
					),
					'per_page' => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
					),
					'q'        => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_text_field',
					),
					'email'    => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_email',
					),
				),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/feedback/(?P<id>\d+)',
			array(
				'methods'             => 'POST',
				'permission_callback' => array( $this, 'can_manage' ),
				'callback'            => array( $this, 'update' ),
				'args'                => array(
					'id' => array(
						'type'     => 'integer',
						'required' => true,
					),
				),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/feedback/(?P<id>\d+)',
			array(
				'methods'             => 'DELETE',
				'permission_callback' => array( $this, 'can_manage' ),
				'callback'            => array( $this, 'delete' ),
				'args'                => array(
					'id' => array(
						'type'     => 'integer',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * Permission: admin-only for now.
	 *
	 * @return bool
	 */
	public function can_manage(): bool {
		return current_user_can( 'manage_options' );
	}

	/**
	 * GET /feedback
	 * Paginated list with optional search by q (subject/message) and email filter.
	 *
	 * @param \WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function list( \WP_REST_Request $req ) {
		global $wpdb;

		$table = $wpdb->prefix . 'jamrock_feedback';

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
		$q_raw = $req->get_param( 'q' );
		$q     = is_string( $q_raw ) ? sanitize_text_field( $q_raw ) : '';

		$email_raw = $req->get_param( 'email' );
		$email     = is_string( $email_raw ) ? sanitize_email( $email_raw ) : '';

		$where_parts = array( '1=1' );
		$params      = array();

		if ( '' !== $q ) {
			$where_parts[] = '(subject LIKE %s OR message LIKE %s)';
			$like          = '%' . $wpdb->esc_like( $q ) . '%';
			$params[]      = $like;
			$params[]      = $like;
		}

		if ( '' !== $email ) {
			$where_parts[] = 'email = %s';
			$params[]      = $email;
		}

		$where = implode( ' AND ', $where_parts );

		// ===== Total count =====
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table/where cannot be placeholders; values are bound via $params.
		$sql_total = $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE {$where}", $params );
		$total     = (int) $wpdb->get_var( $sql_total ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		// ===== Rows =====
		$params_with_paging = array_merge( $params, array( $per, $offset ) );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table/where cannot be placeholders.
		$sql = $wpdb->prepare(
			"SELECT
				id,
				first_name,
				last_name,
				email,
				subject,
				message,
				date_created,
				date_updated
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

	/**
	 * POST /feedback/{id}
	 * Update subject/message for a feedback row.
	 *
	 * @param \WP_REST_Request $req Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function update( \WP_REST_Request $req ) {
		global $wpdb;

		$id = (int) $req->get_param( 'id' );
		if ( $id <= 0 ) {
			return new \WP_Error( 'bad_id', __( 'Invalid ID.', 'jamrock' ), array( 'status' => 400 ) );
		}

		$params  = (array) $req->get_json_params();
		$subject = isset( $params['subject'] ) ? sanitize_text_field( $params['subject'] ) : '';
		$message = isset( $params['message'] ) ? wp_kses_post( $params['message'] ) : '';

		$table = $wpdb->prefix . 'jamrock_feedback';
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$done = $wpdb->update(
			$table,
			array(
				'subject'      => $subject,
				'message'      => $message,
				'date_updated' => current_time( 'mysql' ),
			),
			array( 'id' => $id ),
			array( '%s', '%s', '%s' ),
			array( '%d' )
		);

		if ( false !== $done ) {
			wp_cache_delete( 'feedback_' . $id, 'jamrock' );
		}

		return rest_ensure_response(
			array(
				'updated' => (bool) $done,
			)
		);
	}

	/**
	 * DELETE /feedback/{id}
	 *
	 * @param \WP_REST_Request $req Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function delete( \WP_REST_Request $req ) {
		global $wpdb;

		$id = (int) $req->get_param( 'id' );
		if ( $id <= 0 ) {
			return new \WP_Error( 'bad_id', __( 'Invalid ID.', 'jamrock' ), array( 'status' => 400 ) );
		}

		$table = $wpdb->prefix . 'jamrock_feedback';
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$done = $wpdb->delete( $table, array( 'id' => $id ), array( '%d' ) );

		if ( false !== $done ) {
			wp_cache_delete( 'feedback_' . $id, 'jamrock' );
		}

		return rest_ensure_response(
			array(
				'deleted' => (bool) $done,
			)
		);
	}

	/**
	 * Insert a single feedback row.
	 *
	 * @param string $first_name Person's first name. Required.
	 * @param string $last_name  Person's last name. Required.
	 * @param string $email      Email address. Required.
	 * @param string $subject    Subject line. Required.
	 * @param string $message    Message body. Required.
	 * @return int|\WP_Error Inserted row ID on success, or \WP_Error on failure.
	 */
	public function do_insert( $first_name, $last_name, $email, $subject, $message ) {
		$this->init_db();

		// Bail early if any required field missing.
		if ( empty( $first_name ) || empty( $last_name ) || empty( $email ) || empty( $subject ) || empty( $message ) ) {
			return new \WP_Error( 'missing_fields', __( 'All fields are required.', 'jamrock' ) );
		}

		$data = array(
			'first_name'   => sanitize_text_field( $first_name ),
			'last_name'    => sanitize_text_field( $last_name ),
			'email'        => sanitize_email( $email ),
			'subject'      => sanitize_text_field( $subject ),
			'message'      => wp_kses_post( $message ),
			'date_created' => current_time( 'mysql' ),
			'date_updated' => current_time( 'mysql' ),
		);

		$formats = array( '%s', '%s', '%s', '%s', '%s', '%s', '%s' );

		$inserted = $this->db->insert( $this->table, $data, $formats );

		if ( false === $inserted ) {
			return new \WP_Error(
				'db_insert_error',
				__( 'Could not insert feedback into database.', 'jamrock' )
			);
		}

		return (int) $this->db->insert_id;
	}

	/**
	 * Get feedback results with pagination.
	 *
	 * @param int $items_per_page Number of items per page.
	 * @param int $page           Page number (1-based).
	 * @return array Array of result objects.
	 */
	public function get_results( $items_per_page = 10, $page = 1 ) {
		$this->init_db();

		$items_per_page = absint( $items_per_page );
		$page           = absint( $page );

		if ( $items_per_page < 1 || $page < 1 ) {
			return array();
		}

		$offset  = ( $page - 1 ) * $items_per_page;
		$query   = $this->db->prepare(
			"SELECT * FROM {$this->table} ORDER BY id DESC LIMIT %d, %d",
			$offset,
			$items_per_page
		);
		$results = $this->db->get_results( $query );

		return $results ? $results : array();
	}

	/**
	 * Get a single feedback row by ID.
	 *
	 * @param int $id Feedback entry ID.
	 * @return object|false Feedback object on success, false if not found.
	 */
	public function get_result_by_id( $id ) {
		$this->init_db();

		$id = absint( $id );
		if ( $id < 1 ) {
			return false;
		}

		$query  = $this->db->prepare( "SELECT * FROM {$this->table} WHERE id = %d LIMIT 1", $id );
		$result = $this->db->get_row( $query );

		return $result ? $result : false;
	}

	/**
	 * Count total feedback rows.
	 *
	 * @return int Total row count.
	 */
	public function count_total() {
		$this->init_db();
		$total = $this->db->get_var( "SELECT COUNT(*) FROM {$this->table}" );
		return (int) $total;
	}
}
