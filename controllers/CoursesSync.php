<?php
/**
 * Courses Sync: LearnDash events → jamrock_courses table upsert
 *
 * @package Jamrock
 */

namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class CoursesSync {


	/**
	 * Register all LearnDash-driven hooks.
	 */
	public static function hooks(): void {
		// Only run if LearnDash is active.
		if ( ! defined( 'LEARNDASH_VERSION' ) ) {
			return;
		}

		// Enroll / Unenroll.
		add_action( 'ld_added_course_access', array( __CLASS__, 'on_enroll' ), 10, 4 );
		add_action( 'ld_removed_course_access', array( __CLASS__, 'on_unenroll' ), 10, 2 );

		// Course + Quiz completion.
		add_action( 'learndash_course_completed', array( __CLASS__, 'on_course_completed' ), 10, 1 );
		add_action( 'learndash_quiz_completed', array( __CLASS__, 'on_quiz_completed' ), 10, 1 );
	}

	/**
	 * Target table name.
	 */
	private static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'jamrock_courses';
	}

	/**
	 * Insert-or-update a (user_id, course_id) row.
	 *
	 * @param int   $user_id   User ID.
	 * @param int   $course_id Course ID.
	 * @param array $fields    Column => value map (nullable values allowed).
	 */
	private static function upsert( int $user_id, int $course_id, array $fields = array() ): void {
		global $wpdb;
		$table   = self::table();
		$now_gmt = current_time( 'mysql', true ); // GMT datetime.

		$defaults = array(
			'status'          => 'in_progress', // allowed: in_progress, completed, expired, unenrolled
			'score'           => null,
			'certificate_url' => null,
			'expiry_date'     => null,
			'updated_at'      => $now_gmt,
		);

		// Drop only NULLs from $fields so 0/'' not lost.
		$data = array_merge( $defaults, array_filter( $fields, static fn( $v ) => $v !== null ) );

		// Does a row already exist?
		$existing_id = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM {$table} WHERE user_id = %d AND course_id = %d",
				$user_id,
				$course_id
			)
		);

		if ( $existing_id ) {
			// Always refresh updated_at on change.
			$data['updated_at'] = $now_gmt;
			$wpdb->update(
				$table,
				$data,
				array( 'id' => (int) $existing_id )
			);
		} else {
			$wpdb->insert(
				$table,
				array_merge(
					array(
						'user_id'    => (int) $user_id,
						'course_id'  => (int) $course_id,
						'updated_at' => $now_gmt,
					),
					$data
				)
			);
		}
	}

	/*
	=======================
	 * Helpers
	 * ======================= */

	private static function get_expiry( int $user_id, int $course_id ): ?string {
		if ( function_exists( 'ld_course_access_expires_on' ) ) {
			$ts = (int) ld_course_access_expires_on( $user_id, $course_id );
			return $ts ? gmdate( 'Y-m-d H:i:s', $ts ) : null;
		}
		return null;
	}

	private static function get_cert( int $user_id, int $course_id ): ?string {
		if ( function_exists( 'learndash_get_course_certificate_link' ) ) {
			$link = learndash_get_course_certificate_link( $course_id, $user_id );
			return $link ?: null;
		}
		return null;
	}

	/*
	=======================
	 * LearnDash Hooks
	 * ======================= */

	/**
	 * User got course access (enrolled).
	 *
	 * @param int $user_id
	 * @param int $course_id
	 */
	public static function on_enroll( int $user_id, int $course_id ): void {
		if ( ! $user_id || ! $course_id ) {
			return;
		}

		self::upsert(
			$user_id,
			$course_id,
			array(
				'status'      => 'in_progress',
				'expiry_date' => self::get_expiry( $user_id, $course_id ),
			)
		);
	}

	/**
	 * User removed from course (unenrolled).
	 *
	 * @param int $user_id
	 * @param int $course_id
	 */
	public static function on_unenroll( int $user_id, int $course_id ): void {
		if ( ! $user_id || ! $course_id ) {
			return;
		}

		self::upsert(
			$user_id,
			$course_id,
			array(
				'status' => 'unenrolled', // NOTE: make sure REST allowlist includes 'unenrolled'
			)
		);
	}

	/**
	 * Course completed.
	 *
	 * @param array $data e.g. [ 'user' => int, 'course' => int, ... ]
	 */
	public static function on_course_completed( $data ): void {
		$user_id   = (int) ( $data['user'] ?? 0 );
		$course_id = (int) ( $data['course'] ?? 0 );
		if ( ! $user_id || ! $course_id ) {
			return;
		}

		self::upsert(
			$user_id,
			$course_id,
			array(
				'status'          => 'completed',
				'certificate_url' => self::get_cert( $user_id, $course_id ),
				'expiry_date'     => self::get_expiry( $user_id, $course_id ),
			)
		);
	}

	/**
	 * Quiz completed (capture score).
	 *
	 * @param array $quiz_data e.g. [ 'user' => int, 'course' => int, 'percentage' => float ]
	 */
	public static function on_quiz_completed( $quiz_data ): void {
		$user_id   = (int) ( $quiz_data['user'] ?? 0 );
		$course_id = (int) ( $quiz_data['course'] ?? 0 );
		$score_raw = $quiz_data['percentage'] ?? $quiz_data['score'] ?? null;

		if ( ! $user_id || ! $course_id || $score_raw === null ) {
			return;
		}

		$score = is_numeric( $score_raw ) ? (float) $score_raw : null;

		// (ঐচ্ছিক) clamp 0-100
		if ( is_float( $score ) ) {
			$score = max( 0.0, min( 100.0, $score ) );
		}

		self::upsert(
			$user_id,
			$course_id,
			array( 'score' => $score )
		);
	}
}
