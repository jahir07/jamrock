<?php
/**
 * Learndash Proctor Meta Box Controller.
 *
 * Adds a meta box to LearnDash quiz edit screen for configuring
 * AutoProctor settings.
 *
 * @package Jamrock
 * @since   1.0.0
 */
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

/**
 * Class AutoproctorLearndashMetaBox.
 */
class AutoproctorLearndashMetaBox {

	public function hooks(): void {
		add_action( 'add_meta_boxes', array( $this, 'add_box' ) );
		add_action( 'save_post_sfwd-quiz', array( $this, 'save' ), 10, 2 );
	}

	public function add_box(): void {
		add_meta_box(
			'jrj_proctor_mb',
			'Proctor with AutoProctor',
			array( $this, 'render' ),
			'sfwd-quiz',
			'side',
			'default'
		);
	}

	public function render( \WP_Post $post ): void {
		$default_enabled = (bool) get_option( 'jrj_autoproctor_defaults', array() )['enable'] ?? false;
		if ( ! $default_enabled ) {
			echo '<p>AutoProctor is disabled by default. Enable it in the <a href="' . esc_url( admin_url( 'admin.php?page=wp-jamrock&tab=autoproctor' ) ) . '">settings</a> first.</p>';
			return;
		}
		$enabled = (bool) get_post_meta( $post->ID, '_jrj_proctor_enabled', true );
		$over    = (array) get_post_meta( $post->ID, '_jrj_proctor_overrides', true );

		wp_nonce_field( 'jrj_proctor_mb', 'jrj_proctor_mb_nonce' );
		?>
		<p><label><input type="checkbox" name="jrj_proctor_enabled" <?php checked( $enabled ); ?>> Enable</label></p>
		<p><strong>Overrides</strong></p>
		<p><label><input type="checkbox" name="jrj_over[camera]" <?php checked( ! empty( $over['camera'] ) ); ?>> Camera</label></p>
		<p><label><input type="checkbox" name="jrj_over[mic]" <?php checked( ! empty( $over['mic'] ) ); ?>> Mic</label></p>
		<p><label><input type="checkbox" name="jrj_over[screen]" <?php checked( ! empty( $over['screen'] ) ); ?>> Screen</label></p>
		<p><label><input type="checkbox" name="jrj_over[record]" <?php checked( ! empty( $over['record'] ) ); ?>> Record</label></p>
		<?php
	}

	public function save( int $post_id, \WP_Post $post ): void {
		if ( ! isset( $_POST['jrj_proctor_mb_nonce'] ) || ! wp_verify_nonce( $_POST['jrj_proctor_mb_nonce'], 'jrj_proctor_mb' ) ) {
			return;
		}
		update_post_meta( $post_id, '_jrj_proctor_enabled', ! empty( $_POST['jrj_proctor_enabled'] ) ? 1 : 0 );
		$over = array_map( 'sanitize_text_field', $_POST['jrj_over'] ?? array() );
		update_post_meta( $post_id, '_jrj_proctor_overrides', $over );
	}
}