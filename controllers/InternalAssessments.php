<?php
/**
 * Internal Assessments Controller.
 *
 * Listens to GF submissions for Physical, Skills, Medical and updates composite.
 *
 * @package Jamrock\Controllers
 * @since 1.0.0
 */

namespace Jamrock\Controllers;

use Jamrock\Services\Composite as CompositeService;

defined( 'ABSPATH' ) || exit;

class InternalAssessments {


	/** You can also read these from options if you prefer. */
	private $form_physical;
	private $form_skills;
	private $form_medical;

	public function __construct( int $form_physical = 2, int $form_skills = 3, int $form_medical = 4 ) {
		$this->form_physical = $form_physical;
		$this->form_skills   = $form_skills;
		$this->form_medical  = $form_medical;
	}

	/** Wire GF hooks. */
	public function hooks(): void {
		add_action( "gform_after_submission_{$this->form_physical}", array( $this, 'on_physical' ), 10, 2 );
		add_action( "gform_after_submission_{$this->form_skills}", array( $this, 'on_skills' ), 10, 2 );
		add_action( "gform_after_submission_{$this->form_medical}", array( $this, 'on_medical' ), 10, 2 );

		// Optional: Manual admin button could trigger this.
		add_action( 'jamrock_composite_recompute', array( $this, 'recompute_from_snapshot' ), 10, 1 );
	}

	/**
	 * Summary of on_physical
	 *
	 * @param mixed $entry
	 * @param mixed $form
	 * @return void
	 */
	public function on_physical( $entry, $form ): void {
		error_log( '[JRJ] on_physical fired entry=' . rgar( $entry, 'id' ) );
		$email        = $this->val( $entry, $this->find_input( $form, 'applicant_email' ), '' );
		$applicant_id = $this->get_applicant_id_by_email( $email );
		if ( ! $applicant_id ) {
			return;
		}

		$vals = array(
			(float) $this->val( $entry, $this->find_input( $form, 'phys_strength' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'phys_endurance' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'phys_flexibility' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'phys_posture' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'phys_safety' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'phys_hygiene' ), 0 ),
		);

		$max  = 20.0; // from above 6 x 5 = 30. like phys_strength x 5, phys_endurance x 5, ..
		$raw  = array_sum( $vals );
		$norm = ( $max > 0 ) ? round( ( $raw / $max ) * 100, 0 ) : 0;
		$norm = self::clamp100( $norm );

		$flags     = array();
		$integrity = strtolower( (string) $this->val( $entry, $this->find_input( $form, 'integrity_flag' ), '' ) );
		if ( in_array( $integrity, array( 'minor', 'severe' ), true ) ) {
			$flags[] = 'integrity_' . $integrity;
		}

		error_log( '[JRJ] on_physical fired norm=' . $norm . ' raw=' . $raw );

		CompositeService::update_component_and_recompute(
			$applicant_id,
			'physical',
			array(
				'raw'   => $raw,
				'norm'  => $norm,
				'flags' => $flags,
				'meta'  => array( 'entry_id' => (int) rgar( $entry, 'id' ) ),
			)
		);
		error_log( "[JRJ DEBUG] on_physical done: raw={$raw}, norm={$norm}, applicant_id={$applicant_id}" );
	}

	/** Skills form handler. */
	public function on_skills( $entry, $form ): void {
		error_log( '[JRJ] on_skill fired entry=' . rgar( $entry, 'id' ) );
		$email        = $this->val( $entry, $this->find_input( $form, 'applicant_email' ), '' );
		$applicant_id = $this->get_applicant_id_by_email( $email );
		if ( ! $applicant_id ) {
			return;
		}

		$vals = array(
			(float) $this->val( $entry, $this->find_input( $form, 'knife_skills' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'line_speed' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'food_safety' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'station_cleanliness' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'teamwork' ), 0 ),
			(float) $this->val( $entry, $this->find_input( $form, 'communication' ), 0 ),
		);
		$max  = 20.0; // from above knife_skills, line_speed, .. 6 x 5 = 30. but clients says 20.
		$raw  = array_sum( $vals );
		$norm = ( $max > 0 ) ? round( ( $raw / $max ) * 100, 0 ) : 0;
		$norm = self::clamp100( $norm );

		$flags     = array();
		$integrity = strtolower( (string) $this->val( $entry, $this->find_input( $form, 'integrity_flag' ), '' ) );
		if ( in_array( $integrity, array( 'minor', 'severe' ), true ) ) {
			$flags[] = 'integrity_' . $integrity;
		}

		error_log( '[JRJ] on_skill fired norm=' . $norm . ' raw=' . $raw );

		CompositeService::update_component_and_recompute(
			$applicant_id,
			'skills',
			array(
				'raw'   => $raw,
				'norm'  => $norm,
				'flags' => $flags,
				'meta'  => array( 'entry_id' => (int) rgar( $entry, 'id' ) ),
			)
		);

		error_log( "[JRJ DEBUG] on_skill done: raw={$raw}, norm={$norm}, applicant_id={$applicant_id}" );
	}


	/** Medical form handler. */
	public function on_medical( $entry, $form ): void {
		$email        = $this->val( $entry, $this->find_input( $form, 'applicant_email' ), '' );
		$applicant_id = $this->get_applicant_id_by_email( $email );
		if ( ! $applicant_id ) {
			return;
		}

		$flags    = array();
		$raw_norm = $this->val( $entry, $this->find_input( $form, 'medical_raw' ), '' );

		// thresholds (could be moved to options later)
		$th = get_option(
			'jrj_med_thresholds',
			array(
				'cleared_min'      => 80, // >=80 => cleared
				'restrictions_min' => 40, // >=40 and <80 => restrictions
			)
		);

		// sanity
		$clearedMin = max( 0, min( 100, (float) $th['cleared_min'] ) );
		$restrMin   = max( 0, min( $clearedMin, (float) $th['restrictions_min'] ) );

		$flags = array();
		$raw   = null;
		$norm  = 0;

		// Prefer numeric raw 0–100 if provided
		$raw_norm = $this->val( $entry, $this->find_input( $form, 'medical_raw' ), '' );
		if ( $raw_norm !== '' && is_numeric( $raw_norm ) ) {
			$raw  = (float) $raw_norm;
			$norm = self::clamp100( round( $raw, 0 ) );

			if ( $norm >= $clearedMin ) {
				// cleared (no extra flag)
			} elseif ( $norm >= $restrMin ) {
				$flags[] = 'restrictions';
			} else {
				$flags[] = 'not_cleared';
			}
		} else {
			// Fallback to radio when no numeric raw is given
			$clearance = strtolower( (string) $this->val( $entry, $this->find_input( $form, 'med_clearance' ), '' ) );
			if ( $clearance === 'cleared' ) {
				$norm = 100;
			} elseif ( $clearance === 'cleared_restrictions' ) {
				$norm    = 70;
				$flags[] = 'restrictions';
			} else {
				$norm    = 0;
				$flags[] = 'not_cleared';
			}
			$norm = self::clamp100( $norm );
		}

		// Checkbox flags
		$fid = $this->find_input( $form, 'medical_flags' );
		if ( $fid ) {
			$fieldObj = null;
			foreach ( $form['fields'] as $f ) {
				if ( (string) $f->id === (string) $fid ) {
					$fieldObj = $f;
					break;
				}
			}
			if ( $fieldObj && ! empty( $fieldObj->choices ) && is_array( $fieldObj->choices ) ) {
				for ( $i = 1; $i <= count( $fieldObj->choices ); $i++ ) {
					$v = rgar( $entry, $fid . '.' . $i );
					if ( $v !== '' ) {
						$flags[] = 'risk_' . preg_replace( '/[^a-z0-9_]/', '_', strtolower( $v ) );
					}
				}
			}
		}

		error_log( '[JRJ] on_medical fired norm=' . $norm . ' raw=' . $raw );

		CompositeService::update_component_and_recompute(
			$applicant_id,
			'medical',
			array(
				'raw'   => $raw,
				'norm'  => $norm,
				'flags' => $flags,
				'meta'  => array( 'entry_id' => (int) rgar( $entry, 'id' ) ),
			)
		);

		error_log( "[JRJ DEBUG] on_medical done: raw={$raw}, norm={$norm}, applicant_id={$applicant_id}" );
	}

	/** Recompute convenience if you later add a “Recompute” admin button. */
	public function recompute_from_snapshot( int $applicant_id ): void {
		// Just touch current components to trigger recompute.
		// We read-modify-write with the existing snapshot by calling the service with no change.
		$components = ( new \ReflectionClass( CompositeService::class ) )
			->getMethod( 'get_components_snapshot' );
		$components->setAccessible( true );
		$current = $components->invoke( null, $applicant_id );

		if ( is_array( $current ) ) {
			$recompute = ( new \ReflectionClass( CompositeService::class ) )
				->getMethod( 'recompute_and_persist' );
			$recompute->setAccessible( true );
			$recompute->invoke( null, $applicant_id, $current );
		}
	}

	/* ----------------------- helpers ----------------------- */

	/** Find a field id by inputName; fallback by label contains if needed. */
	private function find_input( $form, string $input_name, string $fallback_label_contains = '' ) {
		if ( isset( $form['fields'] ) && is_array( $form['fields'] ) ) {
			foreach ( $form['fields'] as $f ) {
				if ( isset( $f->inputName ) && $f->inputName === $input_name ) {
					return (string) $f->id;
				}
			}
			if ( $fallback_label_contains ) {
				foreach ( $form['fields'] as $f ) {
					if ( isset( $f->label ) && stripos( $f->label, $fallback_label_contains ) !== false ) {
						return (string) $f->id;
					}
				}
			}
		}
		return null;
	}

	/** Safe read from entry with default. */
	private function val( $entry, $field_id, $default = '' ) {
		if ( $field_id === null ) {
			return $default;
		}
		$v = rgar( $entry, (string) $field_id );
		return ( $v !== null && $v !== '' ) ? $v : $default;
	}

	/** Map email → applicant id. */
	private function get_applicant_id_by_email( string $email ): int {
		if ( ! is_email( $email ) ) {
			return 0;
		}
		global $wpdb;
		$t = "{$wpdb->prefix}jamrock_applicants";
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM $t WHERE email = %s LIMIT 1",
				$email
			)
		);
	}

	/** Clamp value to 0..100 */
	private static function clamp100( $v ) {
		return max( 0, min( 100, (float) $v ) );
	}
}
