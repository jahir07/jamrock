<?php
/**
 * Dashboard Shortcode
 *
 * Renders the front-end container and enqueues the dashboard Vue app.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Shortcodes;

defined( 'ABSPATH' ) || exit;

class Dashboard {


	/**
	 * Hook shortcode and assets.
	 *
	 * @return void
	 */
	public function __construct() {
		add_shortcode( 'jamrock_dashboard', array( $this, 'render' ) );
	}

	/**
	 * Render the [jamrock_dashboard] shortcode.
	 *
	 * @return string
	 */
	public function render(): string {
		if ( ! is_user_logged_in() ) {
			return '<p>You need to be signed in to view your training dashboard.</p>';
		}

		// Localize REST root + nonce for the app.
		// wp_enqueue_script('jamrock-dashboard');
		// wp_localize_script(
		// 'jamrock-frontend',
		// 'JRJ_DASH',
		// array(
		// 'root' => esc_url_raw(rest_url('jamrock/v1/')),
		// 'nonce' => wp_create_nonce('wp_rest'),
		// )
		// );

		// wp_register_script('jrj-dash-boot', false, [], null, true);
		// wp_enqueue_script('jrj-dash-boot');
		wp_add_inline_script(
			'jamrock-frontend',
			'window.JRJ_DASH = ' . wp_json_encode(
				array(
					'root'  => esc_url_raw( rest_url( 'jamrock/v1/' ) ),
					'nonce' => wp_create_nonce( 'wp_rest' ),
				)
			),
			'before'
		);

		return '<div id="jamrock-dashboard-app"></div>';
	}
}
