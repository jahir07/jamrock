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
		add_action( 'init', array( $this, 'bind_gf_hooks' ) );
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
			'/entry/(?P<id>\d+)/psymetrics-url',
			array(
				'methods' => 'GET',
				'permission_callback' => '__return_true', // It only reveals a redirect URL, safe enough; tighten if needed.
				'callback' => function (\WP_REST_Request $req) {
					$entry_id = (int) $req['id'];
					if ($entry_id <= 0) {
						return rest_ensure_response(array('url' => ''));
					}
					$url = (string) gform_get_meta($entry_id, 'psymetrics_candidate_url');
					return rest_ensure_response(array('url' => esc_url_raw($url)));
				},
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
		$start = sanitize_text_field( (string) ( $req->get_param( 'start' ) ?: gmdate( 'Y-m-d', strtotime( '-30 days' ) ) ) );
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
	 * Expected input:
	 * {
	 *   "record_count": N,
	 *   "data": [
	 *     { "guid": "...", "status": "COMPLETED", "candidate": { "email": "...", ... }, ... }
	 *   ]
	 * }
	 *
	 * @param array $decoded API decoded array.
	 * @return array[] Each row: [provider, external_id, email, overall_score(null), candidness('pending'), completed_at|null]
	 */
	private function normalize_psymetrics_list( array $decoded ): array {
		$out  = array();
		$list = isset( $decoded['data'] ) && is_array( $decoded['data'] ) ? $decoded['data'] : array();

		foreach ( $list as $item ) {
			$guid   = isset( $item['guid'] ) ? (string) $item['guid'] : '';
			$email  = isset( $item['candidate']['email'] ) ? sanitize_email( (string) $item['candidate']['email'] ) : '';
			$status = isset( $item['status'] ) ? strtoupper( (string) $item['status'] ) : '';

			$out[] = array(
				'provider'      => 'psymetrics',
				'external_id'   => $guid,
				'email'         => $email,
				'overall_score' => null, // not provided by list API
				'candidness'    => 'pending',
				'completed_at'  => ( 'COMPLETED' === $status ) ? current_time( 'mysql' ) : null,
			);
		}

		return $out;
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
			$score   = array_key_exists( 'overall_score', $r ) && null !== $r['overall_score'] ? (float) $r['overall_score'] : null;
			$cand    = $r['candidness'] ?? 'pending';
			$done_at = ! empty( $r['completed_at'] ) ? sanitize_text_field( (string) $r['completed_at'] ) : null;
			$ext_id  = sanitize_text_field( (string) ( $r['external_id'] ?? '' ) );

			// Find applicant by email (created via GF submission).
			$applicant_id = $email
				? (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT id FROM {$wpdb->prefix}jamrock_applicants WHERE email = %s LIMIT 1",
						$email
					)
				)
				: 0; // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

			// Upsert by (provider, external_id).
			$existing = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT id FROM $t WHERE provider = %s AND external_id = %s LIMIT 1",
					'psymetrics',
					$ext_id
				)
			); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared

			$data = array(
				'provider'      => 'psymetrics',
				'external_id'   => $ext_id,
				'applicant_id'  => $applicant_id,
				'email'         => $email,
				'overall_score' => $score,
				'candidness'    => $cand ?: 'pending',
				'completed_at'  => $done_at,
				'created_at'    => current_time( 'mysql' ),
				'updated_at'    => current_time( 'mysql' ),
			);

			if ( $existing ) {
				unset( $data['created_at'] );
				$ok = $wpdb->update( $t, $data, array( 'id' => $existing ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			} else {
				$ok = $wpdb->insert( $t, $data ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			}

			if ( false !== $ok ) {
				++$count;

				// Only fire completion/knockout when we have decisive data.
				if ( in_array( $data['candidness'], array( 'invalid', 'flagged' ), true ) ) {
					do_action( 'jamrock_psymetrics_knockout', $email, array( 'reason' => 'validity' ) );
				} elseif ( null !== $data['overall_score'] ) {
					do_action( 'jamrock_psymetrics_completed', $email, (float) $data['overall_score'], $done_at );
				}
			}
		}

		return $count;
	}

	/**
	 * Bind Gravity Forms hooks if GF is active and a form ID is set in options.
	 */
	public function bind_gf_hooks(): void {
		if ( ! function_exists( 'rgar' ) ) {
			// Gravity Forms not active.
			return;
		}

		$form_id = (int) get_option( 'jrj_form_id', 0 );
		if ( 0 === $form_id ) {
			return;
		}

		add_action( "gform_after_submission_{$form_id}", array( $this, 'create_assessment' ), 10, 2 );
		add_filter( "gform_confirmation_{$form_id}", array( $this, 'maybe_redirect' ), 10, 3 );
	}

	/**
	 * Create assessment via Psymetrics /integration/v1/register/ and store redirect URL in entry meta.
	 *
	 * @param array $entry Gravity Forms entry.
	 * @param array $form  Gravity Forms form (unused).
	 */
	public function create_assessment( $entry, $form ): void {
		unset( $form ); // keep signature for GF.

		$api_secret = (string) get_option( 'jrj_api_secret', '' );
		if ( '' === $api_secret ) {
			return;
		}

		$endpoint = 'https://api.psymetricstest.com/integration/v1/register/';

		// Basic candidate info – adjust IDs to your form.
		// $first_name = sanitize_text_field( (string) rgar( $entry, 1 ) );
		// $last_name  = sanitize_text_field( (string) rgar( $entry, 2 ) );
		// $email      = sanitize_email( (string) rgar( $entry, 3 ) );
		// if ( '' === $email || ! is_email( $email ) ) {
		// 	return;
		// }

		$first_name = sanitize_text_field((string) rgar($entry, 1));
		$email = sanitize_email((string) rgar($entry, 3));

		
		$job_applying_for = sanitize_text_field( (string) rgar( $entry, 4 ) );
		$lang             = sanitize_text_field( (string) rgar( $entry, 5 ) ); // en/sp optional
		$redirect_url     = esc_url_raw( (string) rgar( $entry, 12 ) );
		if ( '' === $redirect_url ) {
			$redirect_url = home_url( '/thanks/' );
		}

		$report_version      = sanitize_text_field( (string) rgar( $entry, 13 ) ); // selection|development|selection_development
		$add_id_verification = filter_var( rgar( $entry, 14 ), FILTER_VALIDATE_BOOLEAN );

		// Test selection (choose exactly one family per API rules).
		$prebuilt_raw = (string) rgar( $entry, 10 ); // comma-separated allowed
		$osb_id_raw   = (string) rgar( $entry, 11 ); // one_score_battery_id

		$prebuilt_ids = array();
		if ( '' !== $prebuilt_raw ) {
			$prebuilt_ids = array_filter(
				array_map(
					static function ( $v ) {
						return (int) trim( $v );
					},
					explode( ',', $prebuilt_raw )
				),
				static function ( $v ) {
					return $v > 0;
				}
			);
		}
		$one_score_battery_id = ( '' !== $osb_id_raw ) ? (int) $osb_id_raw : null;

		$payload = array(
			'first_name'          => $first_name,
			'last_name'           => $last_name,
			'email'               => $email,
			'job_applying_for'    => ( '' !== $job_applying_for ) ? $job_applying_for : 'N/A',
			'redirect_url'        => $redirect_url,
			'lang'                => ( '' !== $lang ) ? $lang : 'en',
			'add_id_verification' => (bool) $add_id_verification,
		);

		if ( in_array( $report_version, array( 'selection', 'development', 'selection_development' ), true ) ) {
			$payload['report_version'] = $report_version;
		}

		// Enforce exclusivity for OSB vs prebuilts.
		if ( $one_score_battery_id && ! empty( $prebuilt_ids ) ) {
			$prebuilt_ids = array();
		}

		if ( $one_score_battery_id ) {
			$payload['prebuilts']            = array();
			$payload['custombuilts']         = array();
			$payload['one_score_battery_id'] = (int) $one_score_battery_id;
		} elseif ( ! empty( $prebuilt_ids ) ) {
			$payload['prebuilts']            = array_map( 'intval', $prebuilt_ids );
			$payload['custombuilts']         = array(); // optional, add if you use them
			$payload['one_score_battery_id'] = null;
		} else {
			// No test specified → nothing to create.
			return;
		}

		$args = array(
			'method'  => 'POST',
			'timeout' => 20,
			'headers' => array(
				'Psymetrics-Secret' => $api_secret,
				'Content-Type'      => 'application/json',
				'Accept'            => 'application/json',
			),
			'body'    => wp_json_encode( $payload ),
		);

		$response = wp_remote_post( $endpoint, $args );

		if ( is_wp_error( $response ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( '[JAMROCK] psym_register_error ' . $response->get_error_message() );
			return;
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		
		if ( $code >= 200 && $code < 300 && ! empty( $body['assessment_url'] ) ) {
			$guid = isset( $body['guid'] ) ? sanitize_text_field( (string) $body['guid'] ) : '';
			gform_update_meta( rgar( $entry, 'id' ), 'psymetrics_guid', $guid );
			gform_update_meta( rgar( $entry, 'id' ), 'psymetrics_candidate_url', esc_url_raw( (string) $body['assessment_url'] ) );
		} else {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log(
				'[JAMROCK] psym_bad_response ' . wp_json_encode(
					array(
						'code' => $code,
						'body' => $body,
					)
				)
			);
		}
	}

	/**
	 * Redirect to assessment URL if available; otherwise show fallback message.
	 *
	 * @param mixed $confirmation Confirmation.
	 * @param array $form         Form (unused).
	 * @param array $entry        Entry.
	 * @return mixed
	 */
	public function maybe_redirect( $confirmation, $form, $entry ) {
		// unset( $form );
		// $url = gform_get_meta( rgar( $entry, 'id' ), 'psymetrics_candidate_url' );
		// if ( $url ) {
		// 	return array( 'redirect' => esc_url_raw( $url ) );
		// }
		// return wpautop(
		// 	esc_html__( 'Thanks! Your assessment link is being prepared. If not redirected shortly, please check your email.', 'jamrock' )
		// );

		unset( $form ); // not used here

		$entry_id = (int) rgar( $entry, 'id' );
		$url      = (string) gform_get_meta( $entry_id, 'psymetrics_candidate_url' );

		// Basic styles so the frame looks clean
		$styles = '<style>
		.jrj-psym-wrap{max-width:1200px;margin:20px auto;padding:0 10px}
		.jrj-psym-head{margin-bottom:10px}
		.jrj-psym-iframe{width:100%;min-height:1200px;border:0;background:#fff}
		.jrj-psym-note{font-size:14px;color:#666;margin:8px 0 16px}
		.jrj-psym-btn{display:inline-block;padding:10px 14px;border-radius:6px;background:#111;color:#fff;text-decoration:none}
		.jrj-psym-err{background:#fff3cd;color:#7a5d00;padding:12px;border-radius:6px;margin:8px 0}
		</style>';

		// If we already have the URL, render the iframe immediately.
		if ( $url ) {
			$html = sprintf(
				'<div class="jrj-psym-wrap">
				<div class="jrj-psym-head">
					<h2>Assessment</h2>
					<div class="jrj-psym-note">If the test does not load below (blocked by your browser), <a class="jrj-psym-btn" href="%1$s" target="_blank" rel="noopener">open in a new tab</a>.</div>
				</div>
				<iframe class="jrj-psym-iframe" src="%1$s" allow="fullscreen; geolocation; microphone; camera"></iframe>
				</div>',
				esc_url( $url )
			);
			return $styles . $html;
		}

		// Otherwise, show loader + script that polls a REST endpoint for a few seconds
		$endpoint = esc_url_raw( rest_url( 'jamrock/v1/entry/' . $entry_id . '/psymetrics-url' ) );
		$nonce    = wp_create_nonce( 'wp_rest' );

		$html = sprintf(
			'<div class="jrj-psym-wrap" id="jrj-psym-root">
			<div class="jrj-psym-head">
				<h2>Preparing your assessment…</h2>
				<p class="jrj-psym-note">This usually takes a moment. If not loaded automatically, you will see a button to open it in a new tab.</p>
			</div>
			<div class="jrj-psym-err" id="jrj-psym-msg" style="display:none"></div>
			</div>
			<script>
			(function(){
				const root = document.getElementById("jrj-psym-root");
				const msg  = document.getElementById("jrj-psym-msg");
				const endpoint = %1$s;
				const headers = {"X-WP-Nonce": %2$s};
				let tries = 0, maxTries = 10;

				function renderFrame(url){
				root.innerHTML = `
					<div class="jrj-psym-head">
					<h2>Assessment</h2>
					<div class="jrj-psym-note">If the test does not load below, <a class="jrj-psym-btn" href="${url}" target="_blank" rel="noopener">open in a new tab</a>.</div>
					</div>
					<iframe class="jrj-psym-iframe" src="${url}" allow="fullscreen; geolocation; microphone; camera"></iframe>
				`;
				}

				async function tick(){
				tries++;
				try{
					const res = await fetch(endpoint, {headers});
					if(!res.ok) throw new Error("HTTP "+res.status);
					const data = await res.json();
					if(data && data.url){
					renderFrame(data.url);
					return;
					}
				}catch(e){
					// swallow and retry
				}
				if(tries < maxTries){
					setTimeout(tick, 1000);
				}else{
					msg.style.display = "block";
					msg.textContent = "We couldn’t load the test automatically. Please check your email for the link or contact support.";
				}
				}
				tick();
			})();
			</script>',
			wp_json_encode( $endpoint ),
			wp_json_encode( $nonce )
		);

		return $styles . $html;	
	}
}
