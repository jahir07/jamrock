<?php
namespace Jamrock\Controllers;

use Jamrock\Services\Composite;

defined( 'ABSPATH' ) || exit;

class Autoproctoring {

	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Summary of routes
	 *
	 * @return void
	 */
	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/autoproctor/webhook',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'callback'            => array( $this, 'webhook' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/autoproctor/attempts',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return is_user_logged_in(); // or current_user_can('read');
				},
				'callback'            => array( $this, 'log_attempt_event' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/autoproctor/attempts/(?P<session_id>[A-Za-z0-9_\-]+)/refresh',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'rest_proctor_attempt_refresh' ),
			)
		);

		// register in rest_api_init
		register_rest_route(
			'jamrock/v1',
			'/autoproctor/attempts',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'read' ); },
				'callback'            => array( $this, 'rest_autoproctor_attempts_list' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/autoproctor/attempts/(?P<session_id>[A-Za-z0-9_\-]+)',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'read' ); // or '__return_true' for testing
				},
				'callback'            => array( $this, 'rest_autoproctor_attempt_detail' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/autoproctor/sync',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => array( $this, 'sync_autoproctor_result' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/autoproctor/sync-missing',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return current_user_can( 'manage_options' ); },
				'callback'            => array( $this, 'handle_sync_missing' ),
			)
		);
	}

	public function rest_autoproctor_attempt_detail( \WP_REST_Request $req ) {
		$session = sanitize_text_field( (string) $req->get_param( 'session_id' ) );
		if ( empty( $session ) ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'missing_session',
				)
			);
		}

		global $wpdb;
		$t   = $wpdb->prefix . 'jamrock_autoproctor_attempts';
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE session_id=%s LIMIT 1", $session ), ARRAY_A );

		if ( ! $row ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		$out = array(
			'id'              => (int) $row['id'],
			'session_id'      => $row['session_id'],
			'user_name'       => $row['user_name'],
			'user_email'      => $row['user_email'],
			'integrity_score' => $row['integrity_score'],
			'flags'           => $row['flags_json'] ? json_decode( $row['flags_json'], true ) : array(),
			'raw'             => $row['raw_payload_json'] ? json_decode( $row['raw_payload_json'], true ) : null,
			'started_at'      => $row['started_at'],
			'completed_at'    => $row['completed_at'],
			'created_at'      => $row['created_at'],
		);

		return rest_ensure_response(
			array(
				'ok'      => true,
				'attempt' => $out,
			)
		);
	}

	/**
	 * Handle autoproctor sync.
	 *
	 * @param \WP_REST_Request $req
	 * @return \WP_Error|\WP_REST_Response
	 */
	public function handle_sync_missing( \WP_REST_Request $req ) {
		$this->do_batch_sync_missing();
		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Summary of log_attempt_event
	 *
	 * @param \WP_REST_Request $req request object.
	 * @return \WP_REST_Response
	 */
	public function log_attempt_event( \WP_REST_Request $req ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_autoproctor_attempts';

		// Prefer JSON body parsing (supports fetch with JSON)
		$params = $req->get_json_params() ?: array();

		$user_id    = get_current_user_id();
		$quiz_id    = isset( $params['quiz_id'] ) ? (int) $params['quiz_id'] : (int) $req->get_param( 'quiz_id' );
		$attempt_id = isset( $params['attempt_id'] ) ? sanitize_text_field( (string) $params['attempt_id'] ) : sanitize_text_field( (string) $req->get_param( 'attempt_id' ) );
		$event      = isset( $params['event'] ) ? sanitize_text_field( (string) $params['event'] ) : sanitize_text_field( (string) $req->get_param( 'event' ) );
		$payload    = isset( $params['payload'] ) && is_array( $params['payload'] ) ? $params['payload'] : (array) $req->get_param( 'payload' );

		$user_info  = $params['user'] ?? array();
		$user_name  = isset( $user_info['name'] ) ? sanitize_text_field( $user_info['name'] ) : null;
		$user_email = isset( $user_info['email'] ) ? sanitize_email( $user_info['email'] ) : null;

		if ( ! $quiz_id || $attempt_id === '' || ! in_array( $event, array( 'started', 'stopped', 'violation' ), true ) ) {
			return new \WP_REST_Response(
				array(
					'ok'       => false,
					'message'  => 'bad_request',
					'received' => $params,
				),
				400
			);
		}

		// Upsert by attempt_id
		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT id, flags_json FROM $t WHERE session_id=%s LIMIT 1", $attempt_id ),
			ARRAY_A
		);

		$now  = current_time( 'mysql' );
		$data = array(
			'user_id'    => $user_id,
			'quiz_id'    => $quiz_id,
			'session_id' => $attempt_id,
			'updated_at' => $now,
		);

		if ( ! $row ) {
			$data += array(
				'created_at'       => $now,
				'started_at'       => $event === 'started' ? $now : null,
				'flags_json'       => null,
				'raw_payload_json' => wp_json_encode( $payload ),
				'integrity_score'  => null,
				'user_name'        => $user_name,
				'user_email'       => $user_email,
			);

			$inserted = $wpdb->insert( $t, $data );
			if ( false === $inserted ) {
				if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
					error_log( '[AP] insert failed: ' . $wpdb->last_error );
				}
				return new \WP_REST_Response(
					array(
						'ok'    => false,
						'error' => 'db_insert_failed',
					),
					500
				);
			}
		} else {
			// update timestamps/flags and ensure name/email saved/updated
			$update = array( 'updated_at' => $now );

			if ( $event === 'started' ) {
				$update['started_at'] = $now;
			} elseif ( $event === 'stopped' ) {
				$update['completed_at'] = $now;
			} elseif ( $event === 'violation' ) {
				// append violation payloads
				$prev = array();
				if ( ! empty( $row['flags_json'] ) ) {
					$decoded = json_decode( (string) $row['flags_json'], true );
					if ( is_array( $decoded ) ) {
						$prev = $decoded;
					}
				}
				$prev[]               = $payload ?: array( 'type' => 'violation' );
				$update['flags_json'] = wp_json_encode( $prev );
			}

			// update raw_payload_json with latest payload
			$update['raw_payload_json'] = wp_json_encode( $payload );

			// update user name/email if provided
			if ( $user_name !== null ) {
				$update['user_name'] = $user_name;
			}
			if ( $user_email !== null ) {
				$update['user_email'] = $user_email;
			}

			$updated = $wpdb->update( $t, $update, array( 'session_id' => $attempt_id ) );
			if ( false === $updated ) {
				if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
					error_log( '[AP] update failed: ' . $wpdb->last_error );
				}
				return new \WP_REST_Response(
					array(
						'ok'    => false,
						'error' => 'db_update_failed',
					),
					500
				);
			}
		}

		return new \WP_REST_Response( array( 'ok' => true ), 200 );
	}

	/**
	 * Summary of webhook
	 *
	 * @param \WP_REST_Request $req request object.
	 * @return \WP_REST_Response
	 */
	public function webhook( \WP_REST_Request $req ) {
		// --- robust header parsing + optional debug (remove debug logs after verification) ---
		$expect          = trim( (string) get_option( 'jrj_autoproctor_webhook_secret', '' ) );
		$provided_secret = '';

		// try common header names / server normalizations
		$provided_secret = (string) $req->get_header( 'X-AP-Secret' );
		if ( empty( $provided_secret ) ) {
			$provided_secret = (string) $req->get_header( 'x_ap_secret' ); // nginx/php may convert - to _
		}
		if ( empty( $provided_secret ) ) {
			$provided_secret = (string) $req->get_header( 'x-ap-secret' );
		}
		// fallback to Authorization header (Bearer or custom AP scheme)
		if ( empty( $provided_secret ) ) {
			$auth = (string) $req->get_header( 'authorization' );
			if ( ! empty( $auth ) ) {
				if ( stripos( $auth, 'bearer ' ) === 0 ) {
					$provided_secret = substr( $auth, 7 );
				} elseif ( stripos( $auth, 'ap ' ) === 0 ) {
					$provided_secret = substr( $auth, 3 );
				} else {
					$provided_secret = $auth;
				}
			}
		}

		$provided_secret = trim( (string) $provided_secret );

		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( "[AP webhook] expect=[{$expect}] provided=[{$provided_secret}]" );
		}

		if ( empty( $expect ) || ! hash_equals( $expect, $provided_secret ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'forbidden',
				),
				403
			);
		}

		// --- parse JSON body robustly ---
		$b = $req->get_json_params();
		if ( ! is_array( $b ) ) {
			$b = json_decode( $req->get_body(), true );
			if ( ! is_array( $b ) ) {
				return new \WP_REST_Response(
					array(
						'ok'    => false,
						'error' => 'invalid_json',
					),
					400
				);
			}
		}

		// --- find session id from a set of possible keys ---
		$possible_keys = array( 'session_id', 'testAttemptId', 'tenantTestAttemptId', 'attempt_id', 'id' );
		$session       = '';
		foreach ( $possible_keys as $k ) {
			if ( ! empty( $b[ $k ] ) ) {
				$session = sanitize_text_field( (string) $b[ $k ] );
				break;
			}
		}

		if ( $session === '' ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( '[AP webhook] no session id found. payload keys: ' . wp_json_encode( array_keys( $b ) ) );
			}
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'no_session_id',
				),
				400
			);
		}

		// --- extract score and flags defensively ---
		$score = null;
		if ( isset( $b['integrity_score'] ) ) {
			$score = floatval( $b['integrity_score'] );
		} elseif ( isset( $b['trustScore'] ) ) {
			$score = floatval( $b['trustScore'] );
		} elseif ( isset( $b['score'] ) ) {
			$score = floatval( $b['score'] );
		}

		$flags = array();
		if ( ! empty( $b['flags'] ) && is_array( $b['flags'] ) ) {
			$flags = $b['flags'];
		} elseif ( ! empty( $b['violations'] ) && is_array( $b['violations'] ) ) {
			$flags = $b['violations'];
		}

		// --- update DB row ---
		global $wpdb;
		$t   = $wpdb->prefix . 'jamrock_autoproctor_attempts';
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE session_id=%s LIMIT 1", $session ), ARRAY_A );
		if ( ! $row ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( "[AP webhook] session not found: {$session}" );
			}
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'session_not_found',
				),
				404
			);
		}

		$update = array(
			'integrity_score'  => $score,
			'flags_json'       => wp_json_encode( $flags ),
			'raw_payload_json' => wp_json_encode( $b ),
			'completed_at'     => current_time( 'mysql' ),
			'updated_at'       => current_time( 'mysql' ),
		);

		$res = $wpdb->update( $t, $update, array( 'id' => (int) $row['id'] ) );
		if ( false === $res ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( '[AP webhook] DB update failed: ' . $wpdb->last_error );
			}
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'db_update_failed',
				),
				500
			);
		}

		// --- normalize score and update composite if available ---
		$norm = max( 0, min( 100, is_null( $score ) ? 0 : floatval( $score ) ) );

		if ( function_exists( 'jrj_applicant_id_from_user' ) ) {
			$applicant_id = jrj_applicant_id_from_user( (int) $row['user_id'] );
			if ( $applicant_id ) {
				Composite::update_component_and_recompute(
					$applicant_id,
					'autoproctor',
					array(
						'raw'   => $score,
						'norm'  => $norm,
						'flags' => $flags,
						'meta'  => array( 'session_id' => $session ),
					)
				);
			}
		}

		// --- GA events ---
		do_action( 'jrj_ga_event', 'proctoring_completed', array( 'quiz_id' => $row['quiz_id'] ) );
		if ( ! empty( $flags ) ) {
			do_action(
				'jrj_ga_event',
				'proctoring_flagged',
				array(
					'quiz_id' => $row['quiz_id'],
					'flags'   => $flags,
				)
			);
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * Get autoproctor result by ID.
	 *
	 * @param mixed $attemptId attempt ID.
	 * @return mixed
	 */
	private function get_autoproctor_result( $attemptId ) {
		$clientId     = (string) get_option( 'jrj_autoproctor_api_id', '' );
		$clientSecret = (string) get_option( 'jrj_autoproctor_api_key', '' );

		if ( $clientId === '' || $clientSecret === '' ) {
			return new \WP_Error( 'missing_credentials', 'Missing AutoProctor credentials' );
		}

		// Some AP endpoints expect a hashedTestAttemptId (base64 of HMAC-SHA256 raw)
		$hashed     = base64_encode( hash_hmac( 'sha256', $attemptId, $clientSecret, true ) );
		$attemptEnc = rawurlencode( $attemptId );
		$url        = "https://www.autoproctor.co/api/v2/test-attempts/{$attemptEnc}/?tenantClientId=" . rawurlencode( $clientId ) . '&hashedTestAttemptId=' . rawurlencode( $hashed );

		$auth_header = 'AP ' . base64_encode( $clientId . ':' . $clientSecret ); // keep for compatibility if AP expects this
		// Alternatively AP may expect X-Client-Id and X-Signature: compute signature for body if needed.
		$response = wp_remote_get(
			$url,
			array(
				'headers' => array(
					'Content-Type'  => 'application/json',
					'Authorization' => $auth_header,
				),
				'timeout' => 20,
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		if ( $code < 200 || $code >= 300 ) {
			return new \WP_Error( 'ap_error', 'AutoProctor returned status ' . $code, array( 'body' => $body ) );
		}

		$data = json_decode( $body, true );
		if ( null === $data && json_last_error() !== JSON_ERROR_NONE ) {
			return new \WP_Error( 'invalid_json', 'Failed to decode JSON from AutoProctor', array( 'raw' => $body ) );
		}

		return $data;
	}

	/**
	 * Fetch evidence JSON for a given attempt id from AutoProctor (via evidence-records-file-url -> S3).
	 *
	 * @param string $attemptId tenantTestAttemptId (e.g. '299f8vrz')
	 * @return array|\WP_Error parsed JSON (assoc) of evidence file OR WP_Error
	 */
	private function ap_fetch_evidence_records( string $attemptId ) {
		$clientId     = (string) get_option( 'jrj_autoproctor_api_id', '' );
		$clientSecret = (string) get_option( 'jrj_autoproctor_api_key', '' );

		if ( empty( $clientId ) || empty( $clientSecret ) ) {
			return new \WP_Error( 'missing_credentials', 'Missing AutoProctor credentials' );
		}

		// hashed_test_attempt_id = base64(HMAC-SHA256(attemptId, clientSecret))
		$hashed_raw = hash_hmac( 'sha256', $attemptId, $clientSecret, true );
		$hashed_b64 = base64_encode( $hashed_raw );

		// URL encode the base64 for query
		$url = sprintf(
			'https://www.autoproctor.co/api/v2/test-attempts/%s/evidence-records-file-url/?client_id=%s&hashed_test_attempt_id=%s',
			rawurlencode( $attemptId ),
			rawurlencode( $clientId ),
			rawurlencode( $hashed_b64 )
		);

		$resp = wp_remote_get(
			$url,
			array(
				'headers' => array(
					'Accept' => 'application/json',
				),
				'timeout' => 20,
			)
		);

		if ( is_wp_error( $resp ) ) {
			return $resp;
		}

		$code = wp_remote_retrieve_response_code( $resp );
		$body = wp_remote_retrieve_body( $resp );
		if ( $code < 200 || $code >= 300 ) {
			return new \WP_Error( 'ap_error', "AP returned {$code}", array( 'body' => $body ) );
		}

		$json = json_decode( $body, true );
		if ( ! is_array( $json ) || empty( $json['all_evidence_records_file_url'] ) ) {
			return new \WP_Error( 'no_evidence_url', 'No evidence file URL returned', array( 'body' => $body ) );
		}

		// Now fetch presigned S3 JSON
		$s3_url  = $json['all_evidence_records_file_url'];
		$s3_resp = wp_remote_get( $s3_url, array( 'timeout' => 30 ) );
		if ( is_wp_error( $s3_resp ) ) {
			return $s3_resp;
		}
		$s3_code = wp_remote_retrieve_response_code( $s3_resp );
		$s3_body = wp_remote_retrieve_body( $s3_resp );
		if ( $s3_code < 200 || $s3_code >= 300 ) {
			return new \WP_Error( 's3_error', "S3 returned {$s3_code}", array( 'body' => $s3_body ) );
		}

		$evidence_json = json_decode( $s3_body, true );
		if ( null === $evidence_json && json_last_error() !== JSON_ERROR_NONE ) {
			return new \WP_Error( 'invalid_json', 'Failed to decode evidence JSON', array( 'raw' => $s3_body ) );
		}

		return $evidence_json;
	}

	// In your Autoproctoring class (you already have get_autoproctor_result)
	public function sync_autoproctor_result( \WP_REST_Request $req ) {
		$attemptId = sanitize_text_field( $req->get_param( 'attempt_id' ) );
		if ( ! $attemptId ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'missing_attempt_id',
				),
				400
			);
		}

		$result = $this->get_autoproctor_result( $attemptId );
		if ( is_wp_error( $result ) ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => $result->get_error_message(),
					'data'  => $result->get_error_data(),
				),
				500
			);
		}

		// Map and update DB (similar to webhook logic)
		global $wpdb;
		$t     = $wpdb->prefix . 'jamrock_autoproctor_attempts';
		$score = isset( $result['integrity_score'] ) ? floatval( $result['integrity_score'] ) : null;
		$flags = is_array( $result['flags'] ?? null ) ? $result['flags'] : array();

		$wpdb->update(
			$t,
			array(
				'integrity_score'  => $score,
				'flags_json'       => wp_json_encode( $flags ),
				'raw_payload_json' => wp_json_encode( $result ),
				'completed_at'     => current_time( 'mysql' ),
				'updated_at'       => current_time( 'mysql' ),
			),
			array( 'session_id' => $attemptId )
		);

		return new \WP_REST_Response(
			array(
				'ok'   => true,
				'data' => $result,
			),
			200
		);
	}

	/**
	 * Fetch test results for a batch of attempt IDs.
	 *
	 * @param array $attemptIds List of attempt IDs.
	 * @return mixed
	 */
	private function ap_fetch_test_results_batch( array $attemptIds ) {
		$attemptIds = array_values(
			array_filter(
				array_map( 'strval', $attemptIds ),
				function ( $v ) {
					$v = trim( $v );
					return $v !== '' && preg_match( '/^[A-Za-z0-9_\-]{4,}$/', $v );
				}
			)
		);
		if ( empty( $attemptIds ) ) {
			return new \WP_Error( 'no_ids', 'No valid attempt ids provided.' );
		}

		$client_id     = (string) get_option( 'jrj_autoproctor_api_id', '' );
		$client_secret = (string) get_option( 'jrj_autoproctor_api_key', '' );

		if ( ! $client_id || ! $client_secret ) {
			return new \WP_Error( 'missing_credentials', 'Missing AutoProctor credentials' );
		}

		$payload = array( 'tenantTestAttemptIds' => array_values( $attemptIds ) );
		$body    = wp_json_encode( $payload );

		// canonical Authorization header that worked for GET earlier
		$auth_ap = 'AP ' . base64_encode( $client_id . ':' . $client_secret );

		// try series of candidate header sets (URL includes tenantClientId)
		$url = 'https://www.autoproctor.co/api/v1/test-results/?tenantClientId=' . rawurlencode( $client_id );

		$candidates = array(
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => $auth_ap,
			),
		);

		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[AP SYNC] TRY_URL=' . $url );
			error_log( '[AP SYNC] TRY_HEADERS=' . wp_json_encode( $candidates['headers'] ) );
			error_log( '[AP SYNC] REQ_BODY=' . $body );
		}

		$resp = wp_remote_post(
			$url,
			array(
				'headers' => $candidates['headers'],
				'body'    => $body,
				'timeout' => 30,
			)
		);

		if ( is_wp_error( $resp ) ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( '[AP SYNC] wp_remote_post error: ' . $resp->get_error_message() );
			}
		}

		$code      = wp_remote_retrieve_response_code( $resp );
		$resp_body = wp_remote_retrieve_body( $resp );

		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( "[AP SYNC] RESP_CODE={$code}" );
			error_log( "[AP SYNC] RESP_BODY={$resp_body}" );
		}

		if ( $code < 200 || $code >= 300 ) {
			return new \WP_Error( 'ap_error', "AP returned {$code}", array( 'body' => $resp_body ) );
		}

		$json = json_decode( $body, true );
		if ( null === $json && json_last_error() !== JSON_ERROR_NONE ) {
			return new \WP_Error( 'invalid_json', 'Invalid JSON from AP', array( 'raw' => $resp_body ) );
		}

		$report = $this->process_ap_batch_results( $json );

		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[AP SYNC] PROCESS_REPORT=' . wp_json_encode( $report ) );
		}

		return $report;
	}

	public function do_batch_sync_missing( $limit = 50 ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_autoproctor_attempts';

		// fetch up to N missing attempts
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT session_id FROM $t WHERE integrity_score IS NULL LIMIT %d", intval( $limit ) ), ARRAY_A );
		if ( ! $rows ) {
			return true;
		}
		$attemptIds = array_column( $rows, 'session_id' );
		return $this->do_batch_sync_by_ids( $attemptIds );
	}


	/**
	 * Sync specific attempt ids (array)
	 * Returns true or WP_Error
	 */
	/**
	 * Sync specific attempt ids (array)
	 * Returns array report or WP_Error
	 *
	 * @param array $attemptIds
	 * @return array|\WP_Error
	 */
	public function do_batch_sync_by_ids( array $attemptIds ) {
		if ( empty( $attemptIds ) ) {
			return new \WP_Error( 'no_ids', 'No attempt ids provided.' );
		}

		// sanitize attempt ids early (defensive)
		$attemptIds = array_values(
			array_filter(
				array_map( 'strval', $attemptIds ),
				function ( $v ) {
					$v = trim( $v );
					return $v !== '' && preg_match( '/^[A-Za-z0-9_\-]{4,}$/', $v );
				}
			)
		);
		if ( empty( $attemptIds ) ) {
			return new \WP_Error( 'no_ids', 'No valid attempt ids provided.' );
		}

		// fetch from AutoProctor (this may return WP_Error, a processed report, or raw API JSON)
		$res = $this->ap_fetch_test_results_batch( $attemptIds );
		if ( is_wp_error( $res ) ) {
			return $res;
		}

		// If ap_fetch_test_results_batch already processed and returned report, just return it
		if ( isset( $res['updated'] ) && isset( $res['skipped'] ) ) {
			return $res; // already processed
		}

		// Otherwise expect raw API shape (with 'results' or array)
		$results = $res['results'] ?? $res;
		if ( ! is_array( $results ) ) {
			return new \WP_Error( 'bad_response', 'Unexpected AP response' );
		}

		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_autoproctor_attempts';

		$updated = 0;
		$skipped = 0;
		$errors  = array();

		foreach ( $results as $r ) {
			// find session id - AP uses tenantTestAttemptId or testAttemptId etc.
			$session = $r['tenantTestAttemptId'] ?? $r['testAttemptId'] ?? ( $r['id'] ?? null );
			if ( ! $session ) {
				++$skipped;
				$errors[] = 'missing_session_id_in_result';
				continue;
			}
			$session = sanitize_text_field( (string) $session );

			// pick score: prefer integrity_score -> trustScore -> score
			$raw_score = null;
			if ( isset( $r['integrity_score'] ) ) {
				$raw_score = floatval( $r['integrity_score'] );
			} elseif ( isset( $r['trustScore'] ) ) {
				$raw_score = floatval( $r['trustScore'] );
			} elseif ( isset( $r['score'] ) ) {
				$raw_score = floatval( $r['score'] );
			}

			// normalize score to 0-100 if it looks like 0..1 (trustScore style)
			$score = null;
			if ( ! is_null( $raw_score ) ) {
				if ( $raw_score <= 1.1 ) { // likely 0..1 scale
					$score = round( $raw_score * 100, 2 );
				} else {
					$score = round( $raw_score, 2 );
				}
			}

			// parse timestamps
			$started_at   = null;
			$completed_at = null;
			if ( ! empty( $r['startedAt'] ) ) {
				$dt = date_create( $r['startedAt'] );
				if ( $dt ) {
					$started_at = gmdate( 'Y-m-d H:i:s', $dt->getTimestamp() );
				}
			} elseif ( ! empty( $r['started_at'] ) ) {
				$dt = date_create( $r['started_at'] );
				if ( $dt ) {
					$started_at = gmdate( 'Y-m-d H:i:s', $dt->getTimestamp() );
				}
			}

			if ( ! empty( $r['finishedAt'] ) ) {
				$dt = date_create( $r['finishedAt'] );
				if ( $dt ) {
					$completed_at = gmdate( 'Y-m-d H:i:s', $dt->getTimestamp() );
				}
			} elseif ( ! empty( $r['finished_at'] ) ) {
				$dt = date_create( $r['finished_at'] );
				if ( $dt ) {
					$completed_at = gmdate( 'Y-m-d H:i:s', $dt->getTimestamp() );
				}
			}

			// flags - try several keys
			$flags = array();
			if ( ! empty( $r['flags'] ) && is_array( $r['flags'] ) ) {
				$flags = $r['flags'];
			} elseif ( ! empty( $r['violations'] ) && is_array( $r['violations'] ) ) {
				$flags = $r['violations'];
			}

			// find local row
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT id FROM $t WHERE session_id=%s LIMIT 1", $session ), ARRAY_A );
			if ( ! $row ) {
				++$skipped;
				$errors[] = 'session_not_found:' . $session;
				continue;
			}

			// build update
			$update = array(
				'integrity_score'  => $score,
				'flags_json'       => ! empty( $flags ) ? wp_json_encode( $flags ) : null,
				'raw_payload_json' => wp_json_encode( $r ),
				'updated_at'       => current_time( 'mysql' ),
			);
			if ( $started_at ) {
				$update['started_at'] = $started_at;
			}
			if ( $completed_at ) {
				$update['completed_at'] = $completed_at;
			}

			$res_upd = $wpdb->update( $t, $update, array( 'id' => (int) $row['id'] ) );
			if ( $res_upd === false ) {
				$errors[] = 'db_error:' . $wpdb->last_error . ' for session ' . $session;
			} else {
				++$updated;
			}
		}

		return array(
			'updated' => $updated,
			'skipped' => $skipped,
			'errors'  => $errors,
		);
	}

	/**
	 * Process AutoProctor batch response and update local attempts table.
	 *
	 * @param array $ap_response Parsed JSON response from AP (associative array).
	 * @return array ['updated' => int, 'skipped' => int, 'errors' => array]
	 */
	private function process_ap_batch_results( array $ap_response ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_autoproctor_attempts';

		$updated = 0;
		$skipped = 0;
		$errors  = array();

		// some APIs wrap results in 'results' key — normalize
		$results = $ap_response['results'] ?? $ap_response;
		if ( ! is_array( $results ) ) {
			return array(
				'updated' => 0,
				'skipped' => 0,
				'errors'  => array( 'bad_response' => 'results not array' ),
			);
		}

		foreach ( $results as $r ) {
			// find session id - AP uses tenantTestAttemptId or testAttemptId etc.
			$session = $r['tenantTestAttemptId'] ?? $r['testAttemptId'] ?? ( $r['id'] ?? null );
			if ( ! $session ) {
				++$skipped;
				continue;
			}
			$session = sanitize_text_field( (string) $session );

			// pick score: prefer integrity_score -> trustScore -> score
			$raw_score = null;
			if ( isset( $r['integrity_score'] ) ) {
				$raw_score = floatval( $r['integrity_score'] );
			} elseif ( isset( $r['trustScore'] ) ) {
				$raw_score = floatval( $r['trustScore'] );
			} elseif ( isset( $r['score'] ) ) {
				$raw_score = floatval( $r['score'] );
			}

			// normalize score to 0-100 if it looks like 0..1 (trustScore style)
			$score = null;
			if ( ! is_null( $raw_score ) ) {
				if ( $raw_score <= 1.1 ) { // likely 0..1 scale
					$score = round( $raw_score * 100, 2 );
				} else {
					$score = round( $raw_score, 2 );
				}
			}

			// times: AP returns ISO datetimes, convert to WP mysql datetime (UTC -> DB)
			$started_at   = null;
			$completed_at = null;
			if ( ! empty( $r['startedAt'] ) ) {
				$dt = date_create( $r['startedAt'] );
				if ( $dt ) {
					$started_at = gmdate( 'Y-m-d H:i:s', $dt->getTimestamp() );
				}
			}
			if ( ! empty( $r['finishedAt'] ) ) {
				$dt = date_create( $r['finishedAt'] );
				if ( $dt ) {
					$completed_at = gmdate( 'Y-m-d H:i:s', $dt->getTimestamp() );
				}
			}

			// flags - try several keys
			$flags = array();
			if ( ! empty( $r['flags'] ) && is_array( $r['flags'] ) ) {
				$flags = $r['flags'];
			} elseif ( ! empty( $r['violations'] ) && is_array( $r['violations'] ) ) {
				$flags = $r['violations'];
			}

			// find local row
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT id FROM $t WHERE session_id=%s LIMIT 1", $session ), ARRAY_A );
			if ( ! $row ) {
				// Not found — optionally insert a new row or skip. Here we skip and log.
				$errors[] = "session_not_found: {$session}";
				++$skipped;
				continue;
			}

			// prepare update array
			$update = array(
				'integrity_score'  => $score,
				'flags_json'       => ! empty( $flags ) ? wp_json_encode( $flags ) : null,
				'raw_payload_json' => wp_json_encode( $r ),
				'updated_at'       => current_time( 'mysql' ),
			);
			if ( $completed_at ) {
				$update['completed_at'] = $completed_at;
			}
			if ( $started_at ) {
				$update['started_at'] = $started_at;
			}

			$res = $wpdb->update( $t, $update, array( 'id' => (int) $row['id'] ) );
			if ( $res === false ) {
				$errors[] = 'db_error:' . $wpdb->last_error . ' for session ' . $session;
			} else {
				++$updated;
			}
		}

		return array(
			'updated' => $updated,
			'skipped' => $skipped,
			'errors'  => $errors,
		);
	}

	/**
	 * Refresh autoproctor data.
	 *
	 * @param \WP_REST_Request $req request.
	 * @return \WP_Error|\WP_REST_Response
	 */
	public function rest_proctor_attempt_refresh( \WP_REST_Request $req ) {
		global $wpdb;
		$t       = $wpdb->prefix . 'jamrock_autoproctor_attempts';
		$session = sanitize_text_field( $req->get_param( 'session_id' ) ?: $req->get_param( 'id' ) ?: '' );
		if ( ! $session ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'missing_session_id',
				),
				400
			);
		}

		// fetch main details from v2 endpoint
		$result = $this->get_autoproctor_result( $session );
		if ( is_wp_error( $result ) ) {
			return new \WP_REST_Response(
				array(
					'ok'      => false,
					'error'   => 'ap_error',
					'message' => $result->get_error_message(),
					'data'    => $result->get_error_data(),
				),
				500
			);
		}

		// Try to fetch evidence JSON (may fail if AP not give)
		$evidence = $this->ap_fetch_evidence_records( $session );
		if ( is_wp_error( $evidence ) ) {
			// not fatal: we still proceed with result but log for debug
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( '[AP REFRESH] evidence fetch failed: ' . $evidence->get_error_message() );
			}
			$evidence = null;
		}

		// Map fields to DB columns (like webhook did)
		$score = isset( $result['integrity_score'] ) ? floatval( $result['integrity_score'] ) : ( isset( $result['trustScore'] ) ? floatval( $result['trustScore'] ) : null );
		$flags = is_array( $result['flags'] ?? null ) ? $result['flags'] : array();

		$update = array(
			'integrity_score'  => $score,
			'flags_json'       => $flags ? wp_json_encode( $flags ) : null,
			'raw_payload_json' => wp_json_encode( $result ),
			'updated_at'       => current_time( 'mysql' ),
		);
		if ( $evidence ) {
			$update['evidence_json'] = wp_json_encode( $evidence );
			// Optionally derive flags from evidence (for tab/noise counts) and append into flags_json
			// e.g. merge evidence 'primary_device_evidence' where violation==true into flags list
			try {
				$derived = array();
				if ( ! empty( $evidence['primary_device_evidence'] ) && is_array( $evidence['primary_device_evidence'] ) ) {
					foreach ( $evidence['primary_device_evidence'] as $it ) {
						$derived[] = array(
							'type'         => $it['label'] ?? ( $it['violation'] ? 'violation' : 'event' ),
							'ts'           => $it['occurred_at_ISO'] ?? ( $it['recorded_at_ISO'] ?? null ),
							'evidence_url' => $it['evidence_url'] ?? null,
							'violation'    => ! empty( $it['violation'] ),
						);
					}
				}
				if ( $derived ) {
					// merge with any existing flags
					$existing             = is_array( $flags ) ? $flags : array();
					$merged               = array_merge( $existing, $derived );
					$update['flags_json'] = wp_json_encode( $merged );
				}
			} catch ( \Throwable $e ) {
				if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
					error_log( '[AP REFRESH] derived flags failed: ' . $e->getMessage() );
				}
			}
		}

		$res = $wpdb->update( $t, $update, array( 'session_id' => $session ) );
		if ( false === $res ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'db_update_failed',
				),
				500
			);
		}

		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE session_id=%s LIMIT 1", $session ), ARRAY_A );
		return rest_ensure_response(
			array(
				'ok'      => true,
				'attempt' => $row,
			)
		);
	}

	/**
	 * Summary of rest_autoproctor_attempts_list
	 *
	 * @param \WP_REST_Request $req
	 * @return \WP_Error|\WP_REST_Response
	 */
	public function rest_autoproctor_attempts_list( \WP_REST_Request $req ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_autoproctor_attempts';

		$page     = max( 1, (int) $req->get_param( 'page' ) );
		$per_page = max( 1, min( 100, (int) $req->get_param( 'per_page', 10 ) ) );
		$offset   = ( $page - 1 ) * $per_page;

		// optional filters (status/candidness etc) — adapt to your DB columns
		$where = array();
		$args  = array();

		// provider is autoproctor by design; but keep filter for compatibility
		$provider = $req->get_param( 'provider' );
		if ( $provider ) {
			$where[] = 'provider = %s';
			$args[]  = $provider;
		}

		$candidness = $req->get_param( 'candidness' );
		if ( $candidness ) {
			// map candidness to flags or status column; example uses flags_json
			if ( $candidness === 'flagged' ) {
				$where[] = 'flags_json IS NOT NULL AND flags_json <> ""';
			} elseif ( $candidness === 'completed' ) {
				$where[] = 'completed_at IS NOT NULL';
			} elseif ( $candidness === 'pending' ) {
				$where[] = 'integrity_score IS NULL';
			}
		}

		$where_sql = '';
		if ( ! empty( $where ) ) {
			$where_sql = 'WHERE ' . implode( ' AND ', $where );
		}

		// total
		$count_sql = $wpdb->prepare( "SELECT COUNT(1) FROM $t $where_sql", $args );
		$total     = (int) $wpdb->get_var( $count_sql );

		// items
		$sql  = $wpdb->prepare( "SELECT * FROM $t $where_sql ORDER BY created_at DESC LIMIT %d OFFSET %d", array_merge( $args, array( $per_page, $offset ) ) );
		$rows = $wpdb->get_results( $sql, ARRAY_A );

		// map DB columns to frontend fields expected by Vue
		$items = array_map(
			function ( $r ) {
				return array(
					'id'            => (int) $r['id'],
					'provider'      => $r['provider'],
					'first_name'    => '', // optional: parse from raw_payload_json if available
					'last_name'     => '',
					'email'         => $r['user_email'] ?? null,
					'session_id'    => $r['session_id'],
					'completed_at'  => $r['completed_at'],
					'created_at'    => $r['created_at'],
					'overall_score' => isset( $r['integrity_score'] ) ? $r['integrity_score'] : null,
					'candidness'    => ( isset( $r['integrity_score'] ) && $r['integrity_score'] !== null ) ? 'completed' : 'pending',
					'flags'         => $r['flags_json'] ? json_decode( $r['flags_json'], true ) : array(),
					'raw'           => $r['raw_payload_json'] ? json_decode( $r['raw_payload_json'], true ) : null,
				);
			},
			$rows
		);

		return rest_ensure_response(
			array(
				'ok'       => true,
				'items'    => $items,
				'total'    => $total,
				'page'     => $page,
				'per_page' => $per_page,
			)
		);
	}
}
