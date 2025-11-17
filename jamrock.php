<?php
/**
 * Plugin Name: Jamrock
 * Plugin URI: https://www.xstheme.com
 * Description: Recommanded plugin for Jamrock.
 * Version: 1.0.0
 * Author: Jahirul Islam Mamun
 * Author URI: http://www.xstheme.com
 * Text Domain: jamrock
 * Domain Path:  /languages
 * License:      GPLv2+
 * License URI:  LICENSE
 *
 * @package Jamrock
 */

// don't call the file directly.
defined( 'ABSPATH' ) || die( 'No direct access!' );

define( 'JRJ_VERSION', '1.0.0' );
define( 'JRJ_FILE', __FILE__ );
define( 'JRJ_PATH', dirname( JRJ_FILE ) );
define( 'JRJ_URL', plugins_url( '', JRJ_FILE ) );
define( 'JRJ_ASSETS', JRJ_URL . '/assets' );

// Require files.
require_once JRJ_PATH . '/includes/helpers.php';
require_once JRJ_PATH . '/includes/gf-internal-forms-upsert.php';
require_once JRJ_PATH . '/includes/cpt.php';
require_once JRJ_PATH . '/includes/announcements.php';

// Autoload classes.
require_once __DIR__ . '/vendor/autoload.php';

use Jamrock\Core\Plugin;
use Jamrock\Core\Installer;

/**
 * Run installer on activation.
 */
register_activation_hook(
	__FILE__,
	function () {
		ob_start(); // capture any accidental output.
		$installer = new Installer();
		$installer->do_install();

		// Gravity Forms internal forms setup.
		require_once __DIR__ . '/includes/gf-internal-forms.php';
		if ( class_exists( 'GFAPI' ) ) {
			jrj_create_registration_form();
			$physical_id = jrj_create_physical_form();
			$skills_id   = jrj_create_skills_form();
			$medical_id  = jrj_create_medical_form();

			// Save for later use.
			update_option( 'jrj_form_physical_id', $physical_id );
			update_option( 'jrj_form_skills_id', $skills_id );
			update_option( 'jrj_form_medical_id', $medical_id );

			// Create internal assessment pages.
			jrj_ensure_page( 'Internal – Physical', 'internal-physical', '[gravityform id="' . $physical_id . '" title="false" description="false" ajax="true"]' );
			jrj_ensure_page( 'Internal – Skills', 'internal-skills', '[gravityform id="' . $skills_id . '" title="false" description="false" ajax="true"]' );
			jrj_ensure_page( 'Internal – Medical', 'internal-medical', '[gravityform id="' . $medical_id . '" title="false" description="false" ajax="true"]' );

			// Optional: dev-mode demo seed
			if ( defined( 'JRJ_DEV_MODE' ) && JRJ_DEV_MODE ) {
				jrj_seed_internal_demo(
					array(
						'physical' => $physical_id,
						'skills'   => $skills_id,
						'medical'  => $medical_id,
					)
				);
			}
		}
		$out = ob_get_clean();
		if ( ! empty( $out ) ) {
			error_log( '[JAMROCK] Activation unexpected output: ' . substr( trim( $out ), 0, 500 ) );
		}
	}
);

// Deactivation hook (future use).
register_deactivation_hook(
	__FILE__,
	function () {
		// Placeholder for deactivation tasks.
	}
);

/**
 * Clean output buffer before REST response is sent.
 */
add_action(
	'rest_request_before_callbacks',
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
	function ( $response, $_unused_handler, $_unused_request ) {
		if ( ob_get_length() ) {
			ob_clean();
		}
		return $response;
	},
	1,
	3
);

if ( ! function_exists( 'jamrock_log' ) ) {
	/**
	 * Write structured log events.
	 *
	 * @param string $event Event name (short key).
	 * @param array  $data  Context data (avoid PII).
	 * @return void
	 */
	function jamrock_log( string $event, array $data = array() ): void {
		$payload = array(
			'ts'    => gmdate( 'c' ),
			'event' => $event,
			'data'  => $data,
		);

		// Only log if WP_DEBUG is true, to avoid leaking in production.
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( '[JAMROCK] ' . wp_json_encode( $payload ) );
		}
	}
}

/**
 * Returns instanse of the plugin class.
 */
if ( ! function_exists( 'jamrock' ) ) {
	/**
	 * Returns instanse of the plugin class.
	 *
	 * @since  1.0
	 * @return object
	 */
	function jamrock() {
		return Plugin::instance();
	}
}

// CLI command register  WP-CLI context.
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'jamrock', '\Jamrock\CLI\JamrockCLI' );
}

// lets play.
jamrock();
