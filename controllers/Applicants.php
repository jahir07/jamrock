<?php
/**
 * Applicants Controller
 *
 * Handles REST API routes and logic related to applicants.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Applicants
 *
 * Provides REST endpoints for listing applicants with pagination and filtering.
 */
class Applicants {

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST routes.
	 *
	 * @return void
	 */
	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/applicants',
			array(
				'methods'             => 'GET',
				'permission_callback' => function (): bool {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'list' ),
			)
		);
	}

	/**
	 * Handle GET /applicants request.
	 *
	 * Supports pagination and optional status filtering.
	 *
	 * @param \WP_REST_Request $req REST request object.
	 * @return \WP_REST_Response
	 */
	public function list( \WP_REST_Request $req ) {
		global $wpdb;
		$table = $wpdb->prefix . 'jamrock_applicants';

		$page   = max( 1, (int) $req->get_param( 'page' ) );
		$per    = (int) $req->get_param( 'per_page' );
		$per    = ( $per > 0 && $per <= 100 ) ? $per : 10;
		$offset = ( $page - 1 ) * $per;

		$status = sanitize_text_field( (string) $req->get_param( 'status' ) );

		$where  = '1=1';
		$params = array();

		if ( ! empty( $status ) ) {
			$where    .= ' AND status = %s';
			$params [] = $status;
		}

		// Total count query.
		$sql_total = $wpdb->prepare(
			"SELECT COUNT(*) FROM {$table} WHERE {$where}",
			$params
		);
		$total     = (int) $wpdb->get_var( $sql_total );

		// Row query with placeholders.
		$params_with_limit = array_merge( $params, array( $per, $offset ) );

		$sql_rows = $wpdb->prepare(
			"SELECT id, jamrock_user_id, first_name, last_name, email, phone, status, score_total, created_at, updated_at
			FROM {$table}
			WHERE {$where}
			ORDER BY id DESC
			LIMIT %d OFFSET %d",
			$params_with_limit
		);

		$rows = $wpdb->get_results( $sql_rows, ARRAY_A ) ?: array();
		$form_ids = $this->get_form_ids(); // ['physical'=>2,'skills'=>3,'medical'=>4]

		// applicant - chk GF form entries.
		foreach ($rows as &$r) {
			$email = (string) ($r['email'] ?? '');

			$r['has_physical'] = $this->has_entry_for_email($form_ids['physical'], $email);
			$r['has_skills'] = $this->has_entry_for_email($form_ids['skills'], $email);
			$r['has_medical'] = $this->has_entry_for_email($form_ids['medical'], $email);
		}
		unset($r);

		return rest_ensure_response(
			array(
				'items' => $rows,
				'total' => $total,
			)
		);
	}

	/**
	 * Get form IDs from options.
	 *
	 * @return array<string, int> Associative array of form IDs.
	 */
	private function get_form_ids(): array
	{
		return array(
			'physical' => (int) get_option('jrj_form_physical_id', 0) ?: 2,
			'skills' => (int) get_option('jrj_form_skills_id', 0) ?: 3,
			'medical' => (int) get_option('jrj_form_medical_id', 0) ?: 4,
		);
	}

	/**
	 * Does a Gravity Forms entry exist for this form & email?
	 * Uses GFAPI when available; otherwise a safe SQL fallback.
	 */
	private function has_entry_for_email(int $form_id, string $email): bool
	{
		if ($form_id <= 0 || !is_email($email)) {
			return false;
		}

		// Prefer GFAPI (field id 2 = applicant_email with inputName='applicant_email')
		if (class_exists('\GFAPI')) {
			$search = array(
				'status' => 'active',
				'field_filters' => array(
					'mode' => 'all',
					array(
						'key' => '2',        // email field id
						'value' => $email,
					),
				),
			);
			$sorting = array('key' => 'id', 'direction' => 'DESC', 'type' => 'numeric');
			$paging = array('offset' => 0, 'page_size' => 1);
			$list = \GFAPI::get_entries($form_id, $search, $sorting, $paging);
			return is_array($list) && !empty($list);
		}

		// Fallback SQL against GF tables if GFAPI unavailable
		global $wpdb;
		$e = $wpdb->prefix . 'gf_entry';
		$em = $wpdb->prefix . 'gf_entry_meta';
		// meta_key '2' holds field id 2 (applicant_email)
		$sql = $wpdb->prepare(
			"SELECT e.id
			   FROM {$e} e
			   JOIN {$em} m ON m.entry_id = e.id
			  WHERE e.form_id = %d
			    AND m.meta_key = %s
			    AND m.meta_value = %s
			  ORDER BY e.id DESC
			  LIMIT 1",
			$form_id,
			'2',
			$email
		);
		$entry_id = (int) $wpdb->get_var($sql);
		return $entry_id > 0;
	}
}
