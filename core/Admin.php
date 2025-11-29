<?php
/**
 * Handles Admin functionality for the plugin.
 *
 * This class defines all code necessary to run vue settings page.
 *
 * @package Jamrock
 * @since   1.0
 */

namespace Jamrock\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Class Admin
 *
 * @since 1.0
 */
class Admin {

	/** The main admin page slug */
	const SLUG = 'wp-jamrock';

	/**
	 * Summary of hooks
	 *
	 * @return void
	 */
	public function hooks(): void {
		add_action( 'admin_menu', array( $this, 'register_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
	}

	/**
	 * Register admin menu and submenus.
	 *
	 * @return void
	 */
	public function register_menu(): void {
		add_menu_page(
			__( 'Jamrock', 'jamrock' ),
			__( 'Jamrock', 'jamrock' ),
			'manage_options',
			self::SLUG,
			array( $this, 'render_app' ),
			'dashicons-feedback',
			3
		);

		add_submenu_page(
			self::SLUG,
			__( 'Dashboard', 'jamrock' ),
			__( 'Dashboard', 'jamrock' ),
			'manage_options',
			self::SLUG,
			array( $this, 'render_app' )
		);

		$add = function ( $title, $view ) {
			add_submenu_page(
				self::SLUG,
				$title,
				$title,
				'manage_options',
				self::SLUG . '&view=' . $view,
				array( $this, 'render_app' )
			);
		};

		$add( __( 'Settings', 'jamrock' ), 'settings' );
		$add( __( 'Courses', 'jamrock' ), 'courses' );
		$add( __( 'Applicants', 'jamrock' ), 'applicantswithcomposite' );
		$add( __( 'Assessments', 'jamrock' ), 'assessments' );

		// add CPT link *manually* to point at edit.php?post_type=jrj_announcement
		// This will appear under Jamrock menu and link to the CPT list screen.
		add_submenu_page(
			self::SLUG,
			__( 'Announcements', 'jamrock' ),
			__( 'Announcements', 'jamrock' ),
			'manage_options',
			'edit.php?post_type=jrj_announcement'
		);

		$add( __( 'Logs', 'jamrock' ), 'logs' );
		$add( __( 'Info & Shortcodes', 'jamrock' ), 'info' );
	}


	/**
	 * Render the admin app container.
	 *
	 * @return void
	 */
	public function render_app(): void {
		echo '<div id="jamrock-admin-app"></div>';

		$view    = isset( $_GET['view'] ) ? sanitize_key( wp_unslash( $_GET['view'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$allowed = array( 'dashboard', 'settings', 'courses', 'housing', 'applicantswithcomposite', 'assessments', 'feedback', 'logs', 'info' );
		if ( ! in_array( $view, $allowed, true ) ) {
			$view = 'dashboard'; // default tab.
		}
		?>
			<script>
				window.__JAMROCK_BOOT_TAB = <?php echo wp_json_encode( $view ); ?>;
			</script>
			<?php
	}

	/**
	 * Enqueue admin scripts and styles.
	 *
	 * @return void
	 */
	public function enqueue(): void {
		$screen = get_current_screen();
		if ( ! $screen || strpos( (string) $screen->base, self::SLUG ) === false ) {
			return;
		}

		$asset = include plugin_dir_path( __FILE__ ) . '../assets/admin/admin.asset.php';

		wp_enqueue_script(
			'jrj-admin',
			JRJ_ASSETS . '/admin/admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'jrj-admin',
			JRJ_ASSETS . '/admin/admin.css',
			array(),
			$asset['version']
		);

		wp_add_inline_script(
			'jrj-admin',
			'window.JRJ_ADMIN = ' . wp_json_encode(
				array(
					'root'  => esc_url_raw( rest_url( 'jamrock/v1/' ) ),
					'nonce' => wp_create_nonce( 'wp_rest' ),
					'cap'   => current_user_can( 'manage_options' ),
					'i18n'  => array( 'areYouSure' => __( 'Are you sure?', 'jamrock' ) ),
				)
			),
			'before'
		);
	}
}
