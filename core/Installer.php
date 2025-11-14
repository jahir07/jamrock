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
		$this->create_autoproctor_tables();
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

		$charset    = $wpdb->get_charset_collate();
		$applicants = "{$wpdb->prefix}jamrock_applicants";
		$composites = "{$wpdb->prefix}jamrock_applicant_composites";
		$history    = "{$wpdb->prefix}jamrock_applicant_composite_history";

		// Anchor table: applicants.
		$sql_applicants = "CREATE TABLE {$applicants} (
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
			UNIQUE KEY email (email),
			KEY status (status),
			KEY updated_at (updated_at)
		) {$charset};";

		// Latest composite snapshot per applicant.
		$sql_composites = "CREATE TABLE {$composites} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			applicant_id BIGINT(20) UNSIGNED NOT NULL,
			status_flag ENUM('ok','provisional','hold','disqualified','pending') NOT NULL DEFAULT 'pending',
			composite DECIMAL(5,2) NOT NULL DEFAULT 0.00,
			grade CHAR(1) NOT NULL DEFAULT 'D',
			weights_json LONGTEXT NULL,
			thresholds_json LONGTEXT NULL,
			formula_version VARCHAR(20) NOT NULL DEFAULT 'v1',
			components_json LONGTEXT NULL,
			computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY applicant (applicant_id),
			KEY computed_at (computed_at)
		) {$charset};";

		// Composite audit history.
		$sql_history = "CREATE TABLE {$history} (
			id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			applicant_id BIGINT(20) UNSIGNED NOT NULL,
			status_flag ENUM('ok','provisional','hold','disqualified','pending') NOT NULL DEFAULT 'pending',
			composite DECIMAL(5,2) NOT NULL DEFAULT 0.00,
			grade CHAR(1) NOT NULL DEFAULT 'D',
			weights_json LONGTEXT NULL,
			thresholds_json LONGTEXT NULL,
			formula_version VARCHAR(20) NOT NULL DEFAULT 'v1',
			components_json LONGTEXT NULL,
			computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY applicant_id (applicant_id),
			KEY computed_at (computed_at)
		) {$charset};";

		dbDelta( $sql_applicants );
		dbDelta( $sql_composites );
		dbDelta( $sql_history );
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
			assessment_url TEXT NULL,
			email VARCHAR(190) DEFAULT NULL,
			overall_score FLOAT DEFAULT NULL,
			candidness ENUM('completed','flagged','pending','invalid') DEFAULT 'pending',
			details_json LONGTEXT DEFAULT NULL,
			payload_json LONGTEXT DEFAULT NULL,
			completed_at DATETIME DEFAULT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY  (id),
			UNIQUE KEY jamrock_provider_external (provider, external_id),
			KEY applicant_id (applicant_id),
			KEY provider (provider),
			KEY external_id (external_id),
			KEY email (email)
		) {$charset};";

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

		$sql = "CREATE TABLE IF NOT EXISTS $table (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			title VARCHAR(200) NOT NULL,
			url TEXT NOT NULL,
			category VARCHAR(100) DEFAULT NULL,
			visibility_status ENUM('public','private','hidden') DEFAULT 'public',
			sort_order INT DEFAULT 0,
			notes TEXT NULL,
			http_status SMALLINT NULL,
			last_checked DATETIME NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY visibility_status (visibility_status),
			KEY sort_order (sort_order),
			KEY category (category)
		) $charset;";

		dbDelta( $sql );
	}

	private static function create_autoproctor_tables() {
		global $wpdb;
		$charset = $wpdb->get_charset_collate();

		$t1   = $wpdb->prefix . 'jamrock_autoproctor_attempts';
		$sql1 = "CREATE TABLE $t1 (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			user_id BIGINT UNSIGNED NOT NULL,
			user_name VARCHAR(191) NULL,
  			user_email VARCHAR(191) NULL,
			quiz_id BIGINT UNSIGNED NOT NULL,
			attempt_id BIGINT UNSIGNED DEFAULT 0,
			provider VARCHAR(50) NOT NULL DEFAULT 'autoproctor',
			session_id VARCHAR(191) DEFAULT NULL,
			integrity_score FLOAT DEFAULT NULL,
			flags_json LONGTEXT NULL,
			raw_payload_json LONGTEXT NULL,
			started_at DATETIME DEFAULT NULL,
			completed_at DATETIME DEFAULT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			KEY user_quiz (user_id, quiz_id),
			KEY session_id (session_id)
			) $charset;";

		dbDelta( $sql1 );
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
