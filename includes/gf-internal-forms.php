<?php
defined( 'ABSPATH' ) || exit;

/**
 * Safe upsert by title: exists → return id; else create → return id.
 */
function jrj_upsert_gf_form_by_title( string $title, array $form_def ): int {
	if ( ! class_exists( 'GFAPI' ) ) {
		return 0;
	}
	foreach ( GFAPI::get_forms() as $f ) {
		if ( isset( $f['title'] ) && $f['title'] === $title ) {
			return (int) $f['id'];
		}
	}
	$res = GFAPI::add_form( $form_def );
	return is_wp_error( $res ) ? 0 : (int) $res;
}

/**
 * Applicant Registration Form.
 */
function jrj_create_registration_form(): int {
	$title = 'Applicant Registration';
	$form  = array(
		'title'         => $title,
		'description'   => 'Initial registration form for applicants.',
		'button'        => array(
			'type' => 'text',
			'text' => 'Register',
		),
		'fields'        => array(
			array(
				'id'        => 1,
				'label'     => 'First Name',
				'type'      => 'text',
				'required'  => true,
				'inputName' => 'first_name',
			),
			array(
				'id'        => 2,
				'label'     => 'Last Name',
				'type'      => 'text',
				'required'  => true,
				'inputName' => 'last_name',
			),
			array(
				'id'        => 3,
				'label'     => 'Email Address',
				'type'      => 'email',
				'required'  => true,
				'inputName' => 'email',
			),
		),
		'confirmations' => array(
			array(
				'id'      => 'default',
				'type'    => 'message',
				'message' => 'Registration successful! Please check your email for next steps.',
			),
		),
	);

	if ( ! class_exists( 'GFAPI' ) ) {
		return 0;
	}

	// Safe upsert – reuse existing form if title matches.
	$forms = GFAPI::get_forms();
	foreach ( $forms as $f ) {
		if ( isset( $f['title'] ) && $f['title'] === $title ) {
			return (int) $f['id'];
		}
	}

	$res = GFAPI::add_form( $form );
	return is_wp_error( $res ) ? 0 : (int) $res;
}

/**
 * Physical Assessment (internal).
 * Fields (fixed IDs):
 *  1 applicant_id (hidden), 2 applicant_email, 3 date, 4 assessor,
 *  5–10 six criteria (0–5), 11 integrity_flag, 12 raw_total (calc), 13 normalized (calc 0–100)
 */
function jrj_create_physical_form(): int {
	$title = 'Internal – Physical';
	$form  = array(
		'title'         => $title,
		'description'   => 'Internal physical assessment (normalized 0–100).',
		'button'        => array(
			'type' => 'text',
			'text' => 'Submit',
		),
		'fields'        => array(
			// Hidden + prepopulate from URL (?applicant_id=…)
			array(
				'id'                => 1,
				'label'             => 'Applicant ID',
				'type'              => 'hidden',
				'adminOnly'         => true,
				'inputName'         => 'applicant_id',
				'allowsPrepopulate' => true,
			),
			// Email + prepopulate from URL (?applicant_email=…)
			array(
				'id'                => 2,
				'label'             => 'Applicant Email',
				'type'              => 'email',
				'required'          => true,
				'inputName'         => 'applicant_email',
				'allowsPrepopulate' => true,
			),

			array(
				'id'       => 3,
				'label'    => 'Assessment Date',
				'type'     => 'date',
				'dateType' => 'datefield',
				'required' => true,
			),
			array(
				'id'       => 4,
				'label'    => 'Assessor Name',
				'type'     => 'text',
				'required' => true,
			),

			// Six criteria (0–5)
			array(
				'id'        => 5,
				'label'     => 'Strength (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'phys_strength',
			),
			array(
				'id'        => 6,
				'label'     => 'Endurance (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'phys_endurance',
			),
			array(
				'id'        => 7,
				'label'     => 'Flexibility (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'phys_flexibility',
			),
			array(
				'id'        => 8,
				'label'     => 'Posture (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'phys_posture',
			),
			array(
				'id'        => 9,
				'label'     => 'Safety (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'phys_safety',
			),
			array(
				'id'        => 10,
				'label'     => 'Hygiene (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'phys_hygiene',
			),

			// Integrity Flag
			array(
				'id'                => 11,
				'label'             => 'Integrity Flag',
				'type'              => 'radio',
				'enableChoiceValue' => true,
				'choices'           => array(
					array(
						'text'  => 'None',
						'value' => 'none',
					),
					array(
						'text'  => 'Minor',
						'value' => 'minor',
					),
					array(
						'text'  => 'Severe',
						'value' => 'severe',
					),
				),
				'inputName'         => 'integrity_flag',
				'defaultValue'      => 'none',
			),

			// CALC: Raw Total (max 30)
			array(
				'id'           => 12,
				'label'        => 'Physical Raw Total',
				'type'         => 'number',
				'calculation'  => true,
				'formula'      => '{Strength (0–5):5} + {Endurance (0–5):6} + {Flexibility (0–5):7} + {Posture (0–5):8} + {Safety (0–5):9} + {Hygiene (0–5):10}',
				'readOnly'     => true,
				'numberFormat' => 'decimal',
			),

			// CALC: Normalized 0–100
			array(
				'id'           => 13,
				'label'        => 'Physical Normalized (0–100)',
				'type'         => 'number',
				'calculation'  => true,
				'formula'      => 'round(({Physical Raw Total:12} / 30) * 100, 0)',
				'readOnly'     => true,
				'numberFormat' => 'decimal',
			),
		),
		'confirmations' => array(
			array(
				'id'      => 'default',
				'type'    => 'message',
				'message' => 'Physical assessment saved.',
			),
		),
	);
	return jrj_upsert_gf_form_by_title( $title, $form );
}

/**
 * Skills Assessment (internal).
 */
function jrj_create_skills_form(): int {
	$title = 'Internal – Skills';
	$form  = array(
		'title'         => $title,
		'description'   => 'Checklist-based kitchen skills (normalized 0–100).',
		'button'        => array(
			'type' => 'text',
			'text' => 'Submit',
		),
		'fields'        => array(
			array(
				'id'                => 1,
				'label'             => 'Applicant ID',
				'type'              => 'hidden',
				'adminOnly'         => true,
				'inputName'         => 'applicant_id',
				'allowsPrepopulate' => true,
			),
			array(
				'id'                => 2,
				'label'             => 'Applicant Email',
				'type'              => 'email',
				'required'          => true,
				'inputName'         => 'applicant_email',
				'allowsPrepopulate' => true,
			),

			array(
				'id'       => 3,
				'label'    => 'Assessment Date',
				'type'     => 'date',
				'dateType' => 'datefield',
				'required' => true,
			),
			array(
				'id'       => 4,
				'label'    => 'Assessor Name',
				'type'     => 'text',
				'required' => true,
			),

			array(
				'id'        => 5,
				'label'     => 'Knife Skills (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'knife_skills',
			),
			array(
				'id'        => 6,
				'label'     => 'Line Speed (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'line_speed',
			),
			array(
				'id'        => 7,
				'label'     => 'Food Safety (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'food_safety',
			),
			array(
				'id'        => 8,
				'label'     => 'Station Cleanliness (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'station_cleanliness',
			),
			array(
				'id'        => 9,
				'label'     => 'Teamwork (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'teamwork',
			),
			array(
				'id'        => 10,
				'label'     => 'Communication (0–5)',
				'type'      => 'number',
				'rangeMin'  => '0',
				'rangeMax'  => '5',
				'required'  => true,
				'inputName' => 'communication',
			),

			// CALC: Raw Total
			array(
				'id'           => 11,
				'label'        => 'Skills Raw Total',
				'type'         => 'number',
				'calculation'  => true,
				'formula'      => '{Knife Skills (0–5):5} + {Line Speed (0–5):6} + {Food Safety (0–5):7} + {Station Cleanliness (0–5):8} + {Teamwork (0–5):9} + {Communication (0–5):10}',
				'readOnly'     => true,
				'numberFormat' => 'decimal',
			),

			// CALC: Normalized 0–100
			array(
				'id'           => 12,
				'label'        => 'Skills Normalized (0–100)',
				'type'         => 'number',
				'calculation'  => true,
				'formula'      => 'round(({Skills Raw Total:11} / 30) * 100, 0)',
				'readOnly'     => true,
				'numberFormat' => 'decimal',
			),

			// Integrity Flag
			array(
				'id'                => 13,
				'label'             => 'Integrity Flag',
				'type'              => 'radio',
				'enableChoiceValue' => true,
				'required'          => true,
				'choices'           => array(
					array(
						'text'  => 'None',
						'value' => 'none',
					),
					array(
						'text'  => 'Minor',
						'value' => 'minor',
					),
					array(
						'text'  => 'Severe',
						'value' => 'severe',
					),
				),
				'inputName'         => 'integrity_flag',
				'defaultValue'      => 'none',
			),

			array(
				'id'        => 14,
				'label'     => 'Notes',
				'type'      => 'textarea',
				'maxLength' => 1000,
			),
			array(
				'id'                => 15,
				'label'             => 'Attachments',
				'type'              => 'fileupload',
				'multipleFiles'     => true,
				'allowedExtensions' => 'jpg,png,pdf',
			),

		),
		'confirmations' => array(
			array(
				'id'      => 'default',
				'type'    => 'message',
				'message' => 'Skills assessment saved.',
			),
		),
	);
	return jrj_upsert_gf_form_by_title( $title, $form );
}

/**
 * Medical Assessment (internal).
 */
function jrj_create_medical_form(): int {
	$title = 'Internal – Medical';
	$form  = array(
		'title'         => $title,
		'description'   => 'Medical clearance with risk flags (normalized 0–100).',
		'button'        => array(
			'type' => 'text',
			'text' => 'Submit',
		),
		'fields'        => array(
			array(
				'id'                => 1,
				'label'             => 'Applicant ID',
				'type'              => 'hidden',
				'adminOnly'         => true,
				'inputName'         => 'applicant_id',
				'allowsPrepopulate' => true,
			),
			array(
				'id'                => 2,
				'label'             => 'Applicant Email',
				'type'              => 'email',
				'required'          => true,
				'inputName'         => 'applicant_email',
				'allowsPrepopulate' => true,
			),

			array(
				'id'       => 3,
				'label'    => 'Assessment Date',
				'type'     => 'date',
				'dateType' => 'datefield',
				'required' => true,
			),
			array(
				'id'       => 4,
				'label'    => 'Practitioner / Assessor',
				'type'     => 'text',
				'required' => true,
			),

			array(
				'id'                => 5,
				'label'             => 'Medical Clearance',
				'type'              => 'radio',
				'required'          => true,
				'enableChoiceValue' => true,
				'choices'           => array(
					array(
						'text'  => 'Cleared',
						'value' => 'cleared',
					),
					array(
						'text'  => 'Cleared with restrictions',
						'value' => 'cleared_restrictions',
					),
					array(
						'text'  => 'Not Cleared',
						'value' => 'not_cleared',
					),
				),
				'defaultValue'      => 'cleared',
				'inputName'         => 'med_clearance',
			),

			array(
				'id'                => 6,
				'label'             => 'Flags / Conditions',
				'type'              => 'checkbox',
				'enableChoiceValue' => true,
				'choices'           => array(
					array(
						'text'  => 'Respiratory',
						'value' => 'respiratory',
					),
					array(
						'text'  => 'Musculoskeletal',
						'value' => 'musculoskeletal',
					),
					array(
						'text'  => 'Cardiovascular',
						'value' => 'cardio',
					),
					array(
						'text'  => 'Contagious Risk',
						'value' => 'contagious',
					),
					array(
						'text'  => 'Medication Effects',
						'value' => 'medication_effects',
					),
				),
				'inputName'         => 'medical_flags',
			),

			array(
				'id'        => 7,
				'label'     => 'Doctor Notes',
				'type'      => 'textarea',
				'maxLength' => 1500,
			),
			array(
				'id'                => 8,
				'label'             => 'Attachments',
				'type'              => 'fileupload',
				'multipleFiles'     => true,
				'allowedExtensions' => 'jpg,png,pdf',
			),

			array(
				'id'           => 9,
				'label'        => 'Medical Raw (0–100, optional)',
				'type'         => 'number',
				'numberFormat' => 'decimal',
				'inputName'    => 'medical_raw',
			),
			array(
				'id'           => 10,
				'label'        => 'Medical Normalized (0–100)',
				'type'         => 'number',
				'numberFormat' => 'decimal',
				'inputName'    => 'medical_norm',
			),
		),
		'confirmations' => array(
			array(
				'id'      => 'default',
				'type'    => 'message',
				'message' => 'Medical assessment saved.',
			),
		),
	);
	return jrj_upsert_gf_form_by_title( $title, $form );
}

/**
 * Optional: seed demo entries when JRJ_DEV_MODE is true.
 */
function jrj_seed_internal_demo( array $ids ): void {
	if ( ! defined( 'JRJ_DEV_MODE' ) || ! JRJ_DEV_MODE ) {
		return;
	}
	if ( ! class_exists( 'GFAPI' ) ) {
		return;
	}
	$today = current_time( 'Y-m-d' );

	// Skills — 2 demo
	if ( ! empty( $ids['skills'] ) ) {
		$rows = array(
			array(
				'email'    => 'alfa@example.com',
				'assessor' => 'Maria Lopez',
				'scores'   => array( 4, 4, 5, 4, 4, 4 ),
				'flag'     => 'none',
			),
			array(
				'email'    => 'bravo@example.com',
				'assessor' => 'James Carter',
				'scores'   => array( 3, 3, 3, 3, 3, 3 ),
				'flag'     => 'minor',
			),
		);
		foreach ( $rows as $r ) {
			$raw  = array_sum( $r['scores'] );
			$norm = round( ( $raw / 30 ) * 100, 0 );
			$e    = array(
				'form_id' => $ids['skills'],
				'1'       => wp_generate_uuid4(),
				'2'       => $r['email'],
				'3'       => $today,
				'4'       => $r['assessor'],
				'5'       => $r['scores'][0],
				'6'       => $r['scores'][1],
				'7'       => $r['scores'][2],
				'8'       => $r['scores'][3],
				'9'       => $r['scores'][4],
				'10'      => $r['scores'][5],
				'11'      => $raw,
				'12'      => $r['flag'],
				'13'      => 'Demo.',
				'15'      => $norm,
			);
			GFAPI::add_entry( $e );
		}
	}

	// Physical — 2 demo
	if ( ! empty( $ids['physical'] ) ) {
		$rows = array(
			array(
				'email'    => 'charlie@example.com',
				'assessor' => 'Ava Johnson',
				'scores'   => array( 5, 4, 5, 4, 5, 5 ),
			),
			array(
				'email'    => 'delta@example.com',
				'assessor' => 'Olivia Brown',
				'scores'   => array( 3, 3, 4, 3, 3, 4 ),
			),
		);
		foreach ( $rows as $r ) {
			$raw  = array_sum( $r['scores'] );
			$norm = round( ( $raw / 30 ) * 100, 0 );
			$e    = array(
				'form_id' => $ids['physical'],
				'1'       => wp_generate_uuid4(),
				'2'       => $r['email'],
				'3'       => $today,
				'4'       => $r['assessor'],
				'5'       => $r['scores'][0],
				'6'       => $r['scores'][1],
				'7'       => $r['scores'][2],
				'8'       => $r['scores'][3],
				'9'       => $r['scores'][4],
				'10'      => $r['scores'][5],
				'11'      => 'none',
				'12'      => $raw,
				'13'      => $norm,
			);
			GFAPI::add_entry( $e );
		}
	}

	// Medical — 2 demo
	if ( ! empty( $ids['medical'] ) ) {
		$rows = array(
			array(
				'email' => 'alfa@example.com',
				'pract' => 'Dr. Green',
				'clear' => 'cleared',
				'raw'   => null,
				'flags' => array( 'respiratory' ),
			),
			array(
				'email' => 'bravo@example.com',
				'pract' => 'Dr. Brown',
				'clear' => 'cleared_restrictions',
				'raw'   => 85,
				'flags' => array( 'musculoskeletal' ),
			),
		);
		foreach ( $rows as $r ) {
			$norm    = is_numeric( $r['raw'] ) ? max( 0, min( 100, (float) $r['raw'] ) ) : ( $r['clear'] === 'cleared' ? 100 : ( $r['clear'] === 'cleared_restrictions' ? 70 : 0 ) );
			$cb      = array();
			$choices = array( 'respiratory', 'musculoskeletal', 'cardio', 'contagious', 'medication_effects' );
			foreach ( $choices as $i => $val ) {
				$cb[ '6.' . ( $i + 1 ) ] = in_array( $val, $r['flags'], true ) ? $val : '';
			}
			$e = array_merge(
				array(
					'form_id' => $ids['medical'],
					'1'       => wp_generate_uuid4(),
					'2'       => $r['email'],
					'3'       => $today,
					'4'       => $r['pract'],
					'5'       => $r['clear'],
					'7'       => 'Demo.',
					'9'       => is_null( $r['raw'] ) ? '' : (float) $r['raw'],
					'10'      => $norm,
				),
				$cb
			);
			GFAPI::add_entry( $e );
		}
	}
}
