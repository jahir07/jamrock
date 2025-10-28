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
		$installer = new Installer();
		$installer->do_install();
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

// lets play.
jamrock();
