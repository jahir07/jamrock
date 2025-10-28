<?php
/**
 * Handles AJAX functionality for the plugin.
 *
 * @package Jamrock
 * @since   1.0
 */

namespace Jamrock\Ajax;

use Jamrock\Controllers\Feedback as FeedbackController;

/**
 * Class Feedback AJAX handlers.
 */
class Feedback {

	/**
	 * Controller instance.
	 *
	 * @var FeedbackController
	 */
	protected $db;

	/**
	 * Constructor.
	 *
	 * @param FeedbackController|null $db Optional controller instance.
	 */
	public function __construct( ?FeedbackController $db = null ) {
		$this->db = $db instanceof FeedbackController ? $db : new FeedbackController();

		add_action( 'wp_ajax_jamrock_form_action', array( $this, 'form_callback' ) );
		add_action( 'wp_ajax_nopriv_jamrock_form_action', array( $this, 'form_callback' ) );

		// Get results (admins only).
		add_action( 'wp_ajax_jamrock_result_action', array( $this, 'result_callback' ) );

		// Get result by ID.
		add_action( 'wp_ajax_jamrock_result_by_id_action', array( $this, 'result_by_id_callback' ) );

		// Pagination.
		add_action( 'wp_ajax_jamrock_pagination_action', array( $this, 'pagination_callback' ) );
	}

	/**
	 * Handle feedback form submission (AJAX).
	 */
	public function form_callback(): void {
		// Security: verify nonce first (no auto-die; we return JSON consistently).
		if ( ! check_ajax_referer( 'jamrock', 'nonce', false ) ) {
			$this->return_json( 'error', __( 'Security check failed.', 'jamrock' ) );
		}

		// Basic payload guard.
		if ( empty( $_POST['data'] ) || ! is_string( $_POST['data'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing -- Verified above.
			$this->return_json( 'error', __( 'Invalid request payload.', 'jamrock' ) );
		}

		// Convert serialized query string into array.
		$form_vals = array();
		wp_parse_str( wp_unslash( $_POST['data'] ), $form_vals ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Sanitized below.

		// Sanitize fields.
		$first_name = isset( $form_vals['first_name'] ) ? sanitize_text_field( $form_vals['first_name'] ) : '';
		$last_name  = isset( $form_vals['last_name'] ) ? sanitize_text_field( $form_vals['last_name'] ) : '';
		$email      = isset( $form_vals['email'] ) ? sanitize_email( $form_vals['email'] ) : '';
		$subject    = isset( $form_vals['subject'] ) ? sanitize_text_field( $form_vals['subject'] ) : '';
		$message    = isset( $form_vals['message'] ) ? wp_kses_post( $form_vals['message'] ) : '';

		if ( empty( $first_name ) || empty( $last_name ) || empty( $email ) || empty( $subject ) || empty( $message ) ) {
			$this->return_json( 'error', __( 'Please fill in all required fields.', 'jamrock' ) );
		}

		// Persist to DB.
		$insert_id = $this->db->do_insert( $first_name, $last_name, $email, $subject, $message );

		if ( is_wp_error( $insert_id ) ) {
			$this->return_json( 'error', $insert_id->get_error_message() );
		}

		$this->return_json( 'success', __( 'Thank you for sending us your feedback.', 'jamrock' ) );
	}

	/**
	 * Get results (admins only). Outputs an HTML table.
	 */
	public function result_callback(): void {
		if ( ! check_ajax_referer( 'jamrock', 'nonce', false ) ) {
			$this->return_json( 'error', __( 'Security check failed.', 'jamrock' ) );
		}

		if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
			$this->return_json( 'error', __( 'Not allowed.', 'jamrock' ) );
		}

		// Pagination values.
		$list_per_page = isset( $_GET['list_per_page'] ) ? absint( wp_unslash( $_GET['list_per_page'] ) ) : 10;
		$page          = isset( $_GET['page_no'] ) ? absint( wp_unslash( $_GET['page_no'] ) ) : 1;

		$results = $this->db->get_results( $list_per_page, $page );

		if ( empty( $results ) ) {
			// Empty table scaffold for consistent UI.
			?>
			<table class="table table-striped jamrock-table">
				<thead>
					<tr>
						<th><?php esc_html_e( 'First Name', 'jamrock' ); ?></th>
						<th><?php esc_html_e( 'Email', 'jamrock' ); ?></th>
						<th><?php esc_html_e( 'Subject', 'jamrock' ); ?></th>
						<th><?php esc_html_e( 'Action', 'jamrock' ); ?></th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td colspan="4"><?php esc_html_e( 'No results found.', 'jamrock' ); ?></td>
					</tr>
				</tbody>
			</table>
			<?php
			wp_die();
		}
		?>
		<table class="table table-striped jamrock-table">
			<thead>
				<tr>
					<th><?php esc_html_e( 'First Name', 'jamrock' ); ?></th>
					<th><?php esc_html_e( 'Email', 'jamrock' ); ?></th>
					<th><?php esc_html_e( 'Subject', 'jamrock' ); ?></th>
					<th><?php esc_html_e( 'Action', 'jamrock' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $results as $result ) : ?>
					<tr>
						<td><?php echo esc_html( $result->first_name ); ?></td>
						<td><?php echo esc_html( $result->email ); ?></td>
						<td><?php echo esc_html( $result->subject ); ?></td>
						<td>
							<div class="jrj-view-result" data-id="<?php echo esc_attr( $result->id ); ?>"
								title="<?php esc_attr_e( 'View Details', 'jamrock' ); ?>">
								<span class="dashicons dashicons-visibility"></span>
							</div>
						</td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<?php
		wp_die();
	}

	/**
	 * Get a single result by ID (admins only). Outputs HTML fragment.
	 */
	public function result_by_id_callback(): void {
		if ( ! check_ajax_referer( 'jamrock', 'nonce', false ) ) {
			$this->return_json( 'error', __( 'Security check failed.', 'jamrock' ) );
		}

		if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
			$this->return_json( 'error', __( 'Not allowed.', 'jamrock' ) );
		}

		$id = isset( $_GET['id'] ) ? absint( wp_unslash( $_GET['id'] ) ) : 0;
		if ( ! $id ) {
			$this->return_json( 'error', __( 'Invalid ID.', 'jamrock' ) );
		}

		$result = $this->db->get_result_by_id( $id );
		if ( ! $result ) {
			$this->return_json( 'error', __( 'Feedback not found.', 'jamrock' ) );
		}
		?>
		<h2 class="mt-5"><?php esc_html_e( 'Detail Information', 'jamrock' ); ?></h2>
		<ul class="details-list list-unstyled">
			<li><span><?php esc_html_e( 'First Name', 'jamrock' ); ?></span>: <?php echo esc_html( $result->first_name ); ?>
			</li>
			<li><span><?php esc_html_e( 'Last Name', 'jamrock' ); ?></span>: <?php echo esc_html( $result->last_name ); ?></li>
			<li><span><?php esc_html_e( 'Email', 'jamrock' ); ?></span>: <?php echo esc_html( $result->email ); ?></li>
			<li><span><?php esc_html_e( 'Subject', 'jamrock' ); ?></span>: <?php echo esc_html( $result->subject ); ?></li>
			<li><span><?php esc_html_e( 'Message', 'jamrock' ); ?></span>:
				<?php echo wp_kses_post( wpautop( $result->message ) ); ?></li>
		</ul>
		<?php
		wp_die();
	}

	/**
	 * Pagination update (admins only). Returns JSON with HTML list + pagination markup.
	 */
	public function pagination_callback(): void {
		if ( ! check_ajax_referer( 'jamrock', 'nonce', false ) ) {
			$this->return_json( 'error', __( 'Security check failed.', 'jamrock' ) );
		}

		if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
			$this->return_json( 'error', __( 'Not allowed.', 'jamrock' ) );
		}

		$page_no       = isset( $_POST['page_no'] ) ? absint( wp_unslash( $_POST['page_no'] ) ) : 1;
		$list_per_page = isset( $_POST['list_per_page'] ) ? absint( wp_unslash( $_POST['list_per_page'] ) ) : 10;

		if ( $page_no < 1 ) {
			$this->return_json( 'error', __( 'Invalid page.', 'jamrock' ) );
		}

		$total   = (int) $this->db->count_total();
		$results = $this->db->get_results( $list_per_page, $page_no );

		ob_start();
		if ( ! empty( $results ) ) {
			foreach ( $results as $result ) {
				?>
				<ul class="list-result list-unstyled d-flex gap-3 justify-content-between"
					data-id="<?php echo esc_attr( $result->id ); ?>">
					<li><?php echo esc_html( $result->first_name ); ?></li>
					<li><?php echo esc_html( $result->last_name ); ?></li>
					<li><?php echo esc_html( $result->email ); ?></li>
					<li><?php echo esc_html( $result->subject ); ?></li>
				</ul>
				<?php
			}
		} else {
			?>
			<ul class="list-result list-unstyled">
				<li><?php esc_html_e( 'No results found.', 'jamrock' ); ?></li>
			</ul>
			<?php
		}
		$list_html = ob_get_clean();

		$pagination = paginate_links(
			array(
				'base'      => '?cpage=%#%',
				'format'    => '',
				'total'     => max( 1, (int) ceil( $total / max( 1, $list_per_page ) ) ),
				'current'   => max( 1, $page_no ),
				'show_all'  => false,
				'prev_text' => __( '&laquo;', 'jamrock' ),
				'next_text' => __( '&raquo;', 'jamrock' ),
			)
		);

		wp_send_json_success(
			array(
				'list_html'  => $list_html,
				'pagination' => $pagination,
			)
		);
	}

	/**
	 * Send JSON response with status and message.
	 *
	 * @param string $status  'success' or 'error'.
	 * @param string $message Optional message.
	 */
	public function return_json( string $status, string $message = '' ): void {
		$response = array(
			'status'  => $status,
			'message' => $message,
		);

		wp_send_json( $response ); // Calls wp_die() internally.
	}
}
