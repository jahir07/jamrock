<?php
/**
 * Handles plugin assets.
 *
 * This class is responsible for managing the assets (e.g., stylesheets, JavaScript files)
 * used by the Jamrock plugin.
 *
 * @package Jamrock
 * @since   1.0
 */

namespace Jamrock\Core;

/**
 * Scripts and Styles Class
 */
class Assets {

	/**
	 * Initilize the class.
	 *
	 * @return void
	 */
	public function __construct() {
		add_action( 'wp_enqueue_scripts', array( $this, 'frontend_register' ), 5 );
		add_action( 'enqueue_block_assets', array( $this, 'enqueue_block_script' ) );
	}

	/**
	 * Register scripts and styles.
	 *
	 * @return void
	 */
	public function frontend_register() {
		// register styles/scripts first (your existing helpers)
		$this->register_styles( $this->get_styles() );
		$this->register_scripts( $this->get_scripts() );

		// Only compute once
		$quiz_id      = ( is_singular( 'sfwd-quiz' ) ? get_the_ID() : 0 );
		$current_user = wp_get_current_user();

		// Ensure the main handle exists and is enqueued. If your register_scripts registers 'jamrock-frontend'
		// then enqueue it here (frontend asset). If you conditionally load, change logic appropriately.
		if ( wp_script_is( 'jamrock-frontend', 'registered' ) && ! wp_script_is( 'jamrock-frontend', 'enqueued' ) ) {
			wp_enqueue_script( 'jamrock-frontend' );
		}

		// Nonces
		$rest_nonce = wp_create_nonce( 'wp_rest' );
		$ajax_nonce = wp_create_nonce( 'jamrock' );

		// Prepare JRJ_AP (AutoProctor / LearnDash integration)
		$jrj_ap = array(
			'rest'     => esc_url_raw( rest_url( 'jamrock/v1/' ) ),
			'nonce'    => $rest_nonce,
			'quizId'   => (int) $quiz_id,
			'root'     => esc_url_raw( rest_url( 'jamrock/v1/' ) ),
			'userName' => $current_user->display_name ?: '',
			'email'    => $current_user->user_email ?: '',
		);

		// jamrock_loc (legacy).
		$jamrock_loc = array(
			'ajax_url' => admin_url( 'admin-ajax.php' ),
			'nonce'    => $ajax_nonce,
		);

		// JRJ_INSIGHTS config.
		$cfg = array(
			'root'              => rest_url( 'jamrock/v1' ),
			'endpoint'          => rest_url( 'jamrock/v1/insights/events' ),
			'nonce'             => $rest_nonce,
			'heartbeatInterval' => 60,
			'debug'             => ( defined( 'WP_DEBUG' ) && WP_DEBUG ) ? true : false,
		);

		// JRJ_USER info.
		$jrj_user = array(
			'id'    => $current_user->ID ? intval( $current_user->ID ) : null,
			'role'  => ! empty( $current_user->roles ) ? $current_user->roles[0] : 'guest',
			'name'  => $current_user->display_name ?: '',
			'email' => $current_user->user_email ?: '',
		);

		// Localize once (grouped). Use the same script handle you enqueued: 'jamrock-frontend'.
		wp_localize_script( 'jamrock-frontend', 'jamrock_loc', $jamrock_loc );
		wp_localize_script( 'jamrock-frontend', 'JRJ_AP', $jrj_ap );
		wp_localize_script( 'jamrock-frontend', 'JRJ_INSIGHTS', $cfg );
		wp_localize_script( 'jamrock-frontend', 'JRJ_USER', $jrj_user );
		wp_localize_script(
			'jamrock-frontend',
			'JRJ_ADMIN',
			array(
				'nonce' => $rest_nonce,
				'root'  => rest_url( 'jamrock/v1' ) . '/',
			)
		);
	}

	/**
	 * Register multiple styles.
	 *
	 * Loops through a list of styles and registers them with wp_register_style.
	 *
	 * @param array $styles Associative array of styles where the key is the handle
	 *                      and the value is an array containing:
	 *                      - 'src'  (string) URL to the stylesheet.
	 *                      - 'deps' (array) Optional. Array of style handles this stylesheet depends on.
	 *
	 * @return void
	 */
	public function register_styles( $styles ) {
		foreach ( $styles as $handle => $style ) {
			$deps = isset( $style['deps'] ) ? $style['deps'] : array();
			wp_register_style( $handle, $style['src'], $deps, JRJ_VERSION );
		}
	}

	/**
	 * Register JavaScript files with WordPress.
	 *
	 * Accepts an associative array of scripts and registers each one
	 * using wp_register_script().
	 *
	 * @param array $scripts List of scripts, keyed by handle. Each item should contain:
	 *                       - 'src'       (string)  URL to the script file.
	 *                       - 'deps'      (array)   Optional. Script dependencies. Default [].
	 *                       - 'version'   (string)  Optional. Script version. Default JRJ_VERSION.
	 *                       - 'in_footer' (bool)    Optional. Whether to load in footer. Default false.
	 *
	 * @return void
	 */
	private function register_scripts( $scripts ) {
		foreach ( $scripts as $handle => $script ) {
			$deps      = isset( $script['deps'] ) ? $script['deps'] : array();
			$in_footer = isset( $script['in_footer'] ) ? (bool) $script['in_footer'] : false;
			$version   = isset( $script['version'] ) ? $script['version'] : JRJ_VERSION;

			wp_register_script( $handle, $script['src'], $deps, $version, $in_footer );
		}
	}

	/**
	 * Get frontend registered styles.
	 *
	 * @return array
	 */
	public function get_styles() {

		$styles = array(
			'jamrock-frontend' => array(
				'src' => JRJ_ASSETS . '/css/style.css',
			),
		);

		return $styles;
	}

	/**
	 * Get all frontend registered scripts.
	 *
	 * @return array
	 */
	public function get_scripts() {

		$scripts = array(
			'jamrock-frontend' => array(
				'src'       => JRJ_ASSETS . '/js/custom.js',
				'deps'      => array( 'jquery' ), // dependency.
				'version'   => JRJ_VERSION,
				'in_footer' => true,
			),
		);

		return $scripts;
	}

	/**
	 * Enqueue styles and scripts for block editor and frontend.
	 *
	 * @return void
	 */
	public function enqueue_block_script() {
		// Styles with explicit version numbers.
		wp_enqueue_style(
			'jamrock-blocks',
			JRJ_ASSETS . '/blocks/index.css',
			array(),
			JRJ_VERSION
		);

		// Plain frontend JS (registered elsewhere, enqueued here).
		wp_enqueue_script(
			'jamrock-frontend',
			'',
			array(),
			JRJ_VERSION,
			true      // load in footer.
		);

		// Block: Form.
		$asset_file = include JRJ_PATH . '/assets/blocks/index.asset.php';
		wp_enqueue_script(
			'jamrock-blocks',
			JRJ_ASSETS . '/blocks/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);
	}
}
