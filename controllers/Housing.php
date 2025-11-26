<?php
/**
 * Housing controller (CRUD + toggle + validate)
 */
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class of Housing
 */
class Housing {


	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/housing/current',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return is_user_logged_in(); },
				'callback'            => array( $this, 'housing_get_current' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing/apply',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return is_user_logged_in(); },
				'callback'            => array( $this, 'housing_handle_apply' ),
				'args'                => array(),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing/verify',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return is_user_logged_in();
				},
				'callback'            => array( $this, 'housing_handle_verify' ),
				'args'                => array(),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing/(?P<id>\d+)/status',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' ); }, // change capability to suit recruiters
				'callback'            => array( $this, 'housing_update_status' ),
				'args'                => array(
					'status' => array(
						'required'          => true,
						'validate_callback' => function ( $v ) {
							return in_array( $v, array( 'pending', 'approved', 'rejected' ) ); },
					),
					'note'   => array( 'required' => false ),
				),
			)
		);

		// backend.
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
					'status'           => array( 'required' => true ),
					'rejection_reason' => array( 'required' => false ),
				),
			)
		);

		// payment extention
		register_rest_route(
			'jamrock/v1',
			'/housing/applicants/(?P<id>\d+)/extension',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					// Only managers/admin can do this
					return current_user_can( 'manage_options' ) || current_user_can( 'edit_users' );
				},
				'callback'            => array( $this, 'update_payment_extension' ),
			)
		);
	}


	public function housing_get_current( $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';

		$user = wp_get_current_user();
		if ( ! $user || ! $user->ID ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'not_logged_in',
				),
				403
			);
		}

		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$tbl} WHERE applicant_id = %d ORDER BY created_at DESC LIMIT 1",
				$user->ID
			),
			ARRAY_A
		);

		if ( ! $row ) {
			return rest_ensure_response(
				array(
					'ok'          => true,
					'application' => null,
				)
			);
		}

		// cast JSON columns back to arrays if stored
		if ( isset( $row['for_rental'] ) && $row['for_rental'] ) {
			$row['for_rental'] = json_decode( $row['for_rental'], true );
		}
		if ( isset( $row['for_verification'] ) && $row['for_verification'] ) {
			$row['for_verification'] = json_decode( $row['for_verification'], true );
		}

		return rest_ensure_response(
			array(
				'ok'          => true,
				'application' => $row,
			)
		);
	}


	/**
	 * Apply housing.
	 *
	 * @param \WP_REST_Request $req REST request.
	 * @return \WP_Error|\WP_REST_Response Response or error.
	 */
	public function housing_handle_apply( \WP_REST_Request $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';

		$user = wp_get_current_user();
		if ( ! $user || ! $user->ID ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'not_logged_in',
				),
				403
			);
		}

		// get params
		$need = $req->get_param( 'need_housing' ) ?: $req->get_param( 'need' ) ?: 'yes';
		$need = in_array( $need, array( 'yes', 'no' ) ) ? $need : 'yes';

		// basic common fields
		$full_name    = sanitize_text_field( $req->get_param( 'full_name' ) ?: '' );
		$phone        = sanitize_text_field( $req->get_param( 'phone' ) ?: '' );
		$move_in_date = $req->get_param( 'move_in_date' ) ? sanitize_text_field( $req->get_param( 'move_in_date' ) ) : null;

		// files: use file params (works with FormData from browser)
		// require WP file functions
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$uploaded_id_url      = null;
		$uploaded_capture_url = null;
		$uploaded_proof_url   = null;

		// helper to handle single uploaded file from $req->get_file_params()
		$files = $req->get_file_params(); // associative array
		if ( ! empty( $files['id_file'] ) && isset( $files['id_file']['tmp_name'] ) ) {
			$file = $files['id_file'];
			$move = wp_handle_upload( $file, array( 'test_form' => false ) );
			if ( ! empty( $move['url'] ) ) {
				$uploaded_id_url = esc_url_raw( $move['url'] );
			}
		}
		if ( ! empty( $files['id_photo_capture'] ) && isset( $files['id_photo_capture']['tmp_name'] ) ) {
			$file = $files['id_photo_capture'];
			$move = wp_handle_upload( $file, array( 'test_form' => false ) );
			if ( ! empty( $move['url'] ) ) {
				$uploaded_capture_url = esc_url_raw( $move['url'] );
			}
		}
		if ( ! empty( $files['proof_file'] ) && isset( $files['proof_file']['tmp_name'] ) ) {
			$file = $files['proof_file'];
			$move = wp_handle_upload( $file, array( 'test_form' => false ) );
			if ( ! empty( $move['url'] ) ) {
				$uploaded_proof_url = esc_url_raw( $move['url'] );
			}
		}

		// prepare JSON blobs
		$for_rental       = null;
		$for_verification = null;

		$rental = array(
			'gender'            => sanitize_text_field( $req->get_param( 'gender' ) ?: '' ),
			'date_of_birth'     => sanitize_text_field( $req->get_param( 'date_of_birth' ) ?: '' ),
			'address_line1'     => sanitize_text_field( $req->get_param( 'address_line1' ) ?: '' ),
			'address_line2'     => sanitize_text_field( $req->get_param( 'address_line2' ) ?: '' ),
			'city'              => sanitize_text_field( $req->get_param( 'city' ) ?: '' ),
			'state'             => sanitize_text_field( $req->get_param( 'state' ) ?: '' ),
			'zip'               => sanitize_text_field( $req->get_param( 'zip' ) ?: '' ),
			'prior_turbotenant' => sanitize_text_field( $req->get_param( 'prior_turbotenant' ) ?: '' ),
			// add anything else you want to keep
		);
		$for_rental = wp_json_encode( $rental );

		// additional top-level rental columns
		$emergency_name  = sanitize_text_field( $req->get_param( 'emergency_name' ) ?: '' );
		$emergency_phone = sanitize_text_field( $req->get_param( 'emergency_phone' ) ?: '' );

		$now = current_time( 'mysql' );

		$existing = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$tbl} WHERE applicant_id = %d LIMIT 1",
				intval( $user->ID )
			)
		);

		if ( $existing ) {
			// update existing row
			$update = array(
				'need_housing'           => 'yes',
				'full_name'              => $full_name ?: null,
				'phone'                  => $phone ?: null,
				'move_in_date'           => $move_in_date ?: null,
				'emergency_name'         => $emergency_name ?: null,
				'emergency_phone'        => $emergency_phone ?: null,
				'id_file_url'            => $uploaded_id_url ?: $existing->id_file_url, // keep old if no new
				'id_photo_capture_url'   => $uploaded_capture_url ?: $existing->id_photo_capture_url,
				'verification_proof_url' => $uploaded_proof_url ?: $existing->verification_proof_url,
				'status'             	 => 'pending',
				'for_rental' 			 => $for_rental,
				'for_verification'       => $for_verification,
				'updated_at'             => current_time( 'mysql' ),
			);

			$where   = array( 'id' => intval( $existing->id ) );
			$updated = $wpdb->update( $tbl, $update, $where );

			if ( $updated === false ) {
				return rest_ensure_response(
					array(
						'ok'    => false,
						'error' => 'db_update_failed',
					),
					500
				);
			}

			return rest_ensure_response(
				array(
					'ok'     => true,
					'id'     => $existing->id,
					'action' => 'updated',
				)
			);
		} else {

			$insert = array(
				'applicant_id'           => intval( $user->ID ),
				'need_housing'           => 'yes',
				'full_name'              => $full_name ?: null,
				'phone'                  => $phone ?: null,
				'move_in_date'           => $move_in_date ?: null,
				'emergency_name'         => $emergency_name ?: null,
				'emergency_phone'        => $emergency_phone ?: null,
				'id_file_url'            => $uploaded_id_url ?: null,
				'id_photo_capture_url'   => $uploaded_capture_url ?: null,
				'verification_proof_url' => $uploaded_proof_url ?: null,
				'for_rental'             => $for_rental,
				'for_verification'       => $for_verification,
				'status'                 => 'pending',
				'created_at'             => $now,
			);

			$ok = $wpdb->insert(
				$tbl,
				$insert,
				array(
					'%d',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
					'%s',
				)
			);

			if ( false === $ok ) {
				return rest_ensure_response(
					array(
						'ok'    => false,
						'error' => 'db_insert_failed',
						'wpdb'  => $wpdb->last_error,
					),
					500
				);
			}

			$new_id = $wpdb->insert_id;

			return rest_ensure_response(
				array(
					'ok' => true,
					'id' => $new_id,
				)
			);
		}
	}


	/**
	 * Verify of housing_handle_verify
	 *
	 * @param \WP_REST_Request $req
	 * @return \WP_Error|\WP_REST_Response Response or error.
	 */
	public function housing_handle_verify( \WP_REST_Request $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';

		$user = wp_get_current_user();
		if ( ! $user || ! $user->ID ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'not_logged_in',
				),
				403
			);
		}

		// require wp file upload helpers
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		// =============================
		// 1. VALIDATION
		// =============================
		$provider_name  = sanitize_text_field( $req->get_param( 'provider_name' ) ?: '' );
		$provider_email = sanitize_email( $req->get_param( 'provider_email' ) ?: '' );
		$provider_phone = sanitize_text_field( $req->get_param( 'provider_phone' ) ?: '' );
		$proof_type     = sanitize_text_field( $req->get_param( 'proof_type' ) ?: '' );

		if ( empty( $provider_name ) ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'missing_provider_name',
				),
				400
			);
		}

		// =============================
		// 2. FILE UPLOAD
		// =============================
		$uploaded_proof_url = null;
		$files              = $req->get_file_params();

		if ( ! empty( $files['proof_file'] ) && isset( $files['proof_file']['tmp_name'] ) ) {
			$move = wp_handle_upload( $files['proof_file'], array( 'test_form' => false ) );
			if ( ! empty( $move['url'] ) ) {
				$uploaded_proof_url = esc_url_raw( $move['url'] );
			}
		}

		// =============================
		// 3. BUILD VERIFICATION JSON
		// =============================
		$ver = array(
			'provider_name'  => $provider_name,
			'provider_email' => $provider_email,
			'provider_phone' => $provider_phone,
			'proof_type'     => $proof_type,
			'address_line1'  => sanitize_text_field( $req->get_param( 'address_line1' ) ?: '' ),
			'address_line2'  => sanitize_text_field( $req->get_param( 'address_line2' ) ?: '' ),
			'city'           => sanitize_text_field( $req->get_param( 'city' ) ?: '' ),
			'state'          => sanitize_text_field( $req->get_param( 'state' ) ?: '' ),
			'zip'            => sanitize_text_field( $req->get_param( 'zip' ) ?: '' ),
			'notes'          => sanitize_text_field( $req->get_param( 'notes' ) ?: '' ),
		);

		$for_verification = wp_json_encode( $ver );

		// =============================
		// 4. INSERT INTO DB
		// =============================
		$now = current_time( 'mysql' );

		$insert = array(
			'applicant_id'           => intval( $user->ID ),
			'need_housing'           => 'no',
			'full_name'              => null,
			'phone'                  => null,
			'move_in_date'           => null,
			'emergency_name'         => null,
			'emergency_phone'        => null,
			'id_file_url'            => null,
			'id_photo_capture_url'   => null,
			'verification_proof_url' => $uploaded_proof_url ?: null,
			'for_rental'             => null,
			'for_verification'       => $for_verification,
			'status'                 => 'pending',
			'created_at'             => $now,
		);

		$update = array(
			'applicant_id'           => intval( $user->ID ),
			'need_housing'           => 'no',
			'full_name'              => null,
			'phone'                  => null,
			'move_in_date'           => null,
			'emergency_name'         => null,
			'emergency_phone'        => null,
			'id_file_url'            => null,
			'id_photo_capture_url'   => null,
			'verification_proof_url' => $uploaded_proof_url ?: null,
			'for_rental'             => null,
			'for_verification'       => $for_verification,
			'status'                 => 'pending',
			'updated_at'             => $now,
		);

		$existing = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM {$tbl} WHERE applicant_id = %d LIMIT 1",
				intval( $user->ID )
			)
		);

		if ( $existing ) {
			// update existing row
			$where   = array( 'id' => intval( $existing->id ) );
			$updated = $wpdb->update( $tbl, $update, $where );

			if ( $updated === false ) {
				return rest_ensure_response(
					array(
						'ok'    => false,
						'error' => 'db_update_failed',
					),
					500
				);
			}

			return rest_ensure_response(
				array(
					'ok'     => true,
					'id'     => $existing->id,
					'action' => 'updated',
				)
			);
		} else {

			$wpdb->insert( $tbl, $insert );

			if ( ! $wpdb->insert_id ) {
				return rest_ensure_response(
					array(
						'ok'    => false,
						'error' => 'db_insert_failed',
					),
					500
				);
			}

			return rest_ensure_response(
				array(
					'ok'      => true,
					'id'      => $wpdb->insert_id,
					'message' => 'Verification submitted successfully.',
				),
				200
			);
		}
	}

	public function housing_update_status( $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';

		if ( ! current_user_can( 'manage_options' ) ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'forbidden',
				),
				403
			);
		}

		$id     = intval( $req->get_param( 'id' ) );
		$status = sanitize_text_field( $req->get_param( 'status' ) );
		if ( ! in_array( $status, array( 'pending', 'approved', 'rejected' ) ) ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'invalid_status',
				),
				400
			);
		}
		$note = sanitize_text_field( $req->get_param( 'note' ) ?: '' );

		$updated = $wpdb->update(
			$tbl,
			array(
				'status'     => $status,
				'updated_at' => current_time( 'mysql' ),
			),
			array( 'id' => $id )
		);
		if ( $updated === false ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'db_update_failed',
				),
				500
			);
		}

		// Optional: send notification to applicant (wp_mail) - skipped here but recommended.

		return rest_ensure_response(
			array(
				'ok'     => true,
				'id'     => $id,
				'status' => $status,
			)
		);
	}


	/**
	 * GET list with pagination
	 */
	public function housing_list( \WP_REST_Request $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';

		$page   = max( 1, intval( $req->get_param( 'page' ) ?: 1 ) );
		$per    = max( 1, intval( $req->get_param( 'per_page' ) ?: 20 ) );
		$status = $req->get_param( 'status' ) ? sanitize_text_field( $req->get_param( 'status' ) ) : '';

		// where
		if ( $status ) {
			$where_sql = $wpdb->prepare( 'WHERE status = %s', $status );
		} else {
			$where_sql = '';
		}

		$offset = ( $page - 1 ) * $per;

		// get rows
		$sql = $wpdb->prepare(
			"SELECT h.*, u.display_name AS name, u.user_email AS email
         FROM {$tbl} h
         LEFT JOIN {$wpdb->users} u ON u.ID = h.applicant_id
         {$where_sql}
         ORDER BY h.created_at DESC
         LIMIT %d OFFSET %d",
			$per,
			$offset
		);

		// if where_sql had a placeholder, $wpdb->prepare above may be wrong due to double prepare;
		// Next: safer approach — handle where separately:
		if ( $status ) {
			// rebuild with correct prepare placeholder usage
			$sql   = $wpdb->prepare(
				"SELECT h.*, u.display_name AS name, u.user_email AS email
             FROM {$tbl} h
             LEFT JOIN {$wpdb->users} u ON u.ID = h.applicant_id
             WHERE h.status = %s
             ORDER BY h.created_at DESC
             LIMIT %d OFFSET %d",
				$status,
				$per,
				$offset
			);
			$total = $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$tbl} WHERE status = %s", $status ) );
		} else {
			$sql   = $wpdb->prepare(
				"SELECT h.*, u.display_name AS name, u.user_email AS email
             FROM {$tbl} h
             LEFT JOIN {$wpdb->users} u ON u.ID = h.applicant_id
             ORDER BY h.created_at DESC
             LIMIT %d OFFSET %d",
				$per,
				$offset
			);
			$total = $wpdb->get_var( "SELECT COUNT(*) FROM {$tbl}" );
		}

		$rows = $wpdb->get_results( $sql );
		return rest_ensure_response(
			array(
				'ok'    => true,
				'items' => $rows,
				'total' => intval( $total ),
			)
		);
	}

	/**
	 * GET single application
	 */
	public function housing_get_one( \WP_REST_Request $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';
		$id  = intval( $req->get_param( 'id' ) );

		$row = $wpdb->get_row( $wpdb->prepare( "SELECT h.*, u.display_name AS name, u.user_email AS email FROM {$tbl} h LEFT JOIN {$wpdb->users} u ON u.ID = h.applicant_id WHERE h.id = %d", $id ), ARRAY_A );

		if ( ! $row ) {
			return new \WP_Error( 'not_found', 'Application not found', array( 'status' => 404 ) );
		}

		// decode JSON columns if present for ease of client rendering
		if ( ! empty( $row['for_rental'] ) ) {
			$row['for_rental'] = json_decode( $row['for_rental'], true );
		}
		if ( ! empty( $row['for_verification'] ) ) {
			$row['for_verification'] = json_decode( $row['for_verification'], true );
		}

		return rest_ensure_response(
			array(
				'ok'   => true,
				'item' => $row,
			)
		);
	}

	/**
	 * POST update application status (approve / reject / pending)
	 */
	public function housing_update( \WP_REST_Request $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';

		$id     = intval( $req->get_param( 'id' ) );
		$status = sanitize_text_field( $req->get_param( 'status' ) );
		$reason = sanitize_text_field( $req->get_param( 'rejection_reason' ) ?: '' );

		if ( ! in_array( $status, array( 'approved', 'rejected', 'pending', 'in_progress' ), true ) ) {
			return new \WP_Error( 'invalid_status', 'Invalid status', array( 'status' => 400 ) );
		}

		$updated = $wpdb->update(
			$tbl,
			array(
				'status'           => $status,
				'rejection_reason' => $reason ?: null,
				'updated_at'       => current_time( 'mysql' ),
			),
			array( 'id' => $id ),
			array( '%s', '%s', '%s' ),
			array( '%d' )
		);

		if ( false === $updated ) {
			return new \WP_Error( 'db_error', 'DB update failed', array( 'status' => 500 ) );
		}

		// fetch row
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$tbl} WHERE id = %d", $id ), ARRAY_A );

		// notify candidate by email
		if ( ! empty( $row['applicant_id'] ) ) {
			$user = get_userdata( intval( $row['applicant_id'] ) );
			if ( $user && $user->user_email ) {
				$to      = $user->user_email;
				$subject = 'Housing application update';
				$message = 'Hello ' . ( $user->display_name ?: $user->user_login ) . ",\n\n";
				if ( $status === 'approved' ) {
					$message .= "Your housing application has been approved. Congratulations!\n\n";
				} elseif ( $status === 'rejected' ) {
					$message .= "Your housing application has been rejected.\n\nReason: " . ( $reason ?: 'No reason provided.' ) . "\n\nPlease resubmit the form if appropriate or contact support.\n\n";
				} else {
					$message .= "Your housing application status has been updated to: $status.\n\n";
				}
				$message .= "Regards,\nRecruitment Team";

				// headers
				$headers = array( 'Content-Type: text/plain; charset=UTF-8' );
				wp_mail( $to, $subject, $message, $headers );
			}
		}

		return rest_ensure_response(
			array(
				'ok'   => true,
				'item' => $row,
			)
		);
	}

	/**
	 * Summary of update_payment_extension
	 *
	 * @param \WP_REST_Request $req
	 * @return \WP_Error|\WP_REST_Response
	 */
	public function update_payment_extension( \WP_REST_Request $req ) {
		global $wpdb;
		$tbl = $wpdb->prefix . 'jamrock_housing_applications';

		$applicant_id = intval( $req->get_param( 'id' ) );
		if ( ! $applicant_id ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'invalid_id',
				),
				400
			);
		}

		// Find row by applicant ID
		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM {$tbl} WHERE applicant_id = %d", $applicant_id ),
			ARRAY_A
		);

		if ( ! $row ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		// -----------------------------
		// CLEAN INPUTS
		// -----------------------------
		$enabled = $req->get_param( 'enable' ) == '1' ? 1 : 0;

		$expires = sanitize_text_field( $req->get_param( 'extended_until' ) ?: '' );
		$due_on  = sanitize_text_field( $req->get_param( 'due_on' ) ?: '' );
		$notes   = sanitize_textarea_field( $req->get_param( 'note' ) ?: '' );

		// fields_json from admin modal (AcroForm fields)
		$fields_json_raw = $req->get_param( 'fields_json' );
		$fields_json     = array();

		if ( $fields_json_raw ) {
			$decoded = json_decode( stripslashes( $fields_json_raw ), true );
			if ( is_array( $decoded ) ) {
				$fields_json = $decoded;
			}
		}

		// -----------------------------
		// MERGE WITH EXISTING PAYMENT EXTENSION JSON
		// -----------------------------
		$existing = array();
		if ( ! empty( $row['payment_extension'] ) ) {
			$existing = json_decode( $row['payment_extension'], true );
			if ( ! is_array( $existing ) ) {
				$existing = array();
			}
		}

		// Merge clean updated values
		$updated = array(
			'extension_enabled' => $enabled,
			'extended_until'    => $expires,
			'original_due_date' => $due_on,
			'notes'             => $notes,
			'updated_at'        => current_time( 'mysql' ),
			'fields_json'       => $fields_json,
		);

		$final_json = wp_json_encode( $updated );

		// -----------------------------
		// UPDATE DATABASE
		// -----------------------------
		$wpdb->update(
			$tbl,
			array(
				'extension_enabled' => $enabled,
				'extended_until'    => $expires,
				'original_due_date' => $due_on,
				'notes'             => $notes,
				'payment_extension' => $final_json,
				'updated_at'        => current_time( 'mysql' ),
			),
			array( 'id' => $row['id'] )
		);

		return rest_ensure_response(
			array(
				'ok'   => true,
				'item' => array(
					'applicant_id'      => $applicant_id,
					'payment_extension' => $updated,
				),
			)
		);
	}
}
