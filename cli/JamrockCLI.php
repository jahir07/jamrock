<?php
/**
 * Jamrock WP-CLI commands.
 *
 * @package Jamrock
 * @since   1.0.0
 */
namespace Jamrock\CLI;

use WP_CLI;

defined( 'ABSPATH' ) || exit;

class JamrockCLI {


	/**
	 * Backfill internal GF data (physical/skills/medical) into components_json and recompute.
	 *
	 * ## OPTIONS
	 *
	 * [--id=<id>]
	 * : Only backfill a single applicant DB id. Omit to process all.
	 *
	 * [--components=<list>]
	 * : Comma-separated list: physical,skills,medical (default: all three)
	 *
	 * ## EXAMPLES
	 *   wp jamrock backfill --id=5
	 *   wp jamrock backfill --components=physical,medical
	 */
	public function backfill( $args, $assoc ) {
		if ( ! class_exists( 'GFAPI' ) ) {
			WP_CLI::error( 'Gravity Forms not active.' );
			return;
		}

		$only_id    = isset( $assoc['id'] ) ? (int) $assoc['id'] : 0;
		$components = isset( $assoc['components'] )
			? array_map( 'trim', explode( ',', strtolower( $assoc['components'] ) ) )
			: array( 'physical', 'skills', 'medical' );

		global $wpdb;
		$app_t = "{$wpdb->prefix}jamrock_applicants";
		$ids   = $only_id ? array( $only_id ) : $wpdb->get_col( "SELECT id FROM $app_t" );

		// Read form ids & max values from options (with sane fallbacks)
		$form_physical = (int) get_option( 'jrj_form_physical_id', 0 ) ?: 2;
		$form_skills   = (int) get_option( 'jrj_form_skills_id', 0 ) ?: 3;
		$form_medical  = (int) get_option( 'jrj_form_medical_id', 0 ) ?: 4;

		$weights = get_option( 'jrj_comp_weights' ); // adjust to 20/30 per your final choice

		$phys_max   = $weights['physical']; // adjust to 20/30 per your final choice
		$skills_max = $weights['skills'];

		foreach ( $ids as $aid ) {
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $app_t WHERE id=%d", $aid ), ARRAY_A );
			if ( ! $row ) {
				WP_CLI::warning( "skip #$aid (not found)" );
				continue;
			}

			$email = $row['email'];
			if ( ! is_email( $email ) ) {
				WP_CLI::warning( "skip #$aid (bad email)" );
				continue;
			}

			// -------- PHYSICAL --------
			if ( in_array( 'physical', $components, true ) && $form_physical ) {
				$en = \GFAPI::get_entries(
					$form_physical,
					array(
						'field_filters' => array(
							array(
								'key'   => '2',
								'value' => $email,
							),
						),
					),
					array(
						'key'       => 'date_created',
						'direction' => 'DESC',
					),
					array( 'page_size' => 1 )
				);

				if ( ! is_wp_error( $en ) && ! empty( $en ) ) {
					$e = $en[0];
					// adjust these ids to your form (here assuming 6 criteria like earlier demo)
					$vals = array(
						floatval( rgar( $e, '5' ) ),
						floatval( rgar( $e, '6' ) ),
						floatval( rgar( $e, '7' ) ),
						floatval( rgar( $e, '8' ) ),
						floatval( rgar( $e, '9' ) ),
						floatval( rgar( $e, '10' ) ),
					);
					$raw  = array_sum( array_filter( $vals, 'is_numeric' ) );
					$norm = $phys_max > 0 ? round( ( $raw / $phys_max ) * 100, 0 ) : 0;
					$norm = self::clamp100( $norm );

					\Jamrock\Services\Composite::update_component_and_recompute(
						(int) $aid,
						'physical',
						array(
							'raw'   => $raw,
							'norm'  => $norm,
							'flags' => array(),
							'meta'  => array( 'entry_id' => (int) rgar( $e, 'id' ) ),
						)
					);
				}
			}

			// -------- SKILLS --------
			if ( in_array( 'skills', $components, true ) && $form_skills ) {
				$en = \GFAPI::get_entries(
					$form_skills,
					array(
						'field_filters' => array(
							array(
								'key'   => '2',
								'value' => $email,
							),
						),
					),
					array(
						'key'       => 'date_created',
						'direction' => 'DESC',
					),
					array( 'page_size' => 1 )
				);

				if ( ! is_wp_error( $en ) && ! empty( $en ) ) {
					$e    = $en[0];
					$vals = array(
						floatval( rgar( $e, '5' ) ),
						floatval( rgar( $e, '6' ) ),
						floatval( rgar( $e, '7' ) ),
						floatval( rgar( $e, '8' ) ),
						floatval( rgar( $e, '9' ) ),
						floatval( rgar( $e, '10' ) ),
					);
					$raw  = array_sum( array_filter( $vals, 'is_numeric' ) );
					$norm = $skills_max > 0 ? round( ( $raw / $skills_max ) * 100, 0 ) : 0;
					$norm = self::clamp100( $norm );

					\Jamrock\Services\Composite::update_component_and_recompute(
						(int) $aid,
						'skills',
						array(
							'raw'   => $raw,
							'norm'  => $norm,
							'flags' => array(),
							'meta'  => array( 'entry_id' => (int) rgar( $e, 'id' ) ),
						)
					);
				}
			}

			// -------- MEDICAL --------
			if ( in_array( 'medical', $components, true ) && $form_medical ) {
				$en = \GFAPI::get_entries(
					$form_medical,
					array(
						'field_filters' => array(
							array(
								'key'   => '2',
								'value' => $email,
							),
						),
					),
					array(
						'key'       => 'date_created',
						'direction' => 'DESC',
					),
					array( 'page_size' => 1 )
				);

				if ( ! is_wp_error( $en ) && ! empty( $en ) ) {
					$e        = $en[0];
					$flags    = array();
					$raw_norm = rgar( $e, '9' );
					if ( $raw_norm !== '' && is_numeric( $raw_norm ) ) {
						$norm = self::clamp100( round( (float) $raw_norm, 0 ) );
					} else {
						$clear = strtolower( (string) rgar( $e, '5' ) );
						if ( $clear === 'cleared' ) {
							$norm = 100;
						} elseif ( $clear === 'cleared_restrictions' ) {
							$norm    = 70;
							$flags[] = 'restrictions';
						} else {
							$norm    = 0;
							$flags[] = 'not_cleared';
						}
					}

					\Jamrock\Services\Composite::update_component_and_recompute(
						(int) $aid,
						'medical',
						array(
							'raw'   => null,
							'norm'  => $norm,
							'flags' => $flags,
							'meta'  => array( 'entry_id' => (int) rgar( $e, 'id' ) ),
						)
					);
				}
			}

			// Final ensure recompute
			\Jamrock\Services\Composite::recompute_now( (int) $aid );
			WP_CLI::success( "Backfilled & recomputed #$aid" );
		}
	}

	/**
	 * Recompute composite using stored components_json.
	 *
	 * ## OPTIONS
	 * --id=<id>
	 */
	public function recompute( $args, $assoc ) {
		$id = isset( $assoc['id'] ) ? (int) $assoc['id'] : 0;
		if ( $id <= 0 ) {
			WP_CLI::error( 'Missing --id' );
			return;
		}
		$res = \Jamrock\Services\Composite::recompute_now( $id );
		if ( ! empty( $res['ok'] ) ) {
			$row = $res['row'] ?: array();
			WP_CLI::success(
				sprintf(
					'✅ Recomputed: %.2f points, grade %s (%s)',
					isset( $row['composite'] ) ? (float) $row['composite'] : 0.0,
					isset( $row['grade'] ) ? $row['grade'] : 'D',
					isset( $row['status_flag'] ) ? $row['status_flag'] : 'pending'
				)
			);
		} else {
			WP_CLI::error( 'Recompute failed.' );
		}
	}

	/**
	 * Clamp a value between 0 and 100.
	 *
	 * @param float $v Value to clamp.
	 * @return float Clamped value.
	 */
	private static function clamp100( $v ) {
		return max( 0, min( 100, (float) $v ) );
	}
}
