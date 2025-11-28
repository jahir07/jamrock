<?php
/**
 * REST controller for medical affidavit submissions.
 *
 * @package Jamrock
 */

namespace Jamrock\Controllers;

defined('ABSPATH') || exit;

use WP_REST_Request;
use WP_Error;

/**
 * Class Medical
 */
class Medical
{

	/**
	 * Table name.
	 *
	 * @var string
	 */
	protected $table;

	/**
	 * Cache group.
	 *
	 * @var string
	 */
	protected $cache_group = 'jamrock_medical';

	/**
	 * Constructor.
	 */
	public function __construct()
	{
		global $wpdb;
		$this->table = $wpdb->prefix . 'jamrock_medical_affidavits';
	}

	/**
	 * Register hooks.
	 */
	public function hooks(): void
	{
		add_action('rest_api_init', array($this, 'routes'));
	}

	/**
	 * Register REST routes.
	 */
	public function routes(): void
	{
		// Route 1: Get Data.
		register_rest_route(
			'jamrock/v1',
			'/medical/affidavit/find',
			array(
				'methods' => 'GET',
				'permission_callback' => array($this, 'permission_read'),
				'callback' => array($this, 'rest_affidavit_find'),
				'args' => array(
					'applicant_id' => array(
						'required' => true,
						'validate_callback' => function ($param) {
							return is_numeric($param);
						},
					),
				),
			)
		);

		// Route 2: Save Medical History (Affidavit).
		register_rest_route(
			'jamrock/v1',
			'/medical/affidavit',
			array(
				'methods' => 'POST',
				'permission_callback' => array($this, 'permission_save'),
				'callback' => array($this, 'rest_save_history'),
			)
		);

		// Route 3: Save Medical Clearance Data (New).
		register_rest_route(
			'jamrock/v1',
			'/medical/clearance',
			array(
				'methods' => 'POST',
				'permission_callback' => array($this, 'permission_save'),
				'callback' => array($this, 'rest_save_clearance'),
			)
		);

		// Route 4: Upload File.
		register_rest_route(
			'jamrock/v1',
			'/medical/affidavit/(?P<id>\d+)/upload',
			array(
				'methods' => 'POST',
				'permission_callback' => array($this, 'permission_upload'),
				'callback' => array($this, 'rest_affidavit_upload'),
				'args' => array(
					'id' => array(
						'required' => true,
						'validate_callback' => function ($param) {
							return is_numeric($param);
						},
					),
				),
			)
		);
	}

	/**
	 * Helper: Fetch row with Caching.
	 *
	 * @param int $applicant_id The applicant ID.
	 * @return object|null Row object or null.
	 */
	protected function get_cached_row($applicant_id)
	{
		global $wpdb;
		$cache_key = 'affidavit_' . $applicant_id;
		$row = wp_cache_get($cache_key, $this->cache_group);

		if (false === $row) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$row = $wpdb->get_row(
				$wpdb->prepare("SELECT * FROM " . $this->table . " WHERE applicant_id = %d ORDER BY created_at DESC LIMIT 1", $applicant_id)
			);
			wp_cache_set($cache_key, $row, $this->cache_group, 3600); // Cache for 1 hour.
		}

		return $row;
	}

	/**
	 * Helper: Delete Cache.
	 *
	 * @param int $applicant_id The applicant ID.
	 */
	protected function flush_cache($applicant_id)
	{
		wp_cache_delete('affidavit_' . $applicant_id, $this->cache_group);
	}

	/**
	 * Permission: Read.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function permission_read(WP_REST_Request $request)
	{
		$applicant_id = (int) $request->get_param('applicant_id');
		$current_user_id = get_current_user_id();

		if (!$current_user_id) {
			return new WP_Error('rest_forbidden', 'You must be logged in.', array('status' => 401));
		}
		if (current_user_can('manage_options') || current_user_can('edit_users')) {
			return true;
		}
		if ($current_user_id === $applicant_id) {
			return true;
		}
		return new WP_Error('rest_forbidden', 'Permission denied.', array('status' => 403));
	}

	/**
	 * Permission: Save.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function permission_save(WP_REST_Request $request)
	{
		$current_user_id = get_current_user_id();
		if (!$current_user_id) {
			return new WP_Error('rest_forbidden', 'You must be logged in.', array('status' => 401));
		}

		$nonce = $request->get_header('x_wp_nonce');
		if (!$nonce || !wp_verify_nonce($nonce, 'wp_rest')) {
			return new WP_Error('rest_forbidden', 'Invalid nonce.', array('status' => 403));
		}

		$body = $request->get_json_params();
		$applicant_id = isset($body['applicant_id']) ? (int) $body['applicant_id'] : 0;

		if (current_user_can('manage_options')) {
			return true;
		}
		if ($current_user_id === $applicant_id) {
			return true;
		}
		return new WP_Error('rest_forbidden', 'Permission denied.', array('status' => 403));
	}

	/**
	 * Permission: Upload.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function permission_upload(WP_REST_Request $request)
	{
		$current_user_id = get_current_user_id();
		if (!$current_user_id) {
			return new WP_Error('rest_forbidden', 'You must be logged in.', array('status' => 401));
		}

		$nonce = $request->get_header('x_wp_nonce');
		if (!$nonce || !wp_verify_nonce($nonce, 'wp_rest')) {
			return new WP_Error('rest_forbidden', 'Invalid nonce.', array('status' => 403));
		}

		if (current_user_can('manage_options')) {
			return true;
		}

		$affidavit_id = (int) $request->get_param('id');
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$owner_id = $wpdb->get_var(
			$wpdb->prepare("SELECT applicant_id FROM " . $this->table . " WHERE id = %d", $affidavit_id)
		);

		if ((int) $owner_id === $current_user_id) {
			return true;
		}
		return new WP_Error('rest_forbidden', 'Permission denied.', array('status' => 403));
	}

	/**
	 * GET Callback.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response
	 */
	public function rest_affidavit_find(WP_REST_Request $req)
	{
		$applicant_id = (int) $req->get_param('applicant_id');
		$row = $this->get_cached_row($applicant_id);

		return rest_ensure_response(
			array(
				'ok' => true,
				'item' => $row,
			)
		);
	}

	/**
	 * Common Save Logic.
	 *
	 * @param int    $applicant_id ID.
	 * @param string $has_cond 'yes'/'no'.
	 * @param array  $new_data Data to merge.
	 * @param string $data_key Key to merge into ('medical_history' or 'medical_clearance_data').
	 * @return array Result.
	 */
	private function perform_save($applicant_id, $has_cond, $new_data, $data_key)
	{
		global $wpdb;

		$existing = $this->get_cached_row($applicant_id);
		$details = array();

		if ($existing && !empty($existing->details)) {
			$decoded = json_decode($existing->details, true);
			if (is_array($decoded)) {
				$details = $decoded;
			}
		}

		// MERGE LOGIC: Only update the specific key.
		$details[$data_key] = $new_data;

		// Recursive Sanitization.
		$sanitize_recursive = null;
		$sanitize_recursive = function ($data) use (&$sanitize_recursive) {
			if (is_array($data)) {
				foreach ($data as $k => $v) {
					$data[$k] = $sanitize_recursive($v);
				}
				return $data;
			}
			return is_string($data) ? sanitize_text_field($data) : $data;
		};
		$clean_details = $sanitize_recursive($details);

		$data_db = array(
			'applicant_id' => $applicant_id,
			'has_conditions' => $has_cond,
			'details' => wp_json_encode($clean_details),
			'status' => 'submitted',
		);

		$format = array('%d', '%s', '%s', '%s');

		if ($existing) {
			$data_db['updated_at'] = current_time('mysql');
			$format[] = '%s';
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$updated = $wpdb->update($this->table, $data_db, array('id' => $existing->id), $format, array('%d'));
			$id = $existing->id;
		} else {
			$data_db['created_at'] = current_time('mysql');
			$data_db['medical_clearance_status'] = 'pending';
			$format[] = '%s';
			$format[] = '%s';
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$updated = $wpdb->insert($this->table, $data_db, $format);
			$id = $wpdb->insert_id;
		}

		if (false === $updated) {
			return array('error' => true);
		}

		// Invalidate cache.
		$this->flush_cache($applicant_id);

		return array(
			'ok' => true,
			'id' => $id,
			'details' => $clean_details,
		);
	}

	/**
	 * SAVE HISTORY Callback.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function rest_save_history(WP_REST_Request $req)
	{
		$body = $req->get_json_params();
		$applicant_id = isset($body['applicant_id']) ? (int) $body['applicant_id'] : 0;
		$has_cond = isset($body['has_conditions']) && 'yes' === strtolower($body['has_conditions']) ? 'yes' : 'no';
		$incoming = isset($body['details']['medical_history']) ? (array) $body['details']['medical_history'] : array();

		$res = $this->perform_save($applicant_id, $has_cond, $incoming, 'medical_history');

		if (isset($res['error'])) {
			return new WP_Error('db_error', 'Could not save history.', array('status' => 500));
		}
		return rest_ensure_response($res);
	}

	/**
	 * SAVE CLEARANCE Callback.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function rest_save_clearance(WP_REST_Request $req)
	{
		$body = $req->get_json_params();
		$applicant_id = isset($body['applicant_id']) ? (int) $body['applicant_id'] : 0;
		// Keep existing has_conditions if not sent, or default to yes (usually implied if saving clearance).
		$has_cond = 'yes';
		$incoming = isset($body['details']['medical_clearance_data']) ? (array) $body['details']['medical_clearance_data'] : array();

		$res = $this->perform_save($applicant_id, $has_cond, $incoming, 'medical_clearance_data');

		if (isset($res['error'])) {
			return new WP_Error('db_error', 'Could not save clearance data.', array('status' => 500));
		}
		return rest_ensure_response($res);
	}

	/**
	 * UPLOAD Callback.
	 *
	 * @param WP_REST_Request $req Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function rest_affidavit_upload(WP_REST_Request $req)
	{
		$id = (int) $req->get_param('id');

		if (empty($_FILES) || !isset($_FILES['file'])) {
			return new WP_Error('no_file', 'No file uploaded.', array('status' => 400));
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$file = $_FILES['file']; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$overrides = array('test_form' => false);

		add_filter(
			'upload_mimes',
			function ($mimes) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter
				return array('pdf' => 'application/pdf');
			}
		);

		$movefile = wp_handle_upload($file, $overrides);

		if (isset($movefile['error'])) {
			return new WP_Error('upload_error', $movefile['error'], array('status' => 500));
		}

		$file_url = $movefile['url'];

		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$wpdb->update(
			$this->table,
			array(
				'medical_clearance_file' => $file_url,
				'medical_clearance_status' => 'submitted',
				'updated_at' => current_time('mysql'),
			),
			array('id' => $id),
			array('%s', '%s', '%s'),
			array('%d')
		);

		// Invalidate cache for this row.
		// We need applicant_id to flush cache correctly.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$applicant_id = $wpdb->get_var($wpdb->prepare("SELECT applicant_id FROM " . $this->table . " WHERE id = %d", $id));
		if ($applicant_id) {
			$this->flush_cache($applicant_id);
		}

		return rest_ensure_response(
			array(
				'ok' => true,
				'medical_clearance_file' => $file_url,
			)
		);
	}
}