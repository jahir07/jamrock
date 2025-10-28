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
		$this->register_styles( $this->get_styles() );
		$this->register_scripts( $this->get_scripts() );

		// Localize script.
		wp_localize_script(
			'jamrock-frontend',
			'jamrock_loc',
			array(
				'ajax_url' => admin_url( 'admin-ajax.php' ),
				'nonce'    => wp_create_nonce( 'jamrock' ),
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
				'src'       => JRJ_ASSETS . '/js/index.js',
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

		// Block: Result.
		// $result_asset_file = include JRJ_PATH . '/assets/blocks/result/index.asset.php';
		// wp_enqueue_script(
		// 'jamrock-result',
		// JRJ_ASSETS . '/blocks/result/index.js',
		// $result_asset_file['dependencies'],
		// $result_asset_file['version'],
		// true
		// );
	}
}
