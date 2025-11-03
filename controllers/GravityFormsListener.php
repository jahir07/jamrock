<?php
/**
 * Gravity Forms Listener.
 *
 * Listens to Gravity Forms submissions and upserts applicants into the
 * {prefix}jamrock_applicants table using email as the lookup key.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class GravityFormsListener
 *
 * Binds a form-specific Gravity Forms submission hook and performs
 * an upsert into the applicants table. Keeps a reference to the
 * created/updated applicant via GF entry meta (jamrock_applicant_id).
 *
 * @since 1.0.0
 */
class GravityFormsListener {


	/**
	 * Wire up WordPress hooks.
	 *
	 * Binds to a form-specific GF hook if a Form ID is configured,
	 * otherwise does nothing.
	 *
	 * @return void
	 */
	public function hooks(): void {
		// Ensure GF helper functions exist.
		if ( ! function_exists( 'rgar' ) ) {
			return;
		}

		$form_id = (int) get_option( 'jrj_form_id', 0 );
		if ( $form_id <= 0 ) {
			return;
		}

		// Bind only the configured form id to avoid firing on every form.
		add_action( "gform_after_submission_{$form_id}", array( $this, 'handle_submission' ), 10, 2 );
	}

	/**
	 * Handle a GF entry; upsert into jamrock_applicants using email as the lookup key.
	 *
	 * @param array $entry Gravity Forms entry array.
	 * @param array $form  Gravity Forms form meta.
	 * @return void
	 */
	public function handle_submission( $entry, $form ): void {
		$email      = '';
		$first_name = '';
		$last_name  = '';
		$phone      = '';

		// Extract fields in a "best effort" way by type/label so it works with common GF setups.
		if ( is_array( $form['fields'] ?? null ) ) {
			foreach ( $form['fields'] as $field ) {
				$field_id    = (string) ( $field->id ?? '' );
				$field_type  = (string) ( $field->type ?? '' );
				$field_label = (string) ( $field->label ?? '' );

				// Email by field type.
				if ( ! $email && 'email' === $field_type ) {
					$email = sanitize_email( (string) rgar( $entry, $field_id ) );
				}

				// Name (composite) — GF stores first at .3 and last at .6 by default.
				if ( 'name' === $field_type ) {
					if ( ! $first_name ) {
						$first_name = sanitize_text_field( (string) rgar( $entry, $field_id . '.3' ) );
					}
					if ( ! $last_name ) {
						$last_name = sanitize_text_field( (string) rgar( $entry, $field_id . '.6' ) );
					}
				} else {
					// Fallback plain text fields by label.
					if ( ! $first_name && false !== stripos( $field_label, 'first' ) ) {
						$first_name = sanitize_text_field( (string) rgar( $entry, $field_id ) );
					}
					if ( ! $last_name && false !== stripos( $field_label, 'last' ) ) {
						$last_name = sanitize_text_field( (string) rgar( $entry, $field_id ) );
					}
				}

				// Phone by type or label.
				if ( ! $phone && ( 'phone' === $field_type || false !== stripos( $field_label, 'phone' ) ) ) {
					$phone = sanitize_text_field( (string) rgar( $entry, $field_id ) );
				}
			}
		}

		// Fall back: if your form uses fixed IDs, uncomment and adjust:
		// $first_name = $first_name ?: sanitize_text_field( (string) rgar( $entry, 1 ) );
		// $email      = $email ?: sanitize_email( (string) rgar( $entry, 3 ) );

		if ( '' === $email || ! is_email( $email ) ) {
			if ( function_exists( 'jamrock_log' ) ) {
				jamrock_log(
					'gf_missing_email',
					array(
						'form_id'  => (int) rgar( $entry, 'form_id' ),
						'entry_id' => (int) rgar( $entry, 'id' ),
					)
				);
			}
			return;
		}

		global $wpdb;
		$table = $wpdb->prefix . 'jamrock_applicants';
		$now   = current_time( 'mysql' );

		// Lookup existing by email.
		$applicant_id = (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT id FROM {$table} WHERE email = %s LIMIT 1", $email )
		);

		if ( $applicant_id ) {
			// Update minimal profile fields and timestamp.
			$data = array(
				'first_name' => $first_name,
				'last_name'  => $last_name,
				'phone'      => $phone,
				'updated_at' => $now,
			);
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->update( $table, $data, array( 'id' => $applicant_id ) );
		} else {
			// Insert new with UUID + defaults.
			$data = array(
				'jamrock_user_id' => function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : self::uuid4_fallback(),
				'first_name'      => $first_name,
				'last_name'       => $last_name,
				'email'           => $email,
				'phone'           => $phone,
				'status'          => 'applied',
				'score_total'     => 0,
				'created_at'      => $now,
				'updated_at'      => $now,
			);
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->insert( $table, $data );
			$applicant_id = (int) $wpdb->insert_id;
		}

		// Store a backlink to the applicant on the GF entry for later use.
		if ( function_exists( 'gform_update_meta' ) ) {
			gform_update_meta( (int) rgar( $entry, 'id' ), 'jamrock_applicant_id', (string) $applicant_id );
		}

		/**
		 * Fire an internal hook so other modules (announcements, CRM, etc.) can react.
		 *
		 * @param string $email Applicant email.
		 * @param int    $applicant_id Internal applicant ID.
		 */
		do_action( 'jamrock_applicant_upserted', $email, $applicant_id );

		if ( function_exists( 'jamrock_log' ) ) {
			jamrock_log(
				'gf_applicant_upserted',
				array(
					'applicant_id' => $applicant_id,
					'email'        => $email,
				)
			);
		}
	}

	/**
	 * Tiny UUIDv4 fallback if wp_generate_uuid4() is unavailable.
	 *
	 * @return string UUID v4 string.
	 */
	private static function uuid4_fallback(): string {
		$data    = random_bytes( 16 );
		$data[6] = chr( ( ord( $data[6] ) & 0x0f ) | 0x40 );
		$data[8] = chr( ( ord( $data[8] ) & 0x3f ) | 0x80 );
		return vsprintf( '%s%s-%s-%s-%s-%s%s%s', str_split( bin2hex( $data ), 4 ) );
	}
}
