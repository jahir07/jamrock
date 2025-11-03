<?php
/**
 * Composite.
 *
 * Holds and recomputes Applicant Composite Score from components:
 * - psymetrics, autoproctor, physical, skills, medical.
 * Stores merged component snapshot in jamrock_applicant_composites and
 * also appends an audit row to jamrock_applicant_composite_history.
 *
 * @package Jamrock\Services
 * @since 1.0.0
 */

namespace Jamrock\Services;

defined( 'ABSPATH' ) || exit;

class Composite {


	/** Version bump when you change formula details. */
	private const FORMULA_VERSION = 'v1';

	/**
	 * Merge/update a single component for an applicant, then recompute composite.
	 *
	 * @param int    $applicant_id Applicant DB id.
	 * @param string $key          Component key. One of: psymetrics|autoproctor|physical|skills|medical.
	 * @param array  $payload      Must include at least: ['raw'=>?, 'norm'=>?, 'flags'=>[], 'meta'=>[]].
	 */
	public static function update_component_and_recompute( int $applicant_id, string $key, array $payload ): void {
		if ( $applicant_id <= 0 ) {
			return;
		}
		$key = strtolower( $key );

		$components = self::get_components_snapshot( $applicant_id );

		// Ensure payload shape.
		$component = array(
			'raw'   => isset( $payload['raw'] ) ? floatval( $payload['raw'] ) : null,
			'norm'  => isset( $payload['norm'] ) ? min( 100.0, max( 0.0, floatval( $payload['norm'] ) ) ) : null,
			'flags' => isset( $payload['flags'] ) && is_array( $payload['flags'] ) ? array_values( $payload['flags'] ) : array(),
			'meta'  => isset( $payload['meta'] ) && is_array( $payload['meta'] ) ? $payload['meta'] : array(),
			'ts'    => current_time( 'mysql' ),
		);

		if ( isset( $component['norm'] ) && is_numeric( $component['norm'] ) ) {
			if ( $component['norm'] > 100 ) {
				$component['norm'] = 100.0;
			}
			if ( $component['norm'] < 0 ) {
				$component['norm'] = 0.0;
			}
		}

		$components[ $key ] = $component;

		self::recompute_and_persist( $applicant_id, $components );
	}

	/**
	 * Read current components snapshot for an applicant from jamrock_applicant_composites.
	 */
	private static function get_components_snapshot( int $applicant_id ): array {
		global $wpdb;
		$t = "{$wpdb->prefix}jamrock_applicant_composites";

		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT components_json FROM $t WHERE applicant_id = %d LIMIT 1",
				$applicant_id
			),
			ARRAY_A
		);

		if ( ! $row || empty( $row['components_json'] ) ) {
			return array();
		}

		$components = json_decode( $row['components_json'], true );
		return is_array( $components ) ? $components : array();
	}

	/**
	 * Core recompute logic with knockout rules, weighting, and grade bands.
	 *
	 * @param int   $applicant_id Applicant DB id.
	 * @param array $components   Merged component snapshot.
	 */
	private static function recompute_and_persist( int $applicant_id, array $components ): void {
		error_log( "[JRJ DEBUG] recompute_and_persist() triggered for applicant={$applicant_id}" );

		// Dump all current components
		error_log( '[JRJ DEBUG] Components snapshot: ' . wp_json_encode( $components ) );

		// 1) Knockouts
		$flag = 'ok';
		if ( ! empty( $components['psymetrics']['flags'] ) && is_array( $components['psymetrics']['flags'] ) ) {
			if (
				in_array( 'candidness_invalid', $components['psymetrics']['flags'], true )
				|| in_array( 'candidness_flagged', $components['psymetrics']['flags'], true )
			) {
				$flag = 'disqualified';
			}
		}
		if ( $flag === 'ok' && ! empty( $components['autoproctor']['flags'] ) && is_array( $components['autoproctor']['flags'] ) ) {
			if ( in_array( 'integrity_severe', $components['autoproctor']['flags'], true ) ) {
				$flag = 'hold';
			}
		}
		if ( $flag === 'ok' && ! empty( $components['medical']['flags'] ) && is_array( $components['medical']['flags'] ) ) {
			if ( in_array( 'not_cleared', $components['medical']['flags'], true ) ) {
				$flag = 'hold';
			}
		}

		// 2) Collect norms (clamped)
		$norms = array(
			'psymetrics'  => self::read_norm( $components, 'psymetrics' ),
			'autoproctor' => self::read_norm( $components, 'autoproctor' ),
			'physical'    => self::read_norm( $components, 'physical' ),
			'skills'      => self::read_norm( $components, 'skills' ),
			'medical'     => self::read_norm( $components, 'medical' ),
		);

		// present keys
		$present_keys = array();
		foreach ( $norms as $k => $v ) {
			if ( is_numeric( $v ) ) {
				$present_keys[] = $k;
			}
		}

		// weights (admin options or defaults)
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
		$weights = self::sanitize_weights( $weights );

		error_log( '[JRJ DEBUG] Norm values: ' . wp_json_encode( $norms ) );
		error_log( '[JRJ DEBUG] Weights before scaling: ' . wp_json_encode( $weights ) );

		$composite = 0.0;

		if ( empty( $present_keys ) ) {
			$flag    = 'pending';
			$weights = array();
		} else {
			// disqualified
			if ( $flag === 'disqualified' ) {
				$composite = 0.0;
				foreach ( $present_keys as $k ) {
					$effWeights[ $k ] = isset( $weights[ $k ] ) ? (float) $weights[ $k ] : 0.0;
				}
				error_log( '[JRJ DEBUG] Disqualified; forcing composite=0.0; effWeights=' . wp_json_encode( $effWeights ) );
			} else {
				// active weights to present only (auto-scale)
				$active = array();
				$sumW   = 0.0;
				foreach ( $present_keys as $k ) {
					$active[ $k ] = $weights[ $k ] ?? 0.0;
					$sumW        += $active[ $k ];
				}
				if ( $sumW <= 0 ) { // সব 0 হলে সমান ভাগ
					$eq = 100.0 / max( 1, count( $present_keys ) );
					foreach ( $present_keys as $k ) {
						$active[ $k ] = $eq;
					}
					$sumW = 100.0;
				}

				// ৪টির কম হলে provisional; নইলে ok/hold/disqualified যেটা আছে
				if ( $flag === 'ok' && count( $present_keys ) < 4 ) {
					$flag = 'provisional';
				}

				// weighted sum (norm already 0–100)
				$sum = 0.0;
				foreach ( $present_keys as $k ) {
					$sum += ( $active[ $k ] / $sumW ) * floatval( $norms[ $k ] );
				}
				$composite = round( $sum, 2 );

				$weights = $active; // transparency

				error_log( '[JRJ DEBUG] Active weights: ' . wp_json_encode( $weights ) );
				error_log( "[JRJ DEBUG] Composite sum before round: {$sum}" );
			}
		}

		// grade bands
		$bands = get_option(
			'jrj_comp_bands',
			array(
				'A' => 85,
				'B' => 70,
				'C' => 55,
				'D' => 0,
			)
		);
		$grade = self::grade_for( $composite, $bands );

		error_log( "[JRJ DEBUG] Final composite={$composite}, grade={$grade}, flag={$flag}" );

		self::persist(
			$applicant_id,
			array(
				'status_flag'     => $flag,
				'composite'       => $composite,
				'grade'           => $grade,
				'weights_json'    => wp_json_encode( $weights ),
				'thresholds_json' => wp_json_encode( $bands ),
				'formula_version' => self::FORMULA_VERSION,
				'components_json' => wp_json_encode( $components ),
			)
		);
	}

	/** Read norm or return null. */
	private static function read_norm( array $components, string $key ) {
		if ( ! isset( $components[ $key ]['norm'] ) || ! is_numeric( $components[ $key ]['norm'] ) ) {
			return null;
		}
		$v = (float) $components[ $key ]['norm'];
		if ( $v < 0 ) {
			$v = 0;
		}
		if ( $v > 100 ) {
			$v = 100;
		}
		return $v;
	}


	/** Ensure numeric weights and clamp to >=0. */
	private static function sanitize_weights( array $w ): array {
		$out = array();
		foreach ( array( 'psymetrics', 'autoproctor', 'physical', 'skills', 'medical' ) as $k ) {
			$out[ $k ] = isset( $w[ $k ] ) ? max( 0.0, floatval( $w[ $k ] ) ) : 0.0;
		}
		return $out;
	}

	/** Simple banding to A/B/C/D. */
	private static function grade_for( float $score, array $bands ): string {
		$a = isset( $bands['A'] ) ? floatval( $bands['A'] ) : 85;
		$b = isset( $bands['B'] ) ? floatval( $bands['B'] ) : 70;
		$c = isset( $bands['C'] ) ? floatval( $bands['C'] ) : 55;
		if ( $score >= $a ) {
			return 'A';
		}
		if ( $score >= $b ) {
			return 'B';
		}
		if ( $score >= $c ) {
			return 'C';
		}
		return 'D';
	}

	/** Upsert composite row and append history. */
	private static function persist( int $applicant_id, array $data ): void {
		global $wpdb;
		$tc = "{$wpdb->prefix}jamrock_applicant_composites";
		$th = "{$wpdb->prefix}jamrock_applicant_composite_history";

		$now = current_time( 'mysql' );
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT id FROM $tc WHERE applicant_id = %d LIMIT 1",
				$applicant_id
			),
			ARRAY_A
		);

		$payload = array(
			'applicant_id'    => $applicant_id,
			'status_flag'     => $data['status_flag'],
			'composite'       => $data['composite'],
			'grade'           => $data['grade'],
			'weights_json'    => $data['weights_json'],
			'thresholds_json' => $data['thresholds_json'],
			'formula_version' => $data['formula_version'],
			'components_json' => $data['components_json'],
			'computed_at'     => $now,
			'updated_at'      => $now,
		);

		if ( $row ) {
			$wpdb->update( $tc, $payload, array( 'id' => intval( $row['id'] ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		} else {
			$wpdb->insert( $tc, $payload ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		}

		// Append audit history.
		$wpdb->insert(
			$th,
			array(
				'applicant_id'    => $applicant_id,
				'status_flag'     => $payload['status_flag'],
				'composite'       => $payload['composite'],
				'grade'           => $payload['grade'],
				'weights_json'    => $payload['weights_json'],
				'thresholds_json' => $payload['thresholds_json'],
				'formula_version' => $payload['formula_version'],
				'components_json' => $payload['components_json'],
				'computed_at'     => $payload['computed_at'],
			)
		); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	}

	// Add this public wrapper near the end of CompositeService:
	public static function snapshot( int $applicant_id ): array {
		return self::get_components_snapshot( $applicant_id );
	}

	public static function recompute_from( array $components, int $applicant_id ): void {
		self::recompute_and_persist( $applicant_id, is_array( $components ) ? $components : array() );
	}

	/** Public: get current components snapshot for an applicant. */
	public static function get_snapshot( int $applicant_id ): array {
		global $wpdb;
		$t    = "{$wpdb->prefix}jamrock_applicant_composites";
		$row  = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT components_json FROM $t WHERE applicant_id=%d LIMIT 1",
				$applicant_id
			),
			ARRAY_A
		);
		$snap = $row && ! empty( $row['components_json'] ) ? json_decode( $row['components_json'], true ) : array();
		return is_array( $snap ) ? $snap : array();
	}

	/** Public: recompute using provided (or current) snapshot. */
	public static function recompute_now( int $applicant_id, ?array $components = null ): array {
		if ( $applicant_id <= 0 ) {
			return array(
				'ok'    => false,
				'error' => 'bad_id',
			);
		}
		if ( $components === null ) {
			$components = self::get_snapshot( $applicant_id );
		}
		self::recompute_and_persist( $applicant_id, is_array( $components ) ? $components : array() );
		global $wpdb;
		$t   = "{$wpdb->prefix}jamrock_applicant_composites";
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM $t WHERE applicant_id=%d LIMIT 1",
				$applicant_id
			),
			ARRAY_A
		);
		return array(
			'ok'  => true,
			'row' => $row ?: null,
		);
	}

	private static function clamp100( $v ) {
		return max( 0, min( 100, (float) $v ) );
	}
}
