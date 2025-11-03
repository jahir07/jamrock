<?php
/**
 * Composite Controller.
 *
 * Provides REST endpoints for retrieving and recomputing
 * applicant composite scores and managing scoring options.
 *
 * @package Jamrock
 * @since   1.0.0
 */
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class Composite {


	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	public function routes(): void {

		// GET applicant composite
		register_rest_route(
			'jamrock/v1',
			'/applicants/(?P<id>\d+)/composite',
			array(
				'methods'             => 'GET',
				'permission_callback' => array( $this, 'can_manage' ),
				'callback'            => array( $this, 'get_applicant_composite' ),
			)
		);

		// POST recompute applicant composite
		register_rest_route(
			'jamrock/v1',
			'/applicants/(?P<id>\d+)/composite/recompute',
			array(
				'methods'             => 'POST',
				'permission_callback' => array( $this, 'can_manage' ),
				'callback'            => array( $this, 'recompute_applicant_composite' ),
			)
		);

		// GET settings composite options
		register_rest_route(
			'jamrock/v1',
			'/composite/options',
			array(
				'methods'             => 'GET',
				'permission_callback' => array( $this, 'can_manage' ),
				'callback'            => array( $this, 'get_composite_options' ),
			)
		);

		// POST settings composite options
		register_rest_route(
			'jamrock/v1',
			'/composite/options',
			array(
				'methods'             => 'POST',
				'permission_callback' => array( $this, 'can_manage' ),
				'callback'            => array( $this, 'save_composite_options' ),
			)
		);
	}

	// =============== Permissions =======================
	public function can_manage(): bool {
		return current_user_can( 'manage_options' );
	}

	// =============== /applicants/{id}/composite =======================
	public function get_applicant_composite( \WP_REST_Request $req ) {
		global $wpdb;
		$id = (int) $req['id'];
		if ( $id <= 0 ) {
			return new \WP_REST_Response( array( 'error' => 'bad_id' ), 400 );
		}

		$t   = $wpdb->prefix . 'jamrock_applicant_composites';
		$row = $wpdb->get_row(
			$wpdb->prepare( "SELECT * FROM $t WHERE applicant_id=%d LIMIT 1", $id ),
			ARRAY_A
		); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		if ( ! $row ) {
			return rest_ensure_response(
				array(
					'exists'      => false,
					'status_flag' => 'pending',
				)
			);
		}

		return rest_ensure_response(
			array(
				'exists'      => true,
				'status_flag' => (string) $row['status_flag'],
				'composite'   => (float) $row['composite'],
				'grade'       => (string) $row['grade'],
				'weights'     => json_decode( (string) $row['weights_json'], true ) ?: array(),
				'thresholds'  => json_decode( (string) $row['thresholds_json'], true ) ?: array(),
				'formula'     => (string) $row['formula_version'],
				'components'  => json_decode( (string) $row['components_json'], true ) ?: array(),
				'computed_at' => (string) $row['computed_at'],
			)
		);
	}

	// =============== /applicants/{id}/composite/recompute =======================
	public function recompute_applicant_composite( \WP_REST_Request $req ) {
		$id = (int) $req['id'];
		if ( $id <= 0 ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'bad_id',
				),
				400
			);
		}

		$res = \Jamrock\Services\Composite::recompute_now( $id );
		if ( empty( $res['ok'] ) ) {
			return new \WP_REST_Response( $res, 500 );
		}

		$row = $res['row'] ?: array();
		return rest_ensure_response(
			array(
				'ok'          => true,
				'status'      => $row['status_flag'] ?? 'pending',
				'composite'   => isset( $row['composite'] ) ? (float) $row['composite'] : 0.0,
				'grade'       => $row['grade'] ?? 'D',
				'computed_at' => $row['computed_at'] ?? null,
			)
		);
	}

	// =============== /composite/options (GET) =======================
	public function get_composite_options() {
		$weights = get_option(
			'jrj_comp_weights',
			array(
				'psymetrics'  => 40,
				'autoproctor' => 20,
				'physical'    => 20,
				'skills'      => 20,
				'medical'     => 0,
			)
		);
		$bands   = get_option(
			'jrj_comp_bands',
			array(
				'A' => 85,
				'B' => 70,
				'C' => 55,
				'D' => 0,
			)
		);

		return rest_ensure_response(
			array(
				'weights' => $weights,
				'bands'   => $bands,
			)
		);
	}

	// =============== /composite/options (POST) =======================
	public function save_composite_options( \WP_REST_Request $req ) {
		$b = $req->get_json_params() ?: array();
		$w = isset( $b['weights'] ) && is_array( $b['weights'] ) ? $b['weights'] : array();
		$g = isset( $b['bands'] ) && is_array( $b['bands'] ) ? $b['bands'] : array();

		// sanitize
		$defW = array(
			'psymetrics'  => 40,
			'autoproctor' => 20,
			'physical'    => 20,
			'skills'      => 20,
			'medical'     => 0,
		);
		foreach ( $defW as $k => $v ) {
			$defW[ $k ] = isset( $w[ $k ] ) ? max( 0.0, floatval( $w[ $k ] ) ) : $v;
		}

		$defB = array(
			'A' => 85,
			'B' => 70,
			'C' => 55,
			'D' => 0,
		);
		foreach ( $defB as $k => $v ) {
			if ( isset( $g[ $k ] ) ) {
				$defB[ $k ] = floatval( $g[ $k ] );
			}
		}

		update_option( 'jrj_comp_weights', $defW );
		update_option( 'jrj_comp_bands', $defB );

		return rest_ensure_response(
			array(
				'ok'      => true,
				'weights' => $defW,
				'bands'   => $defB,
			)
		);
	}
}
