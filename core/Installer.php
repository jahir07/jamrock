<?php
/**
 * Installer class.
 *
 * Handles the installation process of the Jamrock plugin,
 * including creation of necessary database tables.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Core;

defined( 'ABSPATH' ) || exit;

/**
 * Class Installer
 */
class Installer {


	/**
	 * Run the installer.
	 *
	 * Creates required database tables.
	 *
	 * @return void
	 */
	public function do_install(): void {
		$this->create_tables();
	}

	/**
	 * Create all necessary tables for the plugin.
	 *
	 * @return void
	 */
	protected function create_tables(): void {
		include_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$this->create_applicants_table();
		$this->create_assessments_table();
		$this->create_courses_table();
		$this->create_housing_links_table();
		$this->create_logs_table();
		$this->create_feedback_table();
	}


	/**
	 * Applicants table.
	 */
	protected function create_applicants_table(): void {
		global $wpdb;
		$table   = $wpdb->prefix . 'jamrock_applicants';
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			jamrock_user_id CHAR(36) NOT NULL,
			first_name VARCHAR(100) NOT NULL,
			last_name VARCHAR(100) NOT NULL,
			email VARCHAR(191) NOT NULL,
			phone VARCHAR(50) DEFAULT NULL,
			status ENUM('applied','shortlisted','hired','active','inactive','knockout') DEFAULT 'applied',
			score_total FLOAT DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY jamrock_user_id (jamrock_user_id),
			KEY email (email)
		) {$charset};";

		dbDelta( $sql );
	}

	/**
	 * Assessments table.
	 */
	protected function create_assessments_table(): void {
		global $wpdb;
		$table   = $wpdb->prefix . 'jamrock_assessments';
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
		id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
		applicant_id BIGINT(20) UNSIGNED DEFAULT NULL,
		provider VARCHAR(50) NOT NULL,
		external_id VARCHAR(100) DEFAULT NULL,
		email VARCHAR(190) DEFAULT NULL,
		overall_score FLOAT DEFAULT NULL,
		candidness ENUM('cleared','flagged','pending','invalid') DEFAULT 'pending',
		details_json LONGTEXT DEFAULT NULL,
		payload_json LONGTEXT DEFAULT NULL,
		completed_at DATETIME DEFAULT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY  (id),
		KEY applicant_id (applicant_id),
		KEY provider (provider),
		KEY external_id (external_id),
		KEY email (email)
	) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );
	}

	/**
	 * Courses table.
	 */
	protected function create_courses_table(): void {
		global $wpdb;
		$table   = $wpdb->prefix . 'jamrock_courses';
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			user_id BIGINT(20) UNSIGNED NOT NULL,
			course_id BIGINT(20) UNSIGNED NOT NULL,
			status ENUM('enrolled','completed','overdue') DEFAULT 'enrolled',
			score FLOAT DEFAULT NULL,
			certificate_url VARCHAR(255) DEFAULT NULL,
			expiry_date DATE DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY user_id (user_id),
			KEY course_id (course_id)
		) {$charset};";

		dbDelta( $sql );
	}

	/**
	 * Housing links table.
	 */
	protected function create_housing_links_table(): void {
		global $wpdb;
		$table   = $wpdb->prefix . 'jamrock_housing_links';
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			title VARCHAR(191) NOT NULL,
			url VARCHAR(255) NOT NULL,
			visibility_status ENUM('all','shortlisted','active_only') DEFAULT 'all',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id)
		) {$charset};";

		dbDelta( $sql );
	}

	/**
	 * Logs table.
	 */
	protected function create_logs_table(): void {
		global $wpdb;
		$table   = $wpdb->prefix . 'jamrock_logs';
		$charset = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			event VARCHAR(100) NOT NULL,
			payload_json LONGTEXT DEFAULT NULL,
			result VARCHAR(50) DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY event (event)
		) {$charset};";

		dbDelta( $sql );
	}

	/**
	 * Feedback table.
	 */
	protected function create_feedback_table(): void {
		global $wpdb;
		$table_name      = $wpdb->prefix . 'jamrock_feedback';
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table_name} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			first_name VARCHAR(55) NOT NULL,
			last_name VARCHAR(55) NOT NULL,
			email VARCHAR(100) NOT NULL,
			subject VARCHAR(255) NOT NULL,
			message TEXT NOT NULL,
			date_created DATETIME NOT NULL,
			date_updated DATETIME NOT NULL,
			PRIMARY KEY  (id),
			KEY date_updated (date_updated)
		) {$charset_collate};";

		dbDelta( $sql );
	}
}
