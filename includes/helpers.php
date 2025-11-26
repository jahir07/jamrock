<?php
/**
 * Jamrock helper functions.
 *
 * @package Jamrock
 * @since   1.0.0
 */

add_action(
	'template_redirect',
	function () {
		$protected = array( '/internal-physical/', '/internal-skills/', '/internal-medical/' );
		$req       = trailingslashit( parse_url( add_query_arg( array() ), PHP_URL_PATH ) );

		if ( in_array( $req, $protected, true ) ) {
			if ( ! is_user_logged_in() || ! current_user_can( 'edit_posts' ) ) {
				wp_safe_redirect( home_url( '/wp-login.php' ) );
				exit;
			}
		}
	}
);

// Create required pages if they do not exist.
function jrj_ensure_page( $title, $slug, $shortcode ) {
	$p = get_page_by_path( $slug );
	if ( $p ) {
		return $p->ID;
	}
	return wp_insert_post(
		array(
			'post_title'   => $title,
			'post_name'    => $slug,
			'post_status'  => 'publish',
			'post_type'    => 'page',
			'post_content' => $shortcode,
		)
	);
}

// Get applicant ID from user ID.
function jrj_applicant_id_from_user( $user_id = 0 ) {
	global $wpdb;

	// if user_id, then current logged in user.
	$user_id = $user_id ?: get_current_user_id();
	if ( ! $user_id ) {
		return 0;
	}

	// find user email.
	$user = get_userdata( $user_id );
	if ( ! $user || empty( $user->user_email ) ) {
		return 0;
	}

	// get id from applicant table.
	$applicant_id = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT id FROM {$wpdb->prefix}jamrock_applicants WHERE email = %s LIMIT 1",
			$user->user_email
		)
	);

	return $applicant_id ?: 0;
}


// Cron job to sync assessments daily.
add_action(
	'jrj_psymetrics_cron',
	function () {
		// Last 2 days pull
		$ctl = new \Jamrock\Controllers\Psymetrics();
		$req = new \WP_REST_Request( 'POST', '/jamrock/v1/assessments/sync' );
		$req->set_param( 'start', gmdate( 'Y-m-d', strtotime( '-2 days' ) ) );
		$req->set_param( 'end', gmdate( 'Y-m-d' ) );
		$ctl->sync( $req );
	}
);

// Schedule daily if not already
if ( ! wp_next_scheduled( 'jrj_psymetrics_cron' ) ) {
	wp_schedule_event( time() + 300, 'daily', 'jrj_psymetrics_cron' );
}
