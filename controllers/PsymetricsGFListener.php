<?php
/**
 * Gravity Forms + Psymetrics listener.
 *
 * - Creates candidate via /integration/v1/register after GF submission.
 * - Redirects to /assessment?entry=ID&exp=...&sig=...
 * - Exposes GET /jamrock/v1/entry/{id}/psymetrics-url (signature-checked).
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class PsymetricsGfListener {

	/**
	 * Wire up hooks.
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
		add_action( 'init', array( $this, 'bind_gf_hooks' ) );
	}

	/**
	 * Register REST routes used by the assessment step (signature-checked).
	 */
	public function routes(): void {

		// 1) Poll URL (public, token-checked)
		register_rest_route(
			'jamrock/v1',
			'/entry/(?P<id>\d+)/psymetrics-url',
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => array( $this, 'get_psymetrics_url' ),
			)
		);

		// 2) Force register (POST) – secure: admin OR valid token
		register_rest_route(
			'jamrock/v1',
			'/entry/(?P<id>\d+)/psymetrics-register',
			array(
				'methods'             => 'POST',
				'permission_callback' => array( $this, 'can_register_assessment' ),
				'callback'            => array( $this, 'register_assessment_for_entry' ),
			)
		);
	}

	/**
	 * Bind GF hooks if the target form is set.
	 */
	public function bind_gf_hooks(): void {
		if ( ! function_exists( 'rgar' ) ) {
			return; // Gravity Forms not active.
		}

		$form_id = (int) get_option( 'jrj_form_id', 0 );
		if ( 0 === $form_id ) {
			return;
		}

		add_filter( "gform_confirmation_{$form_id}", array( $this, 'redirect_to_step_two' ), 10, 3 );
	}

	public function can_register_assessment( \WP_REST_Request $req ): bool {
		// Allow admins.
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}
		// Or allow via token (for public Step-2 page)
		$entry_id = (int) $req['id'];
		$token    = (string) $req->get_param( 'token' );
		if ( $entry_id > 0 && $token !== '' ) {
			$expected = (string) gform_get_meta( $entry_id, 'jrj_psym_token' );
			return ( $expected && hash_equals( $expected, $token ) );
		}
		return false;
	}

	public function get_psymetrics_url( \WP_REST_Request $req ) {
		$entry_id = (int) $req['id'];
		if ( $entry_id <= 0 ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'bad_id',
				),
				400
			);
		}
		// Token check to avoid leaking URLs publicly
		$token    = (string) $req->get_param( 'token' );
		$expected = (string) gform_get_meta( $entry_id, 'jrj_psym_token' );
		if ( ! $expected || ! hash_equals( $expected, $token ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'forbidden',
				),
				403
			);
		}
		$url = (string) gform_get_meta( $entry_id, 'psymetrics_candidate_url' );
		return rest_ensure_response(
			array(
				'ok'  => true,
				'url' => $url,
			)
		);
	}

	public function register_assessment_for_entry( \WP_REST_Request $req ) {
		$entry_id = (int) $req['id'];
		if ( $entry_id <= 0 ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'bad_id',
				),
				400
			);
		}

		if ( ! function_exists( 'GFAPI' ) && ! class_exists( '\GFAPI' ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'gravityforms_missing',
				),
				500
			);
		}

		$entry = \GFAPI::get_entry( $entry_id );
		if ( is_wp_error( $entry ) || empty( $entry ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'entry_not_found',
				),
				404
			);
		}

		// If already have URL, just return it
		$existing = (string) gform_get_meta( $entry_id, 'psymetrics_candidate_url' );
		if ( $existing ) {
			return rest_ensure_response(
				array(
					'ok'     => true,
					'url'    => $existing,
					'status' => 'already_registered',
				)
			);
		}

		// --- Build payload from entry fields (adjust IDs!)
		$api_secret = (string) get_option( 'jrj_api_key', '' );
		if ( $api_secret === '' ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'missing_api_key',
				),
				400
			);
		}

		// Map fields – make sure last_name is present to avoid "Invalid last name."
		$first_name = sanitize_text_field( (string) rgar( $entry, 1 ) );
		$last_name  = sanitize_text_field( (string) rgar( $entry, 2 ) ); // <-- ensure your form has this!
		$email      = sanitize_email( (string) rgar( $entry, 3 ) );

		if ( $email === '' || ! is_email( $email ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'invalid_email',
				),
				400
			);
		}
		if ( $last_name === '' ) {
			// Hard fallback, but better to require the field on Step-1
			$last_name = 'N/A';
		}

		// One Score battery or custombuilts
		$one_score_battery_id = (int) rgar( $entry, 11 );

		$payload = array(
			'first_name'          => $first_name ?: 'na',
			'last_name'           => $last_name ?: $first_name, // avoid empty last name.
			'email'               => $email,
			'job_applying_for'    => 'N/A',
			'redirect_url'        => home_url( '/thanks/' ),
			'lang'                => 'en',
			'add_id_verification' => false,
		);

		if ( $one_score_battery_id ) {
			$payload['prebuilts']            = array();
			$payload['custombuilts']         = array();
			$payload['one_score_battery_id'] = $one_score_battery_id;
		} else {
			$payload['prebuilts']            = array();
			$payload['custombuilts']         = array( 592 ); // Your custom profile ID
			$payload['one_score_battery_id'] = null;
		}

		$res = wp_remote_post(
			'https://api.psymetricstest.com/integration/v1/register/',
			array(
				'method'  => 'POST',
				'timeout' => 20,
				'headers' => array(
					'Psymetrics-Secret' => $api_secret,
					'Content-Type'      => 'application/json',
					'Accept'            => 'application/json',
				),
				'body'    => wp_json_encode( $payload ),
			)
		);

		if ( is_wp_error( $res ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => $res->get_error_message(),
				),
				500
			);
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );

		if ( $code >= 200 && $code < 300 && ! empty( $body['assessment_url'] ) ) {
			$url  = (string) $body['assessment_url'];
			$guid = isset( $body['guid'] ) ? sanitize_text_field( (string) $body['guid'] ) : '';

			gform_update_meta( $entry_id, 'psymetrics_guid', $guid );
			gform_update_meta( $entry_id, 'psymetrics_candidate_url', esc_url_raw( $url ) );

			if ( ! gform_get_meta( $entry_id, 'jrj_psym_token' ) ) {
				gform_update_meta( $entry_id, 'jrj_psym_token', wp_generate_password( 20, false, false ) );
			}

			return rest_ensure_response(
				array(
					'ok'     => true,
					'url'    => $url,
					'status' => 'registered',
				)
			);
		}

		// Error from provider (surface message if available)
		$err = isset( $body['error_message'] ) ? (string) $body['error_message'] : "HTTP $code";
		return new \WP_REST_Response(
			array(
				'ok'    => false,
				'error' => $err,
				'body'  => $body,
			),
			500
		);
	}

	/**
	 * Confirmation: redirect to /assessment?entry=ID&exp=...&sig=...
	 */
	public function redirect_to_step_two( $confirmation, $form, $entry ) {
		unset( $confirmation, $form );

		$entry_id = (int) rgar( $entry, 'id' );

		// ensure token exists for this entry
		$token = (string) gform_get_meta( $entry_id, 'jrj_psym_token' );
		if ( $token === '' ) {
			$token = wp_generate_password( 20, false, false );
			gform_update_meta( $entry_id, 'jrj_psym_token', $token );
		}

		$exp                     = (string) ( time() + 15 * 60 );
		$sig                     = $this->make_signature( $entry_id, $exp );
		$jrj_set_assessment_page = (string) get_option( 'jrj_set_assessment_page', '' );

		$url = add_query_arg(
			array(
				'entry' => $entry_id,
				'token' => $token,
				'exp'   => $exp,
				'sig'   => $sig,
			),
			home_url( $jrj_set_assessment_page )
		);

		return array( 'redirect' => esc_url_raw( $url ) );
	}

	/**
	 * Create HMAC signature for entry + exp.
	 */
	private function make_signature( int $entry_id, string $exp ): string {
		$key = (string) get_option( 'jrj_api_key', '' );
		if ( '' === $key ) {
			$key = wp_salt( 'auth' );
		}
		return hash_hmac( 'sha256', $entry_id . '|' . $exp, $key );
	}

	/**
	 * Verify signature + not expired.
	 */
	private function verify_signature( int $entry_id, string $exp, string $sig ): bool {
		if ( ! $entry_id || ! $exp || ! $sig ) {
			return false;
		}
		if ( time() > (int) $exp ) {
			return false;
		}
		return hash_equals( $this->make_signature( $entry_id, $exp ), $sig );
	}
}
