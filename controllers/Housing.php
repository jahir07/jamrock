<?php
/**
 * Housing Controller.
 * Handles CRUD, status updates, payment extensions, and medical linkage.
 *
 * @package Jamrock
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

use WP_REST_Request;
use WP_Error;

/**
 * Class Housing
 */
class Housing {


	/**
	 * Housing Table name.
	 *
	 * @var string
	 */
	protected $table;

	/**
	 * Medical Table name.
	 *
	 * @var string
	 */
	protected $medical_table;

	/**
	 * Cache group name.
	 *
	 * @var string
	 */
	protected $cache_group = 'jamrock_housing';

	/**
	 * Constructor.
	 */
	public function __construct() {
		global $wpdb;
		$this->table         = $wpdb->prefix . 'jamrock_housing_applications';
		$this->medical_table = $wpdb->prefix . 'jamrock_medical_affidavits';
	}

	/**
	 * Register API hooks.
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST routes.
	 */
	public function routes(): void {
		// 1. Get Current User Application (Cached).
		register_rest_route(
			'jamrock/v1',
			'/housing/current',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return is_user_logged_in();
				},
				'callback'            => array( $this, 'housing_get_current' ),
			)
		);

		// 2. Submit Application.
		register_rest_route(
			'jamrock/v1',
			'/housing/apply',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return is_user_logged_in();
				},
				'callback'            => array( $this, 'housing_handle_apply' ),
			)
		);

		// 3. Submit Verification.
		register_rest_route(
			'jamrock/v1',
			'/housing/verify',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return is_user_logged_in();
				},
				'callback'            => array( $this, 'housing_handle_verify' ),
			)
		);

		// 4. Admin: List Applicants.
		register_rest_route(
			'jamrock/v1',
			'/housing/applicants',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'housing_list' ),
			)
		);

		// 5. Admin: Get Single Applicant (Cached).
		register_rest_route(
			'jamrock/v1',
			'/housing/applicants/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'housing_get_one' ),
			)
		);

		// 6. Admin: Update Status.
		register_rest_route(
			'jamrock/v1',
			'/housing/applicants/(?P<id>\d+)',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'housing_update' ),
				'args'                => array(
					'status' => array( 'required' => true ),
				),
			)
		);

		// 7. Admin: Payment Extension.
		register_rest_route(
			'jamrock/v1',
			'/housing/applicants/(?P<id>\d+)/extension',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'update_payment_extension' ),
			)
		);

		// 8. Admin: Get Linked Medical Data.
		register_rest_route(
			'jamrock/v1',
			'/housing/applicants/(?P<id>\d+)/medical',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'get_linked_medical' ),
			)
		);

		// 9. Admin: Update Medical Clearance Status.
		register_rest_route(
			'jamrock/v1',
			'/housing/medical/(?P<med_id>\d+)/status',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'update_medical_status' ),
			)
		);
	}

	/**
	 * Helper: Get cached housing row by Applicant ID.
	 *
	 * @param int $applicant_id User ID.
	 * @return array|null Row data or null.
	 */
	protected function get_cached_by_user( $applicant_id ) {
		$cache_key = 'housing_user_' . $applicant_id;
		$row       = wp_cache_get( $cache_key, $this->cache_group );

		if ( false === $row ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$row = $wpdb->get_row(
				$wpdb->prepare(
					"SELECT * FROM {$this->table} WHERE applicant_id = %d ORDER BY created_at DESC LIMIT 1",
					$applicant_id
				),
				ARRAY_A
			);
			wp_cache_set( $cache_key, $row, $this->cache_group, 3600 );
		}
		return $row;
	}

	/**
	 * Helper: Get cached housing row by Row ID.
	 *
	 * @param int $id Row ID.
	 * @return array|null Row data or null.
	 */
	protected function get_cached_by_id( $id ) {
		$cache_key = 'housing_id_' . $id;
		$row       = wp_cache_get( $cache_key, $this->cache_group );

		if ( false === $row ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$row = $wpdb->get_row(
				$wpdb->prepare( "SELECT * FROM {$this->table} WHERE id = %d", $id ),
				ARRAY_A
			);
			wp_cache_set( $cache_key, $row, $this->cache_group, 3600 );
		}
		return $row;
	}

	/**
	 * Helper: Flush cache.
	 *
	 * @param int      $id Row ID.
	 * @param int|null $applicant_id User ID (optional).
	 */
	protected function flush_cache( $id, $applicant_id = null ) {
		wp_cache_delete( 'housing_id_' . $id, $this->cache_group );
		if ( $applicant_id ) {
			wp_cache_delete( 'housing_user_' . $applicant_id, $this->cache_group );
		}
	}

	/**
	 * Get Current User's Application.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function housing_get_current( $req ) {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return rest_ensure_response( array( 'ok' => false ), 403 );
		}

		$row = $this->get_cached_by_user( $user_id );

		if ( $row ) {
			$row['for_rental']       = ! empty( $row['for_rental'] ) ? json_decode( $row['for_rental'], true ) : null;
			$row['for_verification'] = ! empty( $row['for_verification'] ) ? json_decode( $row['for_verification'], true ) : null;
		}

		return rest_ensure_response(
			array(
				'ok'          => true,
				'application' => $row,
			)
		);
	}

	/**
	 * Handle Apply (Submit/Update).
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function housing_handle_apply( WP_REST_Request $req ) {
		global $wpdb;
		$user_id = get_current_user_id();

		// Basic Inputs.
		$full_name    = sanitize_text_field( $req->get_param( 'full_name' ) );
		$phone        = sanitize_text_field( $req->get_param( 'phone' ) );
		$move_in_date = sanitize_text_field( $req->get_param( 'move_in_date' ) );

		// File Uploads.
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$files                = $req->get_file_params();
		$uploaded_id_url      = $this->handle_upload( $files, 'id_file' );
		$uploaded_capture_url = $this->handle_upload( $files, 'id_photo_capture' );
		$uploaded_proof_url   = $this->handle_upload( $files, 'proof_file' );

		// JSON Data.
		$rental_data = array(
			'address_line1' => sanitize_text_field( $req->get_param( 'address_line1' ) ),
			'city'          => sanitize_text_field( $req->get_param( 'city' ) ),
			'state'         => sanitize_text_field( $req->get_param( 'state' ) ),
			'zip'           => sanitize_text_field( $req->get_param( 'zip' ) ),
		);
		$for_rental  = wp_json_encode( $rental_data );

		$existing = $this->get_cached_by_user( $user_id );

		$data = array(
			'applicant_id'           => $user_id,
			'need_housing'           => 'yes',
			'full_name'              => $full_name,
			'phone'                  => $phone,
			'move_in_date'           => $move_in_date,
			'id_file_url'            => $uploaded_id_url ?: ( $existing['id_file_url'] ?? null ),
			'id_photo_capture_url'   => $uploaded_capture_url ?: ( $existing['id_photo_capture_url'] ?? null ),
			'verification_proof_url' => $uploaded_proof_url ?: ( $existing['verification_proof_url'] ?? null ),
			'for_rental'             => $for_rental,
			'status'                 => 'pending',
			'updated_at'             => current_time( 'mysql' ),
		);

		if ( $existing ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->update( $this->table, $data, array( 'id' => $existing['id'] ) );
			$id = $existing['id'];
		} else {
			$data['created_at'] = current_time( 'mysql' );
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->insert( $this->table, $data );
			$id = $wpdb->insert_id;
		}

		$this->flush_cache( $id, $user_id );

		return rest_ensure_response(
			array(
				'ok' => true,
				'id' => $id,
			)
		);
	}

	/**
	 * Handle Verification.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function housing_handle_verify( WP_REST_Request $req ) {
		global $wpdb;
		$user_id = get_current_user_id();

		$provider_name = sanitize_text_field( $req->get_param( 'provider_name' ) );
		if ( empty( $provider_name ) ) {
			return new WP_Error( 'missing_provider', 'Provider Name required', array( 'status' => 400 ) );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		$files              = $req->get_file_params();
		$uploaded_proof_url = $this->handle_upload( $files, 'proof_file' );

		$verify_data = array(
			'provider_name'  => $provider_name,
			'provider_email' => sanitize_email( $req->get_param( 'provider_email' ) ),
			'notes'          => sanitize_textarea_field( $req->get_param( 'notes' ) ),
		);

		$existing = $this->get_cached_by_user( $user_id );

		$data = array(
			'applicant_id'           => $user_id,
			'need_housing'           => 'no',
			'verification_proof_url' => $uploaded_proof_url ?: ( $existing['verification_proof_url'] ?? null ),
			'for_verification'       => wp_json_encode( $verify_data ),
			'status'                 => 'pending',
			'updated_at'             => current_time( 'mysql' ),
		);

		if ( $existing ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->update( $this->table, $data, array( 'id' => $existing['id'] ) );
			$id = $existing['id'];
		} else {
			$data['created_at'] = current_time( 'mysql' );
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->insert( $this->table, $data );
			$id = $wpdb->insert_id;
		}

		$this->flush_cache( $id, $user_id );

		return rest_ensure_response(
			array(
				'ok' => true,
				'id' => $id,
			)
		);
	}

	/**
	 * Admin: Get List (Paginated).
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function housing_list( WP_REST_Request $req ) {
		global $wpdb;

		$page   = max( 1, intval( $req->get_param( 'page' ) ) );
		$per    = max( 1, intval( $req->get_param( 'per_page' ) ) );
		$status = sanitize_text_field( $req->get_param( 'status' ) );
		$offset = ( $page - 1 ) * $per;

		$where = '1=1';
		$args  = array();

		if ( $status ) {
			$where .= ' AND h.status = %s';
			$args[] = $status;
		}

		// Prepare SQL for items.
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$sql = "SELECT h.*, u.display_name AS name, u.user_email AS email
                FROM {$this->table} h
                LEFT JOIN {$wpdb->users} u ON u.ID = h.applicant_id
                WHERE {$where}
                ORDER BY h.created_at DESC
                LIMIT %d OFFSET %d";

		$args[] = $per;
		$args[] = $offset;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $args ) );

		// Count total (simplified).
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery
		$count_sql = "SELECT COUNT(*) FROM {$this->table} h WHERE {$where}";
		if ( count( $args ) > 2 ) {
			array_pop( $args ); // remove offset
			array_pop( $args ); // remove limit
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$total = $wpdb->get_var( $wpdb->prepare( $count_sql, $args ) );

		return rest_ensure_response(
			array(
				'ok'    => true,
				'items' => $rows,
				'total' => (int) $total,
			)
		);
	}

	/**
	 * Admin: Get One.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function housing_get_one( WP_REST_Request $req ) {
		$id = intval( $req->get_param( 'id' ) );
		global $wpdb;

		// We need joined user data, so manual query instead of simple cache helper.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT h.*, u.display_name AS name, u.user_email AS email
                 FROM {$this->table} h
                 LEFT JOIN {$wpdb->users} u ON u.ID = h.applicant_id
                 WHERE h.id = %d",
				$id
			),
			ARRAY_A
		);

		if ( ! $row ) {
			return new WP_Error( 'not_found', 'Application not found', array( 'status' => 404 ) );
		}

		return rest_ensure_response(
			array(
				'ok'   => true,
				'item' => $row,
			)
		);
	}

	/**
	 * Admin: Update Status.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function housing_update( WP_REST_Request $req ) {
		global $wpdb;
		$id     = intval( $req->get_param( 'id' ) );
		$status = sanitize_text_field( $req->get_param( 'status' ) );
		$reason = sanitize_textarea_field( $req->get_param( 'rejection_reason' ) );

		if ( ! in_array( $status, array( 'approved', 'rejected', 'in_progress' ), true ) ) {
			return new WP_Error( 'invalid_status', 'Invalid status', array( 'status' => 400 ) );
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$wpdb->update(
			$this->table,
			array(
				'status'           => $status,
				'rejection_reason' => $reason,
				'updated_at'       => current_time( 'mysql' ),
			),
			array( 'id' => $id )
		);

		// Get applicant ID for cache flushing.
		$row = $this->get_cached_by_id( $id );
		if ( $row ) {
			$this->flush_cache( $id, $row['applicant_id'] );
			// Optional: Send Email Here.
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Admin: Update Payment Extension.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_payment_extension( WP_REST_Request $req ) {
		global $wpdb;
		$id = intval( $req->get_param( 'id' ) ); // Applicant ID from Route.

		// Find row via Applicant ID (NOT row ID).
		$row = $this->get_cached_by_user( $id );

		if ( ! $row ) {
			return new WP_Error( 'not_found', 'Housing Application not found for this user', array( 'status' => 404 ) );
		}

		// Clean Inputs.
		$enable         	  		= $req->get_param( 'enable' );
		$show_candidate         	= $req->get_param( 'show_candidate' );

		$extended_until = sanitize_text_field( $req->get_param( 'extended_until' ) );
		$notes          = sanitize_textarea_field( $req->get_param( 'note' ) );
		$status 		= sanitize_text_field($req->get_param('status'));
		$fields_raw     = $req->get_param( 'fields_json' );

		// Decode Fields JSON if string.
		$fields_json = is_string( $fields_raw ) ? json_decode( stripslashes( $fields_raw ), true ) : $fields_raw;

		// Merge with existing.
		$existing_ext = ! empty( $row['payment_extension'] ) ? json_decode( $row['payment_extension'], true ) : array();
		if ( ! is_array( $existing_ext ) ) {
			$existing_ext = array();
		}

		$new_ext = array_merge(
			$existing_ext,
			array(
				'show_candidate' 	=> $show_candidate,
				'extended_until'    => $extended_until,
				'notes'             => $notes,
				'status' 			=> $status,
				'fields_json'       => $fields_json,
				'updated_at'        => current_time( 'mysql' ),
			)
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$wpdb->update(
			$this->table,
			array(
				'extension_enabled' => $enable, // main table field.
				'payment_extension' => wp_json_encode( $new_ext ),
				'updated_at'        => current_time( 'mysql' ),
			),
			array( 'id' => $row['id'] )
		);

		$this->flush_cache( $row['id'], $id );

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Admin: Get Linked Medical Data.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_linked_medical( WP_REST_Request $req ) {
		$housing_id = intval( $req->get_param( 'id' ) );
		global $wpdb;

		// Get Applicant ID.
		$housing = $this->get_cached_by_id( $housing_id );
		if ( ! $housing ) {
			return new WP_Error( 'not_found', 'Housing not found', array( 'status' => 404 ) );
		}

		// Get Medical Row.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$med_row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$this->medical_table} WHERE applicant_id = %d ORDER BY created_at DESC LIMIT 1",
				$housing['applicant_id']
			),
			ARRAY_A
		);

		if ( $med_row && ! empty( $med_row['details'] ) ) {
			$med_row['details'] = json_decode( $med_row['details'], true );
		}

		return rest_ensure_response(
			array(
				'ok'   => true,
				'item' => $med_row,
			)
		);
	}

	/**
	 * Admin: Update Medical Status.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_medical_status( WP_REST_Request $req ) {
		global $wpdb;
		$med_id = intval( $req->get_param( 'med_id' ) );
		$status = sanitize_text_field( $req->get_param( 'status' ) );

		if ( ! in_array( $status, array( 'approved', 'rejected' ), true ) ) {
			return new WP_Error( 'invalid_status', 'Status must be approved or rejected', array( 'status' => 400 ) );
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$updated = $wpdb->update(
			$this->medical_table,
			array(
				'medical_clearance_status' => $status,
				'updated_at'               => current_time( 'mysql' ),
			),
			array( 'id' => $med_id )
		);

		if ( false === $updated ) {
			return new WP_Error( 'db_error', 'Update failed', array( 'status' => 500 ) );
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Helper: Handle File Upload.
	 *
	 * @param array  $files Files array.
	 * @param string $key Key name.
	 * @return string|null URL.
	 */
	private function handle_upload( $files, $key ) {
		if ( empty( $files[ $key ] ) || empty( $files[ $key ]['tmp_name'] ) ) {
			return null;
		}
		$upload = wp_handle_upload( $files[ $key ], array( 'test_form' => false ) );
		return ! empty( $upload['url'] ) ? esc_url_raw( $upload['url'] ) : null;
	}
}
