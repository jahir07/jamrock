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
		add_action( 'after_setup_theme', array( $this, 'hide_admin_bar' ) );
		add_shortcode( 'jrj_candidate_profile', array( $this, 'candidate_profile' ) );
	}

	/**
	 * Hide admin bar for non-administrators.
	 *
	 * @return void
	 */
	public function hide_admin_bar(): void {
		if ( ! current_user_can( 'administrator' ) && ! is_admin() ) {
			show_admin_bar( false );
		}
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

		register_rest_route( 'jamrock/v1', '/profile/update', array(
			'methods'  => 'POST',
			'callback' => array( $this, 'profile_update' ),
			'permission_callback' => function() {
				return is_user_logged_in();
			}
		));
	}	

	/**
	 * Update user profile with Image Upload support
	 * Method: POST
	 */
	public function profile_update( \WP_REST_Request $request ) {
		$user_id = get_current_user_id();
		
		// 1. Update Name (Using get_param to retrieve from FormData)
		$display_name = $request->get_param( 'display_name' );
		if ( ! empty( $display_name ) ) {
			wp_update_user( array(
				'ID'           => $user_id,
				'display_name' => sanitize_text_field( $display_name ),
				'first_name'   => sanitize_text_field( $display_name )
			));
		}

		// 2. Update Password
		$password = $request->get_param( 'password' );
		if ( ! empty( $password ) ) {
			wp_update_user( array(
				'ID'        => $user_id,
				'user_pass' => $password
			));
		}

		// 3. Handle Image Upload
		$files = $request->get_file_params();
		$new_avatar_url = '';

		// Check if 'profile_image' exists in the uploaded files
		if ( ! empty( $files['profile_image'] ) ) {
			require_once( ABSPATH . 'wp-admin/includes/image.php' );
			require_once( ABSPATH . 'wp-admin/includes/file.php' );
			require_once( ABSPATH . 'wp-admin/includes/media.php' );

			// Upload image to WordPress Media Library
			$attachment_id = media_handle_upload( 'profile_image', 0 );

			if ( is_wp_error( $attachment_id ) ) {
				return new WP_Error( 'upload_error', 'Image upload failed: ' . $attachment_id->get_error_message(), array( 'status' => 500 ) );
			}

			// Get the image URL from the attachment ID
			$new_avatar_url = wp_get_attachment_url( $attachment_id );

			// Save the image URL as user meta in the database
			// We are using 'jrj_custom_avatar' as the meta key
			update_user_meta( $user_id, 'jrj_custom_avatar', $new_avatar_url );
		}

		return array( 
			'success' => true, 
			'message' => 'Profile updated successfully',
			'new_avatar_url' => $new_avatar_url // Return new URL to update frontend immediately
		);
	}

	/**
	 * Shortcode of candidate profile page.
	 *
	 * @param mixed $atts
	 * @return string
	 */
	public function candidate_profile( $atts ) {

		wp_enqueue_style( 'jamrock-frontend' );
	
		if ( ! is_user_logged_in() ) {
			
			$args = array(
				'echo'           => false,
				'redirect'       => ( is_ssl() ? 'https://' : 'http://' ) . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'], 
				'label_username' => __( 'Email or Username' ),
				'label_password' => __( 'Password' ),
				'label_remember' => __( 'Remember Me' ),
				'label_log_in'   => __( 'Sign In' ),
				'id_username'    => 'user_login',
				'id_password'    => 'user_pass',
				'id_submit'      => 'wp-submit',
				'remember'       => true,
				'value_remember' => true,
			);
			$login_form = wp_login_form( $args );
	
			$reg_url = get_option( 'jrj_set_registration_page', '' );
			if ( empty( $reg_url ) ) $reg_url = wp_registration_url();
			else $reg_url = home_url( $reg_url );
			$reg_url = esc_url( $reg_url );
			
			// --- NEW MODERN SVG ILLUSTRATION (Abstract Shield/Home/Growth) ---
			$svg_illustration = '
			<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" class="jrj-login-svg">
				<defs>
					<linearGradient id="brandGradModern" x1="0%" y1="0%" x2="100%" y2="100%">
						<stop offset="0%" style="stop-color:#E8A674;stop-opacity:1" />
						<stop offset="100%" style="stop-color:#D68A50;stop-opacity:1" />
					</linearGradient>
					<filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
						<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
						<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
						<feComposite in="SourceGraphic" in2="goo" operator="atop"/>
					</filter>
				</defs>
				
				<circle cx="250" cy="250" r="220" fill="#FFF7ED" opacity="0.8" />
				
				<g class="jrj-svg-content">
					<path fill="url(#brandGradModern)" d="M250,80 L420,170 V330 C420,420 250,480 250,480 C250,480 80,420 80,330 V170 L250,80 Z" opacity="0.15" />
					<path fill="none" stroke="url(#brandGradModern)" stroke-width="4" d="M250,90 L410,175 V325 C410,410 250,465 250,465 C250,465 90,410 90,325 V175 L250,90 Z" />
	
					<path fill="#FFFFFF" d="M250 180 L350 240 L250 300 L150 240 Z" opacity="0.9"/>
					<path fill="url(#brandGradModern)" d="M250 220 L310 260 L250 380 L190 260 Z" />
					
					<circle cx="120" cy="150" r="15" fill="#E8A674" opacity="0.6" />
					<circle cx="380" cy="380" r="20" fill="#D68A50" opacity="0.4" />
					<circle cx="400" cy="120" r="10" fill="#E8A674" opacity="0.5" />
				</g>
			</svg>';
	
			$output  = '<div class="jrj-login-container">';
			
			// LEFT SIDE
			$output .=   '<div class="jrj-login-left">';
			$output .=      $svg_illustration;
			// --- NEW TEXT ---
			$output .=      '<div class="jrj-left-text">';
			$output .=          '<h3>Your Unified Portal</h3>';
			$output .=          '<p>Seamless access to housing, education, and wellness services.</p>';
			$output .=      '</div>';
			// ----------------
			$output .=   '</div>';
	
			// RIGHT SIDE
			$output .=   '<div class="jrj-login-right">';
			$output .=      '<div class="jrj-form-content">';
			$output .=          '<h2 class="jrj-welcome-title">Holla,<br>Welcome Back</h2>';
			$output .=          '<p class="jrj-welcome-subtitle">Hey, welcome back to your special place</p>';
			$output .=          $login_form;
			$output .=          '<div class="jrj-reg-link">';
			$output .=              'Don\'t have an account? <a href="' . $reg_url . '">Sign Up</a>';
			$output .=          '</div>';
			$output .=      '</div>';
			$output .=   '</div>';
	
			$output .= '</div>';
	
			return $output;
		}
	
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

		$custom_avatar = get_user_meta( $user_id, 'jrj_custom_avatar', true );

		// 2. If custom avatar exists use it, otherwise use default Gravatar
		if ( ! empty( $custom_avatar ) ) {
			$avatar_url = $custom_avatar;
		} else {
			$avatar_url = get_avatar_url( $user_id );
		}
		

		// Build profile payload (existing fields + courses)
		$profile = array(
			'id'                 => $user->ID,
			'display_name'       => $user->display_name,
			'email'              => $user->user_email,
			'avatar'             => $avatar_url,
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
