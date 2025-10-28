<?php
/**
 * Dashboard Controller
 *
 * Returns per-user training & certification summary for the employee dashboard.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class Dashboard {


	/**
	 * Boot hooks.
	 *
	 * @return void
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function register_routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/me/dashboard',
			array(
				'methods'             => 'GET',
				'permission_callback' => function (): bool {
					return is_user_logged_in();
				},
				'callback'            => array( $this, 'handle_me_dashboard' ),
			)
		);
	}

	/**
	 * Handle GET /me/dashboard.
	 * Returns certification cards and progress aggregates for the current user.
	 *
	 * @return \WP_REST_Response
	 */
	public function handle_me_dashboard() {
		$user_id = get_current_user_id();

		$data = $this->build_user_dashboard_data( $user_id );

		// Ensure clean JSON (avoid pollution by stray notices).
		if ( ob_get_length() ) {
			ob_clean();
		}

		return rest_ensure_response( $data );
	}

	/**
	 * Build dashboard data for a given user.
	 *
	 * @param int $user_id User ID.
	 * @return array
	 */
	protected function build_user_dashboard_data( int $user_id ): array {
		// 1) Determine assigned courses. For MVP we use LearnDash enrolled courses.
		// If you want "required by department", fetch LD Groups for this user and
		// aggregate courses from those groups.
		if ( ! function_exists( 'learndash_user_get_enrolled_courses' ) ) {
			return array(
				'certifications' => array(),
				'progress'       => array(
					'assigned'                => 0,
					'completed'               => 0,
					'required_cert_total'     => 0,
					'required_cert_completed' => 0,
					'total_learning_hours'    => 0,
				),
			);
		}

		$course_ids = (array) learndash_user_get_enrolled_courses( $user_id );
		$certs      = array();

		$assigned_total          = 0;
		$completed_total         = 0;
		$required_cert_total     = 0;
		$required_cert_completed = 0;
		$total_learning_hours    = 0.0;

		foreach ( $course_ids as $course_id ) {
			++$assigned_total;

			$status = function_exists( 'learndash_course_status' )
				? (string) learndash_course_status( $course_id, $user_id )
				: 'Not Started';

			// Course meta flags you can set when creating content (admin side).
			$is_required_cert = ( 'yes' === (string) get_post_meta( $course_id, '_jamrock_is_cert_required', true ) );

			// Estimated minutes for MVP learning time (optional).
			$estimated_minutes = (int) get_post_meta( $course_id, '_jamrock_estimated_minutes', true );
			if ( $estimated_minutes > 0 ) {
				$total_learning_hours += ( $estimated_minutes / 60 );
			}

			// Certificate expiry user meta (set when certificate issued).
			$expiry_key      = '_jamrock_cert_expiry_' . (int) $course_id;
			$expiry_date     = (string) get_user_meta( $user_id, $expiry_key, true );
			$certificate_url = '';
			if ( function_exists( 'learndash_get_course_certificate_link' ) ) {
				$certificate_url = (string) learndash_get_course_certificate_link( $course_id, $user_id );
			}

			$state = $this->compute_certificate_state( $status, $expiry_date );

			if ( 'Completed' === $status ) {
				++$completed_total;
			}

			if ( $is_required_cert ) {
				++$required_cert_total;
				if ( in_array( $state, array( 'active', 'expiring_soon' ), true ) ) {
					++$required_cert_completed;
				}
			}

			$certs[] = array(
				'course_id'       => (int) $course_id,
				'title'           => get_the_title( $course_id ),
				'status'          => $state, // active | expiring_soon | expired | not_completed
				'expires_on'      => $expiry_date,
				'certificate_url' => $certificate_url,
			);
		}

		// Round hours to 1 decimal place for a friendly display.
		$total_learning_hours = round( $total_learning_hours, 1 );

		return array(
			'certifications' => $certs,
			'progress'       => array(
				'assigned'                => (int) $assigned_total,
				'completed'               => (int) $completed_total,
				'required_cert_total'     => (int) $required_cert_total,
				'required_cert_completed' => (int) $required_cert_completed,
				'total_learning_hours'    => $total_learning_hours,
			),
		);
	}

	/**
	 * Compute human-friendly certificate state.
	 *
	 * @param string $ld_status   LearnDash status ("Completed", "In Progress", "Not Started").
	 * @param string $expiry_date ISO-8601 (Y-m-d or Y-m-d H:i:s) or empty if none.
	 * @return string             active | expiring_soon | expired | not_completed
	 */
	protected function compute_certificate_state( string $ld_status, string $expiry_date ): string {
		if ( 'Completed' !== $ld_status ) {
			return 'not_completed';
		}

		if ( empty( $expiry_date ) ) {
			return 'active'; // No expiry set = treat as active.
		}

		$ts   = strtotime( $expiry_date );
		$diff = $ts - time();

		if ( $diff <= 0 ) {
			return 'expired';
		}

		$days_left = (int) floor( $diff / DAY_IN_SECONDS );
		if ( $days_left <= 30 ) {
			return 'expiring_soon';
		}

		return 'active';
	}
}
