<?php
/**
 * Main Plugin Class
 *
 * This class is responsible for initializing the plugin,
 * setting up hooks, and managing the overall functionality.
 *
 * @package Jamrock
 * @since   1.0
 */

namespace Jamrock\Core;

use Jamrock\Shortcodes\{LearnDash, Dashboard, Announcements};

/**
 * Class Plugin.
 * Hold the entire plugin function
 *
 * @since 1.0
 */
final class Plugin {


	/**
	 * Plugin version
	 *
	 * @var string
	 */
	public $version = '1.0.0';

	/**
	 * Minimum PHP version required
	 *
	 * @var string
	 */
	private $min_php = '7.4';

	/**
	 * Self Instance
	 *
	 * @var Plugin
	 */
	private static $instance = null;

	/**
	 * Hold Various instance
	 *
	 * @var array
	 */
	private $container = array();

	/**
	 * Constructor Magic Method
	 *
	 * Sets up all appropriate hooks and actions
	 * within this plugin.
	 */
	private function __construct() {
	}

	/**
	 * Activation callback.
	 *
	 * Deactivates and shows a message if PHP is too old.
	 *
	 * @return void
	 */
	public function activate(): void {
		// Bail if PHP version not supported.
		if ( ! $this->is_supported_php() ) {
			// Deactivate this plugin safely (adjust constant/file as needed).
			deactivate_plugins( plugin_basename( __FILE__ ) );

			$message = sprintf(
				// Translators: 1 - This plugin cannot be activated because it requires at least PHP, 2 - PHP version.
				esc_html__(
					'This plugin cannot be activated because it requires at least PHP version %s.',
					'jamrock'
				),
				esc_html( $this->min_php )
			);

			$link = sprintf(
				'<p><a href="%s">%s</a></p>',
				esc_url( admin_url( 'plugins.php' ) ),
				esc_html__( 'Back to Plugins', 'jamrock' )
			);

			wp_die( wp_kses_post( '<p>' . $message . '</p>' . $link ) );
		}
	}

	/**
	 * Initiaze the plugin class.
	 *
	 * - Checks for an existing Jamrock() instance
	 * - If not exists create new one
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new Plugin();

			add_action( 'plugins_loaded', array( self::$instance, 'init_plugin' ) );
		}

		return self::$instance;
	}


	/**
	 * Check PHP version is supported or not.
	 *
	 * @return bool
	 */
	public function is_supported_php() {

		if ( version_compare( PHP_VERSION, $this->min_php, '<=' ) ) {
			return false;
		}

		return true;
	}


	/**
	 * Init plugin.
	 *
	 * @return void
	 */
	public function init_plugin() {
		// Localize our plugin.
		add_action( 'init', array( $this, 'localization_setup' ) );

		// init classes.
		add_action( 'init', array( $this, 'init_classes' ) );

		// Admin only hooks.
		( new \Jamrock\Core\Admin() )->hooks();

		// Controllers.
		( new \Jamrock\Controllers\Insights() )->hooks();
		( new \Jamrock\Controllers\Settings() )->hooks();
		( new \Jamrock\Controllers\Psymetrics() )->hooks();
		( new \Jamrock\Controllers\Composite() )->hooks();
		// form IDs from options.
		$form_physical = (int) get_option( 'jrj_form_physical_id', 0 ) ?: 2;
		$form_skills   = (int) get_option( 'jrj_form_skills_id', 0 ) ?: 3;
		$form_medical  = (int) get_option( 'jrj_form_medical_id', 0 ) ?: 4;
		( new \Jamrock\Controllers\InternalAssessments( $form_physical, $form_skills, $form_medical ) )->hooks();

		( new \Jamrock\Controllers\InternalGFEdit( $form_physical, $form_skills, $form_medical ) )->hooks();
		( new \Jamrock\Controllers\Applicants() )->hooks();
		( new \Jamrock\Controllers\Webhooks() )->hooks();
		( new \Jamrock\Controllers\Housing() )->hooks();
		( new \Jamrock\Controllers\PaymentExtension() )->hooks();
		( new \Jamrock\Controllers\Medical() )->hooks();
		( new \Jamrock\Controllers\Logs() )->hooks();
		( new \Jamrock\Controllers\Courses() )->hooks();

		// Autoproctor Settings
		( new \Jamrock\Controllers\AutoproctorSettings() )->hooks();
		( new \Jamrock\Controllers\Autoproctoring() )->hooks();
		( new \Jamrock\Controllers\AutoproctorLearndashMetaBox() )->hooks();

		// ( new Feedback() )->hooks();

		( new \Jamrock\Controllers\CoursesSync() )->hooks();
		( new \Jamrock\Controllers\Dashboard() )->hooks();
		( new \Jamrock\Controllers\GravityFormsListener() )->hooks();
		( new \Jamrock\Controllers\PsymetricsGFListener() )->hooks();

		if ( function_exists( 'register_block_type' ) ) {
			// gutenberg.
			add_action( 'init', array( $this, 'register_block_types' ) );
		}
	}

	/**
	 * Initialize plugin for localization.
	 *
	 * @uses load_plugin_textdomain()
	 */
	public function localization_setup() {
		load_plugin_textdomain( 'jamrock', false, dirname( plugin_basename( JRJ_FILE ) ) . '/languages/' );
	}

	/**
	 * Initialize required classes
	 *
	 * @return void
	 */
	public function init_classes() {
		// plugin assets.
		$this->container['assets'] = new \Jamrock\Core\Assets();

		// frontend.
		if ( $this->is_request( 'frontend' ) ) {
			// shortcode.
			$this->container['learndash_shortcode']           = new LearnDash();
			$this->container['learndash_dashboard_shortcode'] = new Dashboard();
			$this->container['announcements']                 = new Announcements();

			// Register PsymetricsAssessmentIframe shortcode.
			\Jamrock\Shortcodes\PsymetricsAssessmentIframe::register();

			( new \Jamrock\Controllers\AutoproctorFrontend() )->hooks();

		}
	}


	/**
	 * Block register.
	 *
	 * @return void
	 */
	public function register_block_types() {
		register_block_type(
			'jamrock/form',
			array(
				'render_callback' => array( $this, 'render_form' ),
			)
		);

		register_block_type(
			'jamrock/result',
			array(
				'render_callback' => array( $this, 'render_result' ),
			)
		);
	}

	/**
	 * Check the current request type.
	 *
	 * Determines whether the current execution context is admin, AJAX,
	 * cron, or frontend.
	 *
	 * @param string $type Request type: 'admin', 'ajax', 'cron', or 'frontend'.
	 * @return bool True if the current request matches the given type, false otherwise.
	 */
	private function is_request( $type ): bool {
		switch ( $type ) {
			case 'admin':
				return is_admin();

			case 'ajax':
				return ( defined( 'DOING_AJAX' ) && DOING_AJAX );

			case 'cron':
				return ( defined( 'DOING_CRON' ) && DOING_CRON );

			case 'frontend':
				return ! is_admin() && ! ( defined( 'DOING_AJAX' ) && DOING_AJAX ) && ! ( defined( 'DOING_CRON' ) && DOING_CRON );

			default:
				return false;
		}
	}
}
