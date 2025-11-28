<?php
/**
 * Shortcode handler class.
 *
 * Handles registration and rendering of all shortcodes for Jamrock.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Shortcodes;

use Jamrock\Controllers\Feedback as Database;

/**
 * Class Shortcode
 */
class Feedback {

	/**
	 * Register shortcodes on initialization.
	 */
	public static function register(): void {
		// Feedback form and results shortcodes.
		add_shortcode( 'jamrock_feedback_form', array( __CLASS__, 'render_feedback_form_shortcode' ) );
		add_shortcode( 'jamrock_feedback_results', array( __CLASS__, 'render_feedback_results_shortcode' ) );
	}

	/**
	 * Render the [jamrock_feedback_form] shortcode.
	 *
	 * Loads the necessary CSS/JS, builds the feedback form,
	 * and returns the rendered HTML output.
	 *
	 * @param array $atts    Shortcode attributes.
	 * @return string Rendered HTML form.
	 */
	public static function render_feedback_form_shortcode( $atts ): string {
		$defaults = array(
			'title' => esc_html__( 'Submit your feedback', 'jamrock' ),
		);

		$shortcode_atts = shortcode_atts( $defaults, $atts, 'jamrock_form' );

		// Enqueue assets.
		wp_enqueue_style( 'jamrock-frontend' );
		wp_enqueue_script( 'jamrock-frontend' );

		$current_user = wp_get_current_user();

		ob_start();
		?>
		<div class="jamrock-feedback-section">
			<div class="container">

				<?php if ( ! empty( $shortcode_atts['title'] ) ) : ?>
					<h2 class="my-5 mt-0"><?php echo esc_html( $shortcode_atts['title'] ); ?></h2>
				<?php endif; ?>

				<div class="feedback-area">
					<form action="" class="feedback-form" method="POST">
						<div class="form-group mb-4">
							<label for="inputFirstName"><?php esc_html_e( 'First Name', 'jamrock' ); ?></label>
							<input name="first_name" type="text" class="form-control rounded-0 inputFirstName"
								placeholder="<?php esc_attr_e( 'First Name', 'jamrock' ); ?>"
								value="<?php echo esc_attr( $current_user->user_firstname ); ?>" required>
							<div class="alert-msg text-danger"></div>
						</div>

						<div class="form-group mb-4">
							<label for="inputLastName"><?php esc_html_e( 'Last Name', 'jamrock' ); ?></label>
							<input name="last_name" type="text" class="form-control rounded-0 inputLastName"
								placeholder="<?php esc_attr_e( 'Last Name', 'jamrock' ); ?>"
								value="<?php echo esc_attr( $current_user->user_lastname ); ?>" required>
							<div class="alert-msg text-danger"></div>
						</div>

						<div class="form-group mb-4">
							<label for="inputEmail"><?php esc_html_e( 'Email', 'jamrock' ); ?></label>
							<input name="email" type="email" class="form-control rounded-0 inputEmail"
								placeholder="<?php esc_attr_e( 'Email', 'jamrock' ); ?>"
								value="<?php echo esc_attr( $current_user->user_email ); ?>">
							<div class="alert-msg text-danger"></div>
						</div>

						<div class="form-group mb-4">
							<label for="inputSubject"><?php esc_html_e( 'Subject', 'jamrock' ); ?></label>
							<input name="subject" type="text" class="form-control rounded-0 inputSubject"
								placeholder="<?php esc_attr_e( 'Subject', 'jamrock' ); ?>">
							<div class="alert-msg text-danger"></div>
						</div>

						<div class="form-group mb-4">
							<label for="inputMessage"><?php esc_html_e( 'Message', 'jamrock' ); ?></label>
							<textarea name="message" class="form-control rounded-0 inputMessage"
								placeholder="<?php esc_attr_e( 'Write Your Message', 'jamrock' ); ?>"></textarea>
							<div class="alert-msg text-danger"></div>
						</div>

						<button type="button" class="action-btn btn btn-success rounded-0 text-white">
							<?php esc_html_e( 'Submit', 'jamrock' ); ?>
						</button>
					</form>
				</div>

			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render the [jamrock_results] shortcode.
	 *
	 * Displays a paginated list of feedback results for authorized users.
	 * Includes list table, pagination, and detail section.
	 *
	 * @param array $atts    Shortcode attributes.
	 * @return string Rendered HTML results table or unauthorized message.
	 */
	public function render_feedback_results_shortcode( $atts ): string {
		$defaults = array(
			'title'         => esc_html__( 'Feedback Results', 'jamrock' ),
			'list_per_page' => 10,
		);

		$shortcode_atts = shortcode_atts( $defaults, $atts, 'jamrock_results' );
		$title          = $shortcode_atts['title'];
		$list_per_page  = absint( $shortcode_atts['list_per_page'] );

		// Enqueue assets.
		wp_enqueue_style( 'jamrock-frontend' );
		wp_enqueue_script( 'jamrock-frontend' );

		ob_start();
		?>
		<div class="jamrock-feedback-results">
			<div class="container">
				<?php if ( ! empty( $title ) ) : ?>
					<h2 class="my-5"><?php echo esc_html( $title ); ?></h2>
				<?php endif; ?>

				<?php if ( is_user_logged_in() && current_user_can( 'manage_options' ) ) : ?>
					<?php
					$get_results = new Database();
					$total       = (int) $get_results->count_total();
					$page        = isset( $_GET['cpage'] ) ? absint( wp_unslash( $_GET['cpage'] ) ) : 1; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
					$results     = $get_results->get_results( $list_per_page, $page );
					?>
					<div id="load-lists" data-items="<?php echo esc_attr( $list_per_page ); ?>">
						<?php if ( ! empty( $results ) ) : ?>
							<table class="table table-striped jamrock-table">
								<thead>
									<tr>
										<th><?php esc_html_e( 'First Name', 'jamrock' ); ?></th>
										<th><?php esc_html_e( 'Last Name', 'jamrock' ); ?></th>
										<th><?php esc_html_e( 'Email', 'jamrock' ); ?></th>
										<th><?php esc_html_e( 'Subject', 'jamrock' ); ?></th>
									</tr>
								</thead>
								<tbody>
									<?php if ( ! empty( $results ) ) : ?>
										<?php foreach ( $results as $result ) : ?>
											<tr data-id="<?php echo esc_attr( $result->id ); ?>">
												<td><?php echo esc_html( (string) ( $result->first_name ?? '' ) ); ?></td>
												<td><?php echo esc_html( (string) ( $result->last_name ?? '' ) ); ?></td>
												<td><?php echo esc_html( (string) ( $result->email ?? '' ) ); ?></td>
												<td><?php echo esc_html( (string) ( $result->subject ?? '' ) ); ?></td>
											</tr>
										<?php endforeach; ?>
									<?php else : ?>
										<tr>
											<td colspan="4"><?php esc_html_e( 'No results found.', 'jamrock' ); ?></td>
										</tr>
									<?php endif; ?>
								</tbody>
							</table>
						<?php endif; ?>
					</div>
					<div class="pagination">
					<?php
							// Normalize inputs defensively.
							$total_items  = isset( $total ) ? (int) $total : 0;
							$per_page     = max( 1, (int) ( $list_per_page ?? 10 ) );
							$current_page = max( 1, (int) ( $page ?? 1 ) );
							$total_pages  = max( 1, (int) ceil( $total_items / $per_page ) );

							$links = paginate_links(
								array(
									'base'      => add_query_arg( 'cpage', '%#%' ),
									'format'    => '',
									'total'     => $total_pages,
									'current'   => $current_page,
									'show_all'  => false,
									// Use plain characters here; paginate_links() handles escaping where needed.
									'prev_text' => __( '«', 'jamrock' ),
									'next_text' => __( '»', 'jamrock' ),
									'add_args'  => false,
								)
							);

					if ( $links ) {
						// Allow the minimal set of tags paginate_links() emits.
						echo wp_kses(
							$links,
							array(
								'a'    => array(
									'href'         => true,
									'class'        => true,
									'aria-current' => true,
									'data-page'    => true,
								),
								'span' => array(
									'class'        => true,
									'aria-current' => true,
								),
							)
						);
					}
					?>
					</div>
					<div class="details-block"></div>
				<?php else : ?>
					<div class="not-auth text-center">
						<h3 class="text-danger mb-4">
							<?php esc_html_e( 'You are not authorized to view the content of this page.', 'jamrock' ); ?>
						</h3>
						<p>
							<a href="<?php echo esc_url( wp_login_url( get_permalink() ) ); ?>">
								<?php esc_html_e( 'Please Login', 'jamrock' ); ?>
							</a>
						</p>
					</div>
				<?php endif; ?>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}
}