<?php
/**
 * REST controller for medical affidavit submissions.
 *
 * Namespace: Jamrock\Controller
 *
 * Drop this file into your plugin and instantiate the class and call hooks().
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class Medical {

	/**
	 * Register top-level hooks.
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST routes.
	 */
	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/medical/affidavit',
			array(
				'methods'             => 'POST',
				'permission_callback' => array( $this, 'permission' ),
				'callback'            => array( $this, 'rest_medical_affidavit' ),
				'args'                => array(
					'applicant_id' => array(
						'required' => true,
						'type'     => 'integer',
					),
				),
			)
		);
	}

	/**
	 * Permission check for submitting an affidavit.
	 *
	 * Adjust capability logic to match your app (applicant mapping to WP users, roles, etc.)
	 *
	 * @param \WP_REST_Request $request
	 * @return bool|\WP_Error
	 */
	public function permission( \WP_REST_Request $request ) {
		$applicant_id = (int) $request->get_param( 'applicant_id' );

		// Basic check: only allow if current user can edit that applicant (adapt as needed).
		if ( $applicant_id > 0 && current_user_can( 'edit_user', $applicant_id ) ) {
			return true;
		}

		return new \WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to submit a medical affidavit for this applicant.', 'jamrock' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Handle POST /jamrock/v1/medical/affidavit
	 *
	 * Stores entire submitted form (except applicant_id) as JSON in `details`.
	 *
	 * @param \WP_REST_Request $req
	 * @return \WP_Error|\WP_REST_Response
	 */
	public function rest_medical_affidavit( \WP_REST_Request $req ) {

		global $wpdb;

		$table = $wpdb->prefix . 'jamrock_medical_affidavits';

		$body = $req->get_json_params() ?: array();

		// applicant_id: required and validated already in route args, but double-check
		$applicant_id = (int) ( $body['applicant_id'] ?? 0 );
		if ( $applicant_id <= 0 ) {
			return new \WP_Error( 'invalid_applicant', 'Invalid applicant_id.', array( 'status' => 400 ) );
		}

		// has_conditions: only allow 'yes' or 'no'
		$has_raw = strtolower( (string) ( $body['has_conditions'] ?? 'no' ) );
		$has     = in_array( $has_raw, array( 'yes', 'no' ), true ) ? $has_raw : 'no';

		// Prepare the "details" JSON: take the submitted body, remove applicant_id, sanitize recursively
		$details_arr = $body;
		unset( $details_arr['applicant_id'] );

		// recursive sanitizer
		$sanitize_recursive = null;
		$sanitize_recursive = function ( $value ) use ( &$sanitize_recursive ) {
			if ( is_array( $value ) ) {
				$san = array();
				foreach ( $value as $k => $v ) {
					$san[ $k ] = $sanitize_recursive( $v );
				}
				return $san;
			}

			if ( is_string( $value ) ) {
				// use textarea sanitizer for longer user input
				return sanitize_textarea_field( $value );
			}

			// leave numbers / booleans as-is
			return $value;
		};

		$sanitized_details = $sanitize_recursive( $details_arr );

		// Encode to JSON (safe for longtext)
		$details_json = wp_json_encode( $sanitized_details );

		$inserted = $wpdb->insert(
			$table,
			array(
				'applicant_id'   => $applicant_id,
				'has_conditions' => $has,
				'details'        => $details_json,
				'status'         => 'submitted',
				'created_at'     => current_time( 'mysql' ),
			),
			array(
				'%d',
				'%s',
				'%s',
				'%s',
				'%s',
			)
		);

		if ( false === $inserted ) {
			return new \WP_Error( 'db_error', 'Database insert failed.', array( 'status' => 500 ) );
		}

		$insert_id = (int) $wpdb->insert_id;

		// If applicant has conditions, trigger downstream processing
		if ( 'yes' === $has ) {
			/**
			 * Hook: jrj_medical_requires_clearance
			 *
			 * @param int $applicant_id
			 * @param int $affidavit_id - inserted row id
			 */
			do_action( 'jrj_medical_requires_clearance', $applicant_id, $insert_id );
		}

		return rest_ensure_response(
			array(
				'ok'  => true,
				'id'  => $insert_id,
				'msg' => 'Affidavit saved.',
			)
		);
	}
}
