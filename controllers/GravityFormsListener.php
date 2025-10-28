<?php
/**
 * Gravity Forms Listener.
 *
 * Listens to Gravity Forms submissions and upserts applicants into the
 * wp_jamrock_applicants table.
 *
 * @package Jamrock
 * @since   1.0.0
 */
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Listens to Gravity Forms submissions and upserts into wp_jamrock_applicants.
 */
class GravityFormsListener {


	/**
	 * Wire up WordPress hooks.
	 */
	public function hooks(): void {
		add_action( 'gform_after_submission', array( $this, 'handle_submission' ), 10, 2 );
	}

	/**
	 * Handle a GF entry; upsert into jamrock_applicants using email as the lookup key.
	 *
	 * @param array $entry Gravity Forms entry.
	 * @param array $form  Gravity Forms form meta.
	 */
	public function handle_submission( $entry, $form ): void {
		$target_form_id = (int) get_option( 'jrj_form_id', 0 );
		if ( ! $target_form_id || (int) rgar( $entry, 'form_id' ) !== $target_form_id ) {
			return;
		}

		// ---- Extract fields (best-effort: by type/label). Adjust ids later if you add explicit mapping.
		$email      = '';
		$first_name = '';
		$last_name  = '';
		$phone      = '';

		foreach ( $form['fields'] as $field ) {
			$id = (string) $field->id;

			// Email
			if ( ! $email && 'email' === $field->type ) {
				$email = sanitize_email( rgar( $entry, $id ) );
			}

			// Name field (GF composite)
			if ( 'name' === $field->type ) {
				$first_name = $first_name ?: sanitize_text_field( rgar( $entry, $id . '.3' ) ); // first
				$last_name  = $last_name ?: sanitize_text_field( rgar( $entry, $id . '.6' ) ); // last
			} else {
				// Fallback: text fields with labels containing "first"/"last"
				if ( ! $first_name && false !== stripos( $field->label, 'first' ) ) {
					$first_name = sanitize_text_field( rgar( $entry, $id ) );
				}
				if ( ! $last_name && false !== stripos( $field->label, 'last' ) ) {
					$last_name = sanitize_text_field( rgar( $entry, $id ) );
				}
			}

			// Phone (by type/label)
			if ( ! $phone && ( 'phone' === $field->type || false !== stripos( $field->label, 'phone' ) ) ) {
				$phone = sanitize_text_field( rgar( $entry, $id ) );
			}
		}

		if ( ! $email ) {
			if ( function_exists( 'jamrock_log' ) ) {
				jamrock_log(
					'gf_missing_email',
					array(
						'form_id'  => $target_form_id,
						'entry_id' => rgar( $entry, 'id' ),
					)
				);
			}
			return;
		}

		global $wpdb;
		$table = $wpdb->prefix . 'jamrock_applicants';

		// Look up by email (your schema has KEY email; unique-by-email is optional but recommended).
		$applicant_id = (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT id FROM {$table} WHERE email = %s LIMIT 1", $email )
		);

		$now = current_time( 'mysql' );

		if ( $applicant_id ) {
			// Update existing.
			$data = array(
				'first_name' => $first_name ?: '',
				'last_name'  => $last_name ?: '',
				'phone'      => $phone ?: '',
				'updated_at' => $now,
			);
			$wpdb->update( $table, $data, array( 'id' => $applicant_id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		} else {
			// Insert new with a UUID for jamrock_user_id and default status/score.
			$data = array(
				'jamrock_user_id' => function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : self::uuid4_fallback(),
				'first_name'      => $first_name ?: '',
				'last_name'       => $last_name ?: '',
				'email'           => $email,
				'phone'           => $phone ?: '',
				'status'          => 'applied',
				'score_total'     => 0,
				'created_at'      => $now,
				'updated_at'      => $now,
			);
			$wpdb->insert( $table, $data ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$applicant_id = (int) $wpdb->insert_id;
		}

		// Fire your internal hook for other automations (optional).
		do_action( 'jamrock_applicant_upserted', $email, $applicant_id );
	}

	/**
	 * Tiny UUIDv4 fallback if wp_generate_uuid4() is unavailable.
	 */
	private static function uuid4_fallback(): string {
		$data    = random_bytes( 16 );
		$data[6] = chr( ( ord( $data[6] ) & 0x0f ) | 0x40 );
		$data[8] = chr( ( ord( $data[8] ) & 0x3f ) | 0x80 );
		return vsprintf( '%s%s-%s-%s-%s-%s%s%s', str_split( bin2hex( $data ), 4 ) );
	}
}
