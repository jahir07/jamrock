<?php
/**
 * Psymetrics Controller.
 *
 * - Admin list:     GET  /wp-json/jamrock/v1/assessments
 * - Manual sync:    POST /wp-json/jamrock/v1/assessments/sync?start=YYYY-MM-DD&end=YYYY-MM-DD
 * - GF register:    creates an assessment and redirects candidate to Psymetrics
 *
 * Notes:
 * • The list endpoint from Psymetrics (integration/v1/assessments/) does not include scores/candidness.
 *   We normalize it and store rows as "pending" (no score). A webhook or detail API should update later.
 *
 * @package Jamrock
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Psymetrics
 */
class Psymetrics {


	/**
	 * Register top-level hooks.
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST API routes.
	 */
	public function routes(): void {
		// GET /jamrock/v1/assessments  => list (paged, filterable).
		register_rest_route(
			'jamrock/v1',
			'/assessments',
			array(
				'methods'             => 'GET',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'list' ),
			)
		);

		// POST /jamrock/v1/assessments/sync?start=YYYY-MM-DD&end=YYYY-MM-DD  => pull from Psymetrics list API.
		register_rest_route(
			'jamrock/v1',
			'/assessments/sync',
			array(
				'methods'             => 'POST',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'sync' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/assessments/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => array( $this, 'detail' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/assessments/(?P<id>\d+)/refresh',
			array(
				'methods'             => 'POST',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => array( $this, 'refresh_one' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/assessments/(?P<id>\d+)/recompute',
			array(
				'methods'             => 'POST',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => array( $this, 'recompute_from_assessment' ),
			)
		);
	}

	/**
	 * List assessments with pagination and optional filtering.
	 *
	 * @param \WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function list( \WP_REST_Request $req ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_assessments';
		$a = $wpdb->prefix . 'jamrock_applicants';

		$page = max( 1, (int) $req->get_param( 'page' ) );
		$per  = min( 100, max( 1, (int) ( $req->get_param( 'per_page' ) ?: 10 ) ) );
		$off  = ( $page - 1 ) * $per;

		$provider = sanitize_text_field( (string) $req->get_param( 'provider' ) );
		$candid   = sanitize_text_field( (string) $req->get_param( 'candidness' ) );

		$clauses = array( '1=1' );
		$args    = array();

		if ( $provider ) {
			$clauses[] = 's.provider = %s';
			$args[]    = $provider;
		}
		if ( $candid ) {
			$clauses[] = 's.candidness = %s';
			$args[]    = $candid;
		}

		$where = implode( ' AND ', $clauses );

		$sql_total = $wpdb->prepare( "SELECT COUNT(*) FROM $t s WHERE $where", $args ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$total     = (int) $wpdb->get_var( $sql_total );

		$sql_rows = $wpdb->prepare(
			"SELECT s.id, s.provider, s.external_id, s.email, s.overall_score, s.candidness, s.completed_at, s.created_at,
			        ap.first_name, ap.last_name
			 FROM $t s
			 LEFT JOIN $a ap ON ap.id = s.applicant_id
			 WHERE $where
			 ORDER BY s.id DESC
			 LIMIT %d OFFSET %d",
			array_merge( $args, array( $per, $off ) )
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

		$rows = $wpdb->get_results( $sql_rows, ARRAY_A ) ?: array(); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		return rest_ensure_response(
			array(
				'items' => $rows,
				'total' => $total,
			)
		);
	}

	/**
	 * Sync assessments from Psymetrics LIST API (no scores).
	 * Stores rows as 'pending' until webhook/detail fills score & candidness.
	 *
	 * @param \WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function sync( \WP_REST_Request $req ) {
		$start = sanitize_text_field( (string) ( $req->get_param( 'start' ) ?: gmdate( 'Y-m-d', strtotime( '-10 days' ) ) ) );
		$end   = sanitize_text_field( (string) ( $req->get_param( 'end' ) ?: gmdate( 'Y-m-d' ) ) );

		// Note: Using "jrj_api_key" as "Psymetrics-Secret" header (per your settings page).
		$secret = (string) get_option( 'jrj_api_key', '' );
		if ( '' === $secret ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'missing_psymetrics_secret',
				),
				400
			);
		}

		$url = add_query_arg(
			array(
				'start_date' => $start,
				'end_date'   => $end,
			),
			'https://api.psymetricstest.com/integration/v1/assessments/'
		);

		$res = wp_remote_get(
			$url,
			array(
				'headers' => array( 'Psymetrics-Secret' => $secret ),
				'timeout' => 20,
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
		$body = (string) wp_remote_retrieve_body( $res );

		if ( 200 !== $code ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => "HTTP $code",
				),
				500
			);
		}

		$decoded = json_decode( $body, true );
		if ( ! is_array( $decoded ) ) {
			$decoded = array();
		}

		$normalized = $this->normalize_psymetrics_list( $decoded );
		$imported   = $this->upsert_psymetrics( $normalized );

		$guids = array_values(
			array_filter(
				array_map(
					static function ( $r ) {
						return $r['external_id'] ?? ''; },
					$normalized
				)
			)
		);

		if ( ! empty( $guids ) ) {
			$this->refresh_psymetrics_scores_chunked( $guids, 10, 100 ); // প্রতি ব্যাচে 10 টি, প্রতিটি আইটেমের মাঝে ~100ms।
		}

		/**
		 * Fires after a manual sync pull completes.
		 *
		 * @param array $summary { count, start, end }.
		 */
		do_action(
			'jamrock_assessments_synced',
			array(
				'count' => $imported,
				'start' => $start,
				'end'   => $end,
			)
		);

		return rest_ensure_response(
			array(
				'ok'       => true,
				'imported' => $imported,
			)
		);
	}

	/**
	 * Normalize Psymetrics LIST payload into our internal row shape.
	 *
	 * @param array $decoded API decoded array.
	 * @return array[] Each row: [provider, external_id, email, overall_score(null), candidness('pending'), completed_at|null]
	 */
	private function normalize_psymetrics_list( array $decoded ): array {
		$out  = array();
		$list = ( isset( $decoded['data'] ) && is_array( $decoded['data'] ) ) ? $decoded['data'] : array();

		foreach ( $list as $item ) {
			$guid       = isset( $item['guid'] ) ? (string) $item['guid'] : '';
			$status_raw = isset( $item['status'] ) ? (string) $item['status'] : '';
			$status     = strtoupper( trim( $status_raw ) );

			$assessment_url = isset( $item['assessment_url'] ) ? esc_url_raw( $item['assessment_url'] ) : '';

			$candidate       = ( isset( $item['candidate'] ) && is_array( $item['candidate'] ) ) ? $item['candidate'] : array();
			$candidate_first = isset( $candidate['first_name'] ) ? sanitize_text_field( $candidate['first_name'] ) : '';
			$candidate_last  = isset( $candidate['last_name'] ) ? sanitize_text_field( $candidate['last_name'] ) : '';
			$candidate_email = isset( $candidate['email'] ) ? sanitize_email( $candidate['email'] ) : '';
			$candidate_role  = isset( $candidate['job_position'] ) ? sanitize_text_field( $candidate['job_position'] ) : '';

			$details = array(
				'candidate'    => array(
					'first_name'   => $candidate_first,
					'last_name'    => $candidate_last,
					'email'        => $candidate_email,
					'job_position' => $candidate_role,
				),
				'prebuilts'    => ( isset( $item['prebuilts'] ) && is_array( $item['prebuilts'] ) ) ? $item['prebuilts'] : array(),
				'custombuilts' => ( isset( $item['custombuilts'] ) && is_array( $item['custombuilts'] ) ) ? $item['custombuilts'] : array(),
			);

			$out[] = array(
				'provider'       => 'psymetrics',
				'external_id'    => $guid,
				'email'          => $candidate_email,
				'assessment_url' => $assessment_url,
				'details_json'   => wp_json_encode( $details ),
				'payload_json'   => wp_json_encode( $item ), // todo webhook/detail can fill later.
				'overall_score'  => null,
				'candidness'     => ( 'COMPLETED' === $status ) ? 'completed' : 'pending',
				'completed_at'   => ( 'COMPLETED' === $status ) ? current_time( 'mysql' ) : null,
			);
		}

		return $out;
	}

	public function refresh_one( \WP_REST_Request $req ) {
		global $wpdb;
		$t  = $wpdb->prefix . 'jamrock_assessments';
		$id = (int) $req['id'];

		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM $t WHERE id=%d LIMIT 1", $id ),
			ARRAY_A
		);
		if ( ! $row ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		$guid = (string) ( $row['external_id'] ?? '' );
		if ( $guid === '' ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'no_guid',
				),
				400
			);
		}

		$normalized = $this->fetch_psymetrics_result_by_guid( $guid );
		if ( ! $normalized ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'fetch_failed',
				),
				500
			);
		}

		$ok = $this->upsert_psymetrics( array( $normalized ) );
		return rest_ensure_response( array( 'ok' => (bool) $ok ) );
	}

	/**
	 * Upsert normalized Psymetrics rows into jamrock_assessments.
	 * Rows here may have no score; webhook/detail can update later.
	 *
	 * @param array $rows Normalized rows.
	 * @return int Number of rows inserted/updated.
	 */
	private function upsert_psymetrics( array $rows ): int {
		global $wpdb;
		$t     = $wpdb->prefix . 'jamrock_assessments';
		$count = 0;

		foreach ( $rows as $r ) {
			$email   = sanitize_email( $r['email'] ?? '' );
			$score   = isset( $r['overall_score'] ) && null !== $r['overall_score'] ? (float) $r['overall_score'] : null;
			$cand    = $r['candidness'] ?? 'pending';
			$done_at = ! empty( $r['completed_at'] ) ? sanitize_text_field( (string) $r['completed_at'] ) : null;
			$ext_id  = sanitize_text_field( (string) ( $r['external_id'] ?? '' ) );

			// Find applicant by email (if exists)
			$applicant_id = $email
				? (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT id FROM {$wpdb->prefix}jamrock_applicants WHERE email = %s LIMIT 1",
						$email
					)
				)
				: 0;

			// Use REPLACE to upsert by unique (provider, external_id).
			$ok = $wpdb->replace(
				$t,
				array(
					'provider'       => 'psymetrics',
					'external_id'    => $ext_id,
					'applicant_id'   => $applicant_id,
					'email'          => $email,
					'assessment_url' => $r['assessment_url'] ?? '',
					'details_json'   => $r['details_json'] ?? null,
					'payload_json'   => $r['payload_json'] ?? null,
					'overall_score'  => $score,
					'candidness'     => $cand ?: 'pending',
					'completed_at'   => $done_at,
					'created_at'     => current_time( 'mysql' ),
					'updated_at'     => current_time( 'mysql' ),
				),
				array(
					'%s',
					'%s',
					'%d',
					'%s',
					'%s',
					'%s',
					'%s',
					'%f',
					'%s',
					'%s',
					'%s',
					'%s',
				)
			);

			if ( false !== $ok ) {
				++$count;

				// Trigger hooks only when meaningful.
				if ( in_array( $cand, array( 'invalid', 'flagged' ), true ) ) {
					do_action( 'jamrock_psymetrics_knockout', $email, array( 'reason' => 'validity' ) );
				} elseif ( null !== $score ) {
					do_action( 'jamrock_psymetrics_completed', $email, (float) $score, $done_at );
				}
			}
		}

		return $count;
	}

	/**
	 * Fetch a single Psymetrics result by GUID and normalize it for upsert.
	 *
	 * @param string $guid
	 * @return array|null Normalized row compatible with upsert_psymetrics(), or null on error.
	 */
	private function fetch_psymetrics_result_by_guid( string $guid ): ?array {
		$guid = trim( $guid );
		if ( '' === $guid ) {
			return null;
		}

		// Configure.
		$secret = (string) get_option( 'jrj_api_key', '' );
		$url    = 'https://api.psymetricstest.com/integration/v1/result/?guid=' . rawurlencode( $guid );

		$args = array(
			'headers'   => array( 'Psymetrics-Secret' => $secret ),
			'timeout'   => 15,
			'sslverify' => true,
		);

		$r = wp_remote_get( $url, $args );
		if ( is_wp_error( $r ) ) {
			return null;
		}

		$code = (int) wp_remote_retrieve_response_code( $r );
		if ( $code < 200 || $code >= 300 ) {
			return null;
		}

		$body = wp_remote_retrieve_body( $r );
		$dec  = json_decode( $body, true );

		if ( ! is_array( $dec ) || empty( $dec['success'] ) || empty( $dec['data'][0] ) || ! is_array( $dec['data'][0] ) ) {
			return null;
		}

		$item = $dec['data'][0];

		// Extract candidate block.
		$cand      = isset( $item['candidate_info'] ) && is_array( $item['candidate_info'] ) ? $item['candidate_info'] : array();
		$email     = isset( $cand['email'] ) ? sanitize_email( $cand['email'] ) : '';
		$invited   = isset( $item['date_invited'] ) ? sanitize_text_field( (string) $item['date_invited'] ) : '';
		$completed = isset( $item['date_completed'] ) ? sanitize_text_field( (string) $item['date_completed'] ) : '';
		$score     = isset( $item['overall_score'] ) ? (float) $item['overall_score'] : null;

		// Your list endpoint stored assessment_url earlier; keep it if present in DB.
		global $wpdb;
		$t                       = $wpdb->prefix . 'jamrock_assessments';
		$existing_assessment_url = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT assessment_url FROM $t WHERE provider=%s AND external_id=%s LIMIT 1",
				'psymetrics',
				$guid
			)
		);

		// Build details_json with rich context (keep raw flags for future).
		$details = array(
			'assessment'     => isset( $item['assessment'] ) ? sanitize_text_field( (string) $item['assessment'] ) : '',
			'logo'           => isset( $item['logo'] ) ? esc_url_raw( (string) $item['logo'] ) : '',
			'date_invited'   => $invited,
			'candidness_raw' => isset( $item['candidness'] ) ? $item['candidness'] : null,
			'candidate'      => array(
				'first_name'       => isset( $cand['first_name'] ) ? sanitize_text_field( $cand['first_name'] ) : '',
				'last_name'        => isset( $cand['last_name'] ) ? sanitize_text_field( $cand['last_name'] ) : '',
				'email'            => $email,
				'job_applying_for' => isset( $cand['job_applying_for'] ) ? sanitize_text_field( $cand['job_applying_for'] ) : '',
			),
			'score_details'  => isset( $item['score_details'] ) && is_array( $item['score_details'] ) ? $item['score_details'] : array(),
		);

		// Convert date_completed → MySQL DATETIME (server local time ok for you).
		$completed_at = $completed ? date_i18n( 'Y-m-d H:i:s', strtotime( $completed ) ) : null;

		// Map to your upsert schema
		return array(
			'provider'       => 'psymetrics',
			'external_id'    => $guid,
			'email'          => $email,
			'assessment_url' => $existing_assessment_url ?: '',
			'details_json'   => wp_json_encode( $details ),
			'payload_json'   => wp_json_encode( $item ),
			'overall_score'  => $score,
			'candidness'     => $completed_at ? 'completed' : 'pending',
			'completed_at'   => $completed_at,
		);
	}

	public function recompute_from_assessment( \WP_REST_Request $req ) {
		global $wpdb;
		$t  = $wpdb->prefix . 'jamrock_assessments';
		$id = (int) $req['id'];

		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM $t WHERE id=%d LIMIT 1", $id ),
			ARRAY_A
		);
		if ( ! $row ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}
		$applicant_id = (int) ( $row['applicant_id'] ?? 0 );
		if ( $applicant_id <= 0 ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'no_applicant',
				),
				400
			);
		}

		$details = json_decode( (string) ( $row['details_json'] ?? '' ), true ) ?: array();
		$map     = $this->map_psymetrics_to_norm_and_flags(
			isset( $row['overall_score'] ) ? (float) $row['overall_score'] : null,
			$details['candidness_raw'] ?? ( $row['candidness'] ?? null )
		);

		// Update component → recompute
		\Jamrock\Services\Composite::update_component_and_recompute(
			$applicant_id,
			'psymetrics',
			array(
				'raw'   => isset( $row['overall_score'] ) ? (float) $row['overall_score'] : null,
				'norm'  => $map['norm'],
				'flags' => $map['flags'],
				'meta'  => array(
					'assessment'   => 'Psymetrics',
					'external_id'  => (string) $row['external_id'],
					'completed_at' => (string) ( $row['completed_at'] ?? '' ),
				),
			)
		);

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Refresh scores for a set of GUIDs by calling the result API.
	 *
	 * @param string[] $guids
	 * @return int Number of successful upserts
	 */
	private function refresh_psymetrics_scores_chunked( array $guids, int $chunk_size = 10, int $delay_ms = 100 ): int {
		$total = 0;
		if ( empty( $guids ) ) {
			return 0;
		}

		@set_time_limit( 0 );

		foreach ( array_chunk( $guids, $chunk_size ) as $batch ) {
			foreach ( $batch as $guid ) {
				$row = $this->fetch_psymetrics_result_by_guid( (string) $guid );
				if ( $row ) {
					$total += $this->upsert_psymetrics( array( $row ) );
				}
				if ( $delay_ms > 0 ) {
					usleep( $delay_ms * 1000 );
				}
			}
			usleep( 200 * 1000 );
		}

		return $total;
	}


	public function detail( \WP_REST_Request $req ) {
		global $wpdb;
		$t  = $wpdb->prefix . 'jamrock_assessments';
		$a  = $wpdb->prefix . 'jamrock_applicants';
		$id = (int) $req['id'];

		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT s.*, ap.first_name, ap.last_name
			 FROM $t s
			 LEFT JOIN $a ap ON ap.id = s.applicant_id
			 WHERE s.id=%d LIMIT 1",
				$id
			),
			ARRAY_A
		);

		if ( ! $row ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		$payload = json_decode( (string) ( $row['payload_json'] ?? '' ), true ) ?: array();
		$details = json_decode( (string) ( $row['details_json'] ?? '' ), true ) ?: array();

		// Try to fish totals from payload if provided by API
		$subscales = array();
		$totals    = array(
			'total'     => null,
			'attempted' => null,
			'correct'   => null,
			'incorrect' => null,
		);

		if ( ! empty( $payload['score_detail'] ) && is_array( $payload['score_detail'] ) ) {
			foreach ( $payload['score_detail'] as $sd ) {
				$subscales[] = array(
					'scale'      => (string) ( $sd['scale'] ?? '' ),
					'percentile' => isset( $sd['percentile_score'] ) ? (float) $sd['percentile_score'] : null,
				);
				if ( ! empty( $sd['score_interpretation'] ) && is_array( $sd['score_interpretation'] ) ) {
					$si                  = $sd['score_interpretation'];
					$totals['total']     = $si['total'] ?? $totals['total'];
					$totals['attempted'] = $si['attempted'] ?? $totals['attempted'];
					$totals['correct']   = $si['correct'] ?? $totals['correct'];
					$totals['incorrect'] = $si['incorrect'] ?? $totals['incorrect'];
				}
			}
		}

		$map = $this->map_psymetrics_to_norm_and_flags(
			isset( $row['overall_score'] ) ? (float) $row['overall_score'] : null,
			$details['candidness_raw'] ?? ( $row['candidness'] ?? null )
		);

		return rest_ensure_response(
			array(
				'ok'         => true,
				'assessment' => array(
					'id'             => (int) $row['id'],
					'provider'       => (string) $row['provider'],
					'external_id'    => (string) $row['external_id'],
					'email'          => (string) $row['email'],
					'applicant_id'   => (int) $row['applicant_id'],
					'applicant'      => trim( ( $row['first_name'] ?? '' ) . ' ' . ( $row['last_name'] ?? '' ) ),
					'assessment_url' => (string) ( $row['assessment_url'] ?? '' ),
					'overall_score'  => isset( $row['overall_score'] ) ? (float) $row['overall_score'] : null,
					'normalized'     => $map['norm'],
					'flags'          => $map['flags'],
					'candidness'     => (string) ( $row['candidness'] ?? 'pending' ),
					'completed_at'   => (string) ( $row['completed_at'] ?? '' ),
					'created_at'     => (string) ( $row['created_at'] ?? '' ),
					'logo'           => (string) ( $details['logo'] ?? '' ),
					'date_invited'   => (string) ( $details['date_invited'] ?? '' ),
					'subscales'      => $subscales,
					'totals'         => $totals,
				),
			)
		);
	}

	/**
	 * Map Psymetrics overall_score and candidness_raw to our norm and flags.
	 *
	 * @param float|null $overall_score
	 * @param mixed      $candidnessRaw
	 * @return array{norm: float|null, flags: string[]}
	 */
	private function map_psymetrics_to_norm_and_flags( ?float $overall_score, $candidnessRaw ): array {
		$norm = null;

		if ( is_numeric( $overall_score ) ) {
			// If looks like 0..5 Likert, map to percentage. Else treat as percentage.
			if ( $overall_score >= 1 && $overall_score <= 5 ) {
				$norm = ( ( $overall_score - 1.0 ) / 4.0 ) * 100.0; // 1→0%, 5→100%
			} else {
				$norm = $overall_score; // already percent-ish
			}
		}

		$norm = is_null( $norm ) ? null : max( 0, min( 100, (float) $norm ) );

		$flags = array();
		// candidness can be boolean or string (pending/completed/flagged/invalid)
		if ( $candidnessRaw === false || $candidnessRaw === 'flagged' || $candidnessRaw === 'invalid' ) {
			$flags[] = 'candidness_flagged';
		}

		return array(
			'norm'  => $norm,
			'flags' => $flags,
		);
	}
}
