<?php
/**
 * Applicant Score Recruiter/Manager
 *
 * Recruiter/Manager update by (?jrj_edit=1)
 *
 * @package Jamrock
 * @since   1.0.0
 */
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;
use GFAPI;
/**
 * Applicant Score Recruiter/Manager
 */
class InternalGFEdit {


	private int $physical_id;
	private int $skills_id;
	private int $medical_id;

	public function __construct( int $physical_id = 2, int $skills_id = 3, int $medical_id = 4 ) {
		$this->physical_id = $physical_id;
		$this->skills_id   = $skills_id;
		$this->medical_id  = $medical_id;
	}

	public function hooks(): void {
		// Pre-fill (render/submission filter দুটোই ভালো প্র্যাকটিস)
		add_filter( "gform_pre_render_{$this->physical_id}", array( $this, 'prefill' ) );
		add_filter( "gform_pre_submission_filter_{$this->physical_id}", array( $this, 'prefill' ) );

		add_filter( "gform_pre_render_{$this->skills_id}", array( $this, 'prefill' ) );
		add_filter( "gform_pre_submission_filter_{$this->skills_id}", array( $this, 'prefill' ) );

		add_filter( "gform_pre_render_{$this->medical_id}", array( $this, 'prefill' ) );
		add_filter( "gform_pre_submission_filter_{$this->medical_id}", array( $this, 'prefill' ) );

		// Update instead of insert: ঐ entry-টাই আপডেট হবে
		add_filter( "gform_entry_id_pre_save_lead_{$this->physical_id}", array( $this, 'maybe_update_entry' ), 10, 2 );
		add_filter( "gform_entry_id_pre_save_lead_{$this->skills_id}", array( $this, 'maybe_update_entry' ), 10, 2 );
		add_filter( "gform_entry_id_pre_save_lead_{$this->medical_id}", array( $this, 'maybe_update_entry' ), 10, 2 );
	}

	/** prefill previous entry values when ?jrj_edit=1 & applicant_email present */
	public function prefill( $form ) {
		if ( empty( $_GET['jrj_edit'] ) ) {
			return $form;
		}

		$email = sanitize_email( $_GET['applicant_email'] ?? '' );
		if ( ! $email ) {
			return $form;
		}

		$latest_id = self::jrj_latest_entry_id( (int) $form['id'], $email );
		if ( ! $latest_id ) {
			return $form;
		}

		if ( ! class_exists( 'GFAPI' ) ) {
			return $form;
		}
		$entry = GFAPI::get_entry( $latest_id );
		if ( \is_wp_error( $entry ) || empty( $entry ) ) {
			return $form;
		}

		// defaultValue
		foreach ( $form['fields'] as &$field ) {
			$id                  = (string) $field->id;
			$field->defaultValue = rgar( $entry, $id );
		}
		unset( $field );

		add_filter( 'gform_field_value_jrj_entry_id', fn() => $latest_id );

		return $form;
	}

	/** Submit - entry update (when ?jrj_edit=1) */
	public function maybe_update_entry( $entry_id, $form ) {
		if ( empty( $_GET['jrj_edit'] ) ) {
			return $entry_id;
		}

		$email = sanitize_email( $_GET['applicant_email'] ?? '' );
		if ( ! $email ) {
			return $entry_id;
		}

		$latest_id = self::jrj_latest_entry_id( (int) $form['id'], $email );
		return $latest_id ?: $entry_id;
	}

	function jrj_latest_entry_id( int $form_id, string $email ): int {
		if ( ! class_exists( 'GFAPI' ) ) {
			return 0;
		}
		$email = sanitize_email( $email );
		if ( ! $email ) {
			return 0;
		}

		$search  = array(
			'field_filters' => array(
				array(
					'key'   => 'applicant_email',
					'value' => $email,
				),
			),
		);
		$sorting = array(
			'key'       => 'id',
			'direction' => 'DESC',
		);
		$paging  = array( 'page_size' => 1 );

		$entries = GFAPI::get_entries( $form_id, $search, $sorting, $paging );
		if ( is_wp_error( $entries ) || empty( $entries ) ) {
			return 0;
		}

		return intval( $entries[0]['id'] );
	}
}
