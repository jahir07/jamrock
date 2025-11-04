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
