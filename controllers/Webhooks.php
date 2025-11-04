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

use Jamrock\Services\Composite as CompositeService;

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

		register_rest_route(
			'jamrock/v1',
			'/psymetrics/webhook',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true', // We'll validate shared-secret below.
				'callback'            => array( $this, 'handle' ),
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
	 * - Shared secret via header "X-Jamrock-Secret" must equal stored option 'jrj_api_key'.
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
		$expected = (string) get_option( 'jrj_api_key', '' );

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

	/**
	 * Handle POST /psymetrics/webhook (Psymetrics).
	 *
	 * Shared-secret checked via header "Psymetrics-Secret".
	 *
	 * @param \WP_REST_Request $req Request instance.
	 * @return \WP_REST_Response
	 */
	public function handle( \WP_REST_Request $req ) {
		// 1) Shared-secret check
		$sent = (string) $req->get_header( 'Psymetrics-Secret' );
		$want = (string) get_option( 'jrj_api_key', '' );
		if ( $want === '' || ! hash_equals( $want, $sent ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'forbidden',
				),
				403
			);
		}

		// 2) Parse payload
		$body = $req->get_json_params();
		if ( ! $body || empty( $body['success'] ) || empty( $body['data'] ) || ! is_array( $body['data'] ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'bad_payload',
				),
				400
			);
		}

		// Some integrations send one record per webhook; handle the first item.
		$item = $body['data'][0];

		// Extract candidate email → map to applicant_id
		$email = '';
		if ( ! empty( $item['candidate_info']['email'] ) ) {
			$email = sanitize_email( (string) $item['candidate_info']['email'] );
		}
		if ( ! $email || ! is_email( $email ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'missing_email',
				),
				400
			);
		}

		$applicant_id = $this->get_applicant_id_by_email( $email );
		if ( ! $applicant_id ) {
			// Optionally: create an applicant stub here. For now, return 404.
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'applicant_not_found',
				),
				404
			);
		}

		// 3) Compute normalized score
		// Prefer a 0–100 measure if available; else convert overall_score (1–5) → 0–100.
		$norm  = null;
		$raw   = null;
		$flags = array();

		// candidness flag
		// Your sample has: "candidness": false  → flag it
		if ( array_key_exists( 'candidness', $item ) && $item['candidness'] === false ) {
			$flags[] = 'candidness_flagged'; // Your composite logic treats this as disqualifying.
		}

		// Try to compute norm from subscale percentiles (average), if present
		$subscale_norm  = null;
		$subscales_meta = array();
		if ( ! empty( $item['score_detail'] ) && is_array( $item['score_detail'] ) ) {
			$acc = 0;
			$n   = 0;
			foreach ( $item['score_detail'] as $sd ) {
				if ( isset( $sd['percentile_score'] ) && is_numeric( $sd['percentile_score'] ) ) {
					$acc += (float) $sd['percentile_score'];
					++$n;
				}
				// Keep a lightweight meta for UI drill-down
				$subscales_meta[] = array(
					'scale'      => (string) ( $sd['scale'] ?? '' ),
					'percentile' => isset( $sd['percentile_score'] ) ? (float) $sd['percentile_score'] : null,
					'attempted'  => $sd['score_interpretation']['attempted'] ?? null,
					'correct'    => $sd['score_interpretation']['correct'] ?? null,
					'incorrect'  => $sd['score_interpretation']['incorrect'] ?? null,
				);
			}
			if ( $n > 0 ) {
				$subscale_norm = round( $acc / $n, 0 ); // 0–100 scale already
			}
		}

		// overall_score normalization
		if ( isset( $item['overall_score'] ) && is_numeric( $item['overall_score'] ) ) {
			$raw = (float) $item['overall_score'];

			// Heuristics:
			// - 0..1 → treat as fraction → *100
			// - 1..5 → treat as 1–5 Likert → /5 *100
			// - 5..100 → assume already 0–100-like → clamp
			if ( $raw <= 1.0 ) {
				$norm = round( $raw * 100, 0 );
			} elseif ( $raw <= 5.0 ) {
				$norm = round( ( $raw / 5.0 ) * 100.0, 0 );
			} else {
				$norm = round( max( 0.0, min( 100.0, $raw ) ), 0 );
			}
		}

		// Prefer subscale average if it exists (often more representative)
		if ( $subscale_norm !== null ) {
			$norm = (float) $subscale_norm;
		}

		// Final fallback safety
		if ( $norm === null ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'no_score',
				),
				422
			);
		}

		// 4) Build meta for transparency
		$meta = array(
			'assessment'     => (string) ( $item['assessment'] ?? '' ),
			'date_invited'   => (string) ( $item['date_invited'] ?? '' ),
			'date_completed' => (string) ( $item['date_completed'] ?? '' ),
			'logo'           => (string) ( $item['logo'] ?? '' ),
			'subscales'      => $subscales_meta,
		);

		// 5) Update composite
		CompositeService::update_component_and_recompute(
			$applicant_id,
			'psymetrics',
			array(
				'raw'   => $raw,          // could be 1–5 or other base; we store it as-is for audit
				'norm'  => $norm,         // 0–100 (what composite uses)
				'flags' => $flags,        // e.g., candidness_flagged
				'meta'  => $meta,
			)
		);

		return rest_ensure_response(
			array(
				'ok'           => true,
				'applicant_id' => $applicant_id,
				'normalized'   => $norm,
				'flags'        => $flags,
			)
		);
	}

	/**
	 * Summary of get_applicant_id_by_email
	 *
	 * @param string $email email.
	 * @return int
	 */
	private function get_applicant_id_by_email( string $email ): int {
		if ( ! is_email( $email ) ) {
			return 0;
		}
		global $wpdb;
		$t = "{$wpdb->prefix}jamrock_applicants";
		return (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT id FROM $t WHERE email=%s LIMIT 1", $email )
		);
	}
}
