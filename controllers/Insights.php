<?php
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class Insights {


	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/insights/events',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true', // allow public (we validate body)
				'callback'            => array( $this, 'rest_log_event' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/insights/active-users',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'read' ); },
				'callback'            => array( $this, 'rest_insights_active_users' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/insights/searches',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'read' ); },
				'callback'            => array( $this, 'rest_insights_searches' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/insights/time-spent',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return current_user_can( 'read' ); },
				'callback'            => array( $this, 'rest_insights_time_spent' ),
			)
		);
	}

	/**
	 * POST /jamrock/v1/insights/events
	 */
	public function rest_log_event( \WP_REST_Request $req ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_dashboard_events';

		$params = $req->get_json_params() ?: array();
		if ( empty( $params['event'] ) && empty( $params['event_key'] ) ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'missing_event',
				)
			);
		}

		$event_key   = sanitize_text_field( $params['event'] ?? $params['event_key'] );
		$user_id     = get_current_user_id() ?: ( ! empty( $params['user_id'] ) ? intval( $params['user_id'] ) : null );
		$actor_type  = sanitize_text_field( $params['actor_type'] ?? 'candidate' );
		$context_key = isset( $params['context_key'] ) ? sanitize_text_field( $params['context_key'] ) : null;
		$context_id  = isset( $params['context_id'] ) ? sanitize_text_field( (string) $params['context_id'] ) : null;
		$meta        = isset( $params['meta'] ) ? wp_json_encode( $params['meta'] ) : null;

		$insert = $wpdb->insert(
			$t,
			array(
				'user_id'     => $user_id,
				'actor_type'  => $actor_type,
				'event_key'   => $event_key,
				'context_key' => $context_key,
				'context_id'  => $context_id,
				'meta'        => $meta,
				'created_at'  => current_time( 'mysql' ),
			)
		);

		if ( false === $insert ) {
			if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
				error_log( '[INSIGHTS] insert failed: ' . $wpdb->last_error );
			}
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'db_insert_failed',
				),
				500
			);
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * GET /jamrock/v1/insights/active-users?days=7
	 */
	public function rest_insights_active_users( \WP_REST_Request $req ) {
		global $wpdb;
		$t    = $wpdb->prefix . 'jamrock_dashboard_events';
		$days = intval( $req->get_param( 'days' ) ?? 7 );
		$days = max( 1, min( 90, $days ) );

		// group by date, count distinct user_id (only non-null)
		$sql = $wpdb->prepare(
			"
            SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as unique_users
            FROM $t
            WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL %d DAY)
              AND user_id IS NOT NULL
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        ",
			$days
		);

		$rows = $wpdb->get_results( $sql, ARRAY_A );
		return rest_ensure_response(
			array(
				'ok'    => true,
				'items' => $rows,
			)
		);
	}

	/**
	 * GET /jamrock/v1/insights/searches?limit=20
	 */
	public function rest_insights_searches( \WP_REST_Request $req ) {
		global $wpdb;
		$t     = $wpdb->prefix . 'jamrock_dashboard_events';
		$limit = intval( $req->get_param( 'limit' ) ?? 20 );

		// Attempt JSON_EXTRACT (MySQL 5.7+). If not available, fallback to PHP parsing.
		$supports_json_extract = true;
		try {
			$res = $wpdb->get_var( "SELECT JSON_EXTRACT('{\"a\":1}','$.a')" );
			if ( is_null( $res ) ) {
				$supports_json_extract = false;
			}
		} catch ( \Throwable $e ) {
			$supports_json_extract = false;
		}

		if ( $supports_json_extract ) {
			$sql  = $wpdb->prepare(
				"
                SELECT JSON_UNQUOTE(JSON_EXTRACT(meta,'$.query')) AS query, COUNT(*) AS cnt
                FROM $t
                WHERE event_key = 'search'
                  AND JSON_EXTRACT(meta,'$.query') IS NOT NULL
                GROUP BY query
                ORDER BY cnt DESC
                LIMIT %d
            ",
				$limit
			);
			$rows = $wpdb->get_results( $sql, ARRAY_A );
			// normalize empty keys
			$items = array_map(
				function ( $r ) {
					return array(
						'query' => $r['query'] ?? '',
						'cnt'   => intval( $r['cnt'] ),
					);
				},
				$rows
			);
			return rest_ensure_response(
				array(
					'ok'    => true,
					'items' => $items,
				)
			);
		}

		// fallback: fetch raw rows and aggregate in PHP
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"
            SELECT meta FROM $t WHERE event_key='search' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        "
			),
			ARRAY_A
		);

		$counts = array();
		foreach ( $rows as $r ) {
			$m = json_decode( $r['meta'] ?? '{}', true );
			$q = isset( $m['query'] ) ? trim( mb_strtolower( $m['query'] ) ) : '';
			if ( $q === '' ) {
				continue;
			}
			if ( ! isset( $counts[ $q ] ) ) {
				$counts[ $q ] = 0;
			}
			++$counts[ $q ];
		}
		arsort( $counts );
		$items = array();
		$i     = 0;
		foreach ( $counts as $q => $c ) {
			$items[] = array(
				'query' => $q,
				'cnt'   => $c,
			);
			if ( ++$i >= $limit ) {
				break;
			}
		}
		return rest_ensure_response(
			array(
				'ok'    => true,
				'items' => $items,
			)
		);
	}

	/**
	 * GET /jamrock/v1/insights/time-spent?days=7
	 * expects activity_ping events with meta.seconds = integer
	 */
	public function rest_insights_time_spent( \WP_REST_Request $req ) {
		global $wpdb;
		$t    = $wpdb->prefix . 'jamrock_dashboard_events';
		$days = intval( $req->get_param( 'days' ) ?? 7 );
		$days = max( 1, min( 90, $days ) );

		// MySQL JSON extraction if available
		$supports_json_extract = true;
		try {
			$res = $wpdb->get_var( "SELECT JSON_EXTRACT('{\"a\":1}','$.a')" );
			if ( is_null( $res ) ) {
				$supports_json_extract = false;
			}
		} catch ( \Throwable $e ) {
			$supports_json_extract = false;
		}

		if ( $supports_json_extract ) {
			$sql  = $wpdb->prepare(
				"
                SELECT DATE(created_at) as day,
                  SUM(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(meta,'$.seconds')) AS UNSIGNED),0)) AS seconds
                FROM $t
                WHERE event_key = 'activity_ping' AND created_at >= DATE_SUB(CURRENT_DATE, INTERVAL %d DAY)
                GROUP BY DATE(created_at)
                ORDER BY day ASC
            ",
				$days
			);
			$rows = $wpdb->get_results( $sql, ARRAY_A );
			return rest_ensure_response(
				array(
					'ok'    => true,
					'items' => $rows,
				)
			);
		}

		// fallback: fetch and aggregate in PHP
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"
            SELECT created_at, meta FROM $t WHERE event_key='activity_ping' AND created_at >= DATE_SUB(CURRENT_DATE, INTERVAL %d DAY)
        ",
				$days
			),
			ARRAY_A
		);

		$agg = array();
		foreach ( $rows as $r ) {
			$day = date( 'Y-m-d', strtotime( $r['created_at'] ) );
			$m   = json_decode( $r['meta'] ?? '{}', true );
			$sec = isset( $m['seconds'] ) ? intval( $m['seconds'] ) : 0;
			if ( ! isset( $agg[ $day ] ) ) {
				$agg[ $day ] = 0;
			}
			$agg[ $day ] += $sec;
		}
		ksort( $agg );
		$items = array();
		foreach ( $agg as $day => $seconds ) {
			$items[] = array(
				'day'     => $day,
				'seconds' => $seconds,
			);
		}
		return rest_ensure_response(
			array(
				'ok'    => true,
				'items' => $items,
			)
		);
	}
}
