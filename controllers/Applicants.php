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

use LearnDash\Core\Utilities\Cast;

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
		add_shortcode( 'jrj_candidate_profile', array( $this, 'candidate_profile' ) );
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

		register_rest_route(
			'jamrock/v1',
			'/profile/(?P<id>[\w-]+)',
			array(
				'methods'             => 'GET',
				'permission_callback' => function () {
					return is_user_logged_in();
				},
				'callback'            => array( $this, 'profile_info' ),
			)
		);
	}

	/**
	 * Shortcode of candidate profile page.
	 *
	 * @param mixed $atts
	 * @return string
	 */
	public function candidate_profile( $atts ) {
		if ( ! is_user_logged_in() ) {
			return '<p>Please log in to see your profile.</p>';
		}
		wp_enqueue_style( 'jamrock-frontend' );
		return '<div id="jrj-candidate-profile" data-user-id="' . esc_attr( get_current_user_id() ) . '"></div>';
	}

	/**
	 * Get profile_info by id.
	 *
	 * @param \WP_REST_Request $req request.
	 * @return \WP_Error|\WP_REST_Response
	 */
	public function profile_info( \WP_REST_Request $req ) {

		$id = $req->get_param( 'id' );

		// allow 'me'
		if ( $id === 'me' ) {
			$user = wp_get_current_user();
		} else {
			$user = get_userdata( intval( $id ) );
		}

		if ( ! $user || ! $user->ID ) {
			return rest_ensure_response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		$user_id = (int) $user->ID;

		$courses = array();
		if ( function_exists( 'learndash_user_get_enrolled_courses' ) ) {
			$enrolled = (array) learndash_user_get_enrolled_courses( $user_id ); // array of course IDs
		} else {
			// fallback: no helper — try user meta common keys
			$maybe    = get_user_meta( $user_id, 'ld_enrolled_courses', true );
			$enrolled = is_array( $maybe ) ? $maybe : array();
		}

		foreach ( $enrolled as $course_id ) {
			$course_id = (int) $course_id;
			$post      = get_post( $course_id );
			if ( ! $post || $post->post_type !== 'sfwd-courses' ) {
				continue;
			}

			$title     = get_the_title( $course_id );
			$permalink = get_permalink( $course_id );

			// progress percent: try common LearnDash helpers
			$progress_percent = null;
			if ( function_exists( 'learndash_course_progress' ) ) {
				$p = learndash_course_progress(
					array(
						'user_id'   => $user_id,
						'course_id' => $course_id,
						'array'     => true,
					)
				);
				if ( is_array( $p ) ) {
					if ( isset( $p['percentage'] ) ) {
						$progress_percent = (float) $p['percentage'];
					}
					if ( isset( $p['completed'], $p['total'] ) && (int) $p['total'] > 0 ) {
						$progress_percent = round( ( (int) $p['completed'] / (int) $p['total'] ) * 100, 2 );
					}
				}
			}

			// ensure numeric and clamp 0..100
			$progress_percent = is_null( $progress_percent ) ? 0.0 : max( 0.0, min( 100.0, (float) $progress_percent ) );

			// completed detection
			$completed = false;
			if ( function_exists( 'learndash_course_completed' ) ) {
				$completed = (bool) learndash_course_completed( $user_id, $course_id );
			} elseif ( $progress_percent >= 99.9 ) {
				$completed = true;
			}

			// certificate url (best-effort)
			$certificate_url = null;
			if ( function_exists( 'learndash_get_certificate_count' ) ) {
				// some sites return certificate post or URL
				$cert = learndash_get_certificate_count( $user_id );
				if ( is_string( $cert ) && filter_var( $cert, FILTER_VALIDATE_URL ) ) {
					$certificate_url = $cert;
				} elseif ( is_array( $cert ) && ! empty( $cert['certificate_url'] ) ) {
					$certificate_url = $cert['certificate_url'];
				}
			} else {
				// try meta or attachment lookups (site-specific)
				$cmeta = get_user_meta( $user_id, "certificate_{$course_id}", true );
				if ( is_string( $cmeta ) && filter_var( $cmeta, FILTER_VALIDATE_URL ) ) {
					$certificate_url = $cmeta;
				}
			}

			$courses[] = array(
				'id'               => $course_id,
				'title'            => $title,
				'permalink'        => $permalink,
				'progress_percent' => $progress_percent,
				'status'           => $completed ? 'completed' : 'in_progress',
				'certificate_url'  => $certificate_url,
			);
		}

		// Build profile payload (existing fields + courses)
		$profile = array(
			'id'                 => $user->ID,
			'display_name'       => $user->display_name,
			'email'              => $user->user_email,
			'avatar'             => get_avatar_url( $user->ID ),
			'courses_count'      => count( $courses ),
			'completed_count'    => count(
				array_filter(
					$courses,
					function ( $c ) {
						return ( $c['status'] === 'completed' ); }
				)
			),
			'certificates_count' => count(
				array_filter(
					$courses,
					function ( $c ) {
						return ! empty( $c['certificate_url'] ); }
				)
			),
			'points'             => (int) get_user_meta( $user->ID, 'jrj_points', true ), // adjust if you have different points system
			'courses'            => $courses,
		);

		return rest_ensure_response(
			array(
				'ok'      => true,
				'profile' => $profile,
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

		$rows     = $wpdb->get_results( $sql_rows, ARRAY_A ) ?: array();
		$form_ids = $this->get_form_ids(); // ['physical'=>2,'skills'=>3,'medical'=>4]

		// applicant - chk GF form entries.
		foreach ( $rows as &$r ) {
			$email = (string) ( $r['email'] ?? '' );

			$r['has_physical'] = $this->has_entry_for_email( $form_ids['physical'], $email );
			$r['has_skills']   = $this->has_entry_for_email( $form_ids['skills'], $email );
			$r['has_medical']  = $this->has_entry_for_email( $form_ids['medical'], $email );
		}
		unset( $r );

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
	private function get_form_ids(): array {
		return array(
			'physical' => (int) get_option( 'jrj_form_physical_id', 0 ) ?: 2,
			'skills'   => (int) get_option( 'jrj_form_skills_id', 0 ) ?: 3,
			'medical'  => (int) get_option( 'jrj_form_medical_id', 0 ) ?: 4,
		);
	}

	/**
	 * Does a Gravity Forms entry exist for this form & email?
	 * Uses GFAPI when available; otherwise a safe SQL fallback.
	 */
	private function has_entry_for_email( int $form_id, string $email ): bool {
		if ( $form_id <= 0 || ! is_email( $email ) ) {
			return false;
		}

		// Prefer GFAPI (field id 2 = applicant_email with inputName='applicant_email')
		if ( class_exists( '\GFAPI' ) ) {
			$search  = array(
				'status'        => 'active',
				'field_filters' => array(
					'mode' => 'all',
					array(
						'key'   => '2',        // email field id
						'value' => $email,
					),
				),
			);
			$sorting = array(
				'key'       => 'id',
				'direction' => 'DESC',
				'type'      => 'numeric',
			);
			$paging  = array(
				'offset'    => 0,
				'page_size' => 1,
			);
			$list    = \GFAPI::get_entries( $form_id, $search, $sorting, $paging );
			return is_array( $list ) && ! empty( $list );
		}

		// Fallback SQL against GF tables if GFAPI unavailable
		global $wpdb;
		$e  = $wpdb->prefix . 'gf_entry';
		$em = $wpdb->prefix . 'gf_entry_meta';
		// meta_key '2' holds field id 2 (applicant_email)
		$sql      = $wpdb->prepare(
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
		$entry_id = (int) $wpdb->get_var( $sql );
		return $entry_id > 0;
	}
}
