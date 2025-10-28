<?php
/**
 * Announcements Shortcode
 *
 * Renders the front-end container and enqueues the Announcement Vue app.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Shortcodes;

defined( 'ABSPATH' ) || exit;

class Announcements {


	/**
	 * Hook shortcode and assets.
	 *
	 * @return void
	 */
	public function __construct() {
		add_shortcode( 'jamrock_announcements', array( $this, 'render' ) );
	}

	/**
	 * Render the [jamrock_Announcement] shortcode.
	 *
	 * @return string
	 */
	public function render( $atts ): string {
		if ( ! is_user_logged_in() ) {
			return '<p>You need to be signed in to view your training Announcement.</p>';
		}
			$atts = shortcode_atts(
				array(
					'title' => 'Announcements',
					'limit' => 4,
				),
				$atts
			);

			// Pinned first, then most recent
			$q = new \WP_Query(
				array(
					'post_type'      => 'jrj_announcement',
					'post_status'    => 'publish',
					'posts_per_page' => (int) $atts['limit'],
					'meta_key'       => 'pinned',
					'orderby'        => array(
						'meta_value_num' => 'DESC',
						'date'           => 'DESC',
					),
				)
			);

		if ( ! $q->have_posts() ) {
			return '<div class="jrj-announce"><div class="jrj-empty">No announcements right now.</div></div>';
		}

		ob_start(); ?>
		<div class="jrj-announce">
		<h2 class="jrj-title"><?php echo esc_html( $atts['title'] ); ?></h2>
		<ul class="jrj-list">
			<?php
			foreach ( $q->posts as $p ) :
					$type = get_post_meta( $p->ID, 'type', true ) ?: 'general';
					$link = get_post_meta( $p->ID, 'link_url', true );
					$when = human_time_diff( get_post_time( 'U', true, $p ), time() ) . ' ago';
				?>
				<li class="jrj-card jrj-type-<?php echo esc_attr( $type ); ?>">
				<strong class="jrj-lead">
				<?php
				echo esc_html(
					array(
						'new_course'  => 'New course:',
						'policy'      => 'Policy update:',
						'ai_update'   => 'Ask Jamrock:', // TODO Phase2 # change later.
						'post_update' => 'Update:',
						'expiry'      => 'Reminder:',
					)[ $type ] ?? 'Update:'
				);
				?>
				</strong>
				<span class="jrj-text"><?php echo esc_html( get_the_title( $p ) ); ?></span>
				<span class="jrj-when">• <?php echo esc_html( $when ); ?></span>
					<?php if ( $link ) : ?>
						<a class="jrj-link" href="<?php echo esc_url( $link ); ?>" target="_blank" rel="noopener">View</a>
				<?php endif; ?>
				</li>
			<?php endforeach; ?>
		</ul>
		</div>
		<?php
		return ob_get_clean();
	}
}