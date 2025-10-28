<?php
/**
 * Webhooks Controller.
 *
 * Receives inbound webhook events (e.g., Psymetrics assessment results)
 * and dispatches internal actions for further processing.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Webhooks
 *
 * Registers REST routes for external providers to call back.
 */
class Webhooks {


	/**
	 * Register WordPress hooks.
	 *
	 * @return void
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/webhooks/assessment-result',
			array(
				'methods'             => 'POST',
				// Auth is enforced via a shared secret header in the callback itself.
				'permission_callback' => '__return_true',
				'callback'            => array( $this, 'receive_psymetrics' ),
				'args'                => array(), // Reserved for future validation.
			)
		);
	}

	/**
	 * Handle POST /webhooks/assessment-result (Psymetrics).
	 *
	 * Expected JSON keys (examples):
	 * - email (string)               : candidate email (required).
	 * - candidness (string)          : "cleared" | "flagged" | "invalid" | "pending".
	 * - overall_score (float|int)    : numeric score.
	 * - completed_at (string, ISO-8601).
	 *
	 * Security:
	 * - Shared secret via header "X-Jamrock-Secret" must equal stored option 'jrj_api_secret'.
	 *
	 * Actions fired:
	 * - jamrock_psymetrics_knockout ( $email, array $context )
	 * - jamrock_psymetrics_completed( $email, $overall_score, $completed_at )
	 *
	 * @param \WP_REST_Request $request Request instance.
	 * @return \WP_REST_Response
	 */
	public function receive_psymetrics( \WP_REST_Request $request ) {
		$secret   = (string) $request->get_header( 'X-Jamrock-Secret' );
		$expected = (string) get_option( 'jrj_api_secret', '' );

		if ( '' === $expected || ! hash_equals( $expected, $secret ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'unauthorized',
				),
				401
			);
		}

		$body = (array) $request->get_json_params();

		$email_raw = $body['email'] ?? '';
		$email     = sanitize_email( is_string( $email_raw ) ? $email_raw : '' );

		$candid_raw = $body['candidness'] ?? '';
		$candid     = is_string( $candid_raw ) ? strtolower( sanitize_text_field( $candid_raw ) ) : '';

		$overall = isset( $body['overall_score'] ) ? floatval( $body['overall_score'] ) : null;

		$completed_raw = $body['completed_at'] ?? '';
		$completed_at  = is_string( $completed_raw ) ? sanitize_text_field( $completed_raw ) : '';

		if ( '' === $email ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'missing_email',
				),
				422
			);
		}

		// Fire internal actions based on candidness.
		if ( in_array( $candid, array( 'invalid', 'flagged' ), true ) ) {
			/**
			 * Candidate is knocked out by Psymetrics validity/candidness.
			 *
			 * @param string $email   Candidate email.
			 * @param array  $context Context (e.g., reason).
			 */
			do_action( 'jamrock_psymetrics_knockout', $email, array( 'reason' => 'validity' ) );
		} else {
			/**
			 * Candidate completed Psymetrics with acceptable candidness.
			 *
			 * @param string     $email        Candidate email.
			 * @param float|null $overall      Overall score.
			 * @param string     $completed_at ISO-8601 timestamp (provider supplied).
			 */
			do_action( 'jamrock_psymetrics_completed', $email, $overall, $completed_at );
		}

		// Structured logging (prefer jamrock_log if available).
		$log_payload = array(
			'ts'        => gmdate( 'c' ),
			'event'     => 'psymetrics_webhook',
			'email'     => $email,
			'candid'    => ( '' !== $candid ) ? $candid : 'cleared',
			'has_score' => ( null !== $overall ),
		);

		if ( function_exists( 'jamrock_log' ) ) {
			jamrock_log( 'psymetrics_webhook', $log_payload );
		} elseif ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( '[JAMROCK] ' . wp_json_encode( $log_payload ) );
		}

		return new \WP_REST_Response(
			array(
				'ok' => true,
			),
			200
		);
	}
}
