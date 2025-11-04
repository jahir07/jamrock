<?php
/**
 * Settings Controller.
 *
 * Provides REST endpoints for reading and saving Jamrock settings
 * used by the Vue admin panel.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class Settings
 *
 * Registers REST routes for plugin settings.
 */
class Settings {


	/**
	 * Register WordPress hooks.
	 *
	 * @return void
	 */
	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function routes(): void {

		register_rest_route(
			'jamrock/v1',
			'/settings',
			array(
				'methods'             => 'GET',
				'permission_callback' => function (): bool {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'get_settings' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/settings',
			array(
				'methods'             => 'POST',
				'permission_callback' => function (): bool {
					return current_user_can( 'manage_options' );
				},
				'callback'            => array( $this, 'save_settings' ),
			)
		);
	}

	/**
	 * Handle GET /settings.
	 *
	 * Cleans any prior output (warnings/notices) so the JSON response remains valid.
	 *
	 * @param \WP_REST_Request $request Request instance (unused, reserved for future filters).
	 * @return void Outputs JSON and exits via wp_send_json().
	 */
	public function get_settings( \WP_REST_Request $request ): void {
		// Touch request so it's not flagged as unused (and keeps room for future query params).
		$request->get_method();

		// Clean any unexpected output before sending JSON.
		if ( ob_get_length() ) {
			ob_clean();
		}

		$data = array(
			'form_id'             => (int) get_option( 'jrj_form_id', 0 ),
			'api_key'             => (string) get_option( 'jrj_api_key', '' ),
			'callback_ok'         => (string) get_option( 'jrj_callback_ok', '' ),
			'set_login_page'      => (string) get_option( 'jrj_set_login_page', '' ),
			'set_assessment_page' => (string) get_option( 'jrj_set_assessment_page', '' ),
		);

		// Send as clean JSON with proper headers and exit.
		wp_send_json( $data );
	}

	/**
	 * Handle POST /settings.
	 *
	 * Saves settings coming from the Vue admin panel.
	 *
	 * @param \WP_REST_Request $request Request instance.
	 * @return \WP_REST_Response
	 */
	public function save_settings( \WP_REST_Request $request ) {
		$params = (array) $request->get_json_params();

		update_option( 'jrj_form_id', absint( $params['form_id'] ?? 0 ) );
		update_option( 'jrj_api_key', sanitize_text_field( $params['api_key'] ?? '' ) );
		update_option( 'jrj_callback_ok', esc_url_raw( $params['callback_ok'] ?? '' ) );
		update_option( 'jrj_set_login_page', sanitize_text_field( $params['set_login_page'] ?? '' ) );
		update_option( 'jrj_set_assessment_page', sanitize_text_field( $params['set_assessment_page'] ?? '' ) );

		return rest_ensure_response(
			array(
				'success' => true,
			)
		);
	}
}
