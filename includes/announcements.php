<?php
/**
 * Summary of jrj_ann_debounce_exists
 *
 * @param mixed $origin_key
 * @return bool
 */
function jrj_ann_debounce_exists( $origin_key ) {
	$q = new WP_Query(
		array(
			'post_type'      => 'jrj_announcement',
			'post_status'    => 'publish',
			'meta_key'       => '_origin_key',
			'meta_value'     => $origin_key,
			'date_query'     => array( array( 'after' => '1 day ago' ) ),
			'fields'         => 'ids',
			'posts_per_page' => 1,
		)
	);
	return ! empty( $q->posts );
}

function jrj_ann_create( $args ) {
	$id = wp_insert_post(
		array(
			'post_type'    => 'jrj_announcement',
			'post_status'  => 'publish',
			'post_title'   => wp_strip_all_tags( $args['title'] ?? 'Update' ),
			'post_content' => $args['content'] ?? '',
		)
	);
	if ( is_wp_error( $id ) ) {
		return;
	}

	update_post_meta( $id, 'type', $args['type'] ?? 'general' );
	update_post_meta( $id, 'source', $args['source'] ?? 'auto' );
	update_post_meta( $id, 'link_url', $args['link_url'] ?? '' );
	update_post_meta( $id, 'pinned', ! empty( $args['pinned'] ) );
	update_post_meta( $id, 'expires_at', $args['expires_at'] ?? '' );
	if ( ! empty( $args['origin_key'] ) ) {
		update_post_meta( $id, '_origin_key', $args['origin_key'] );
	}
	return $id;
}

/** 2a) WordPress Posts/Pages */
add_action(
	'post_updated',
	function ( $post_ID, $post_after, $post_before ) {
		// limit to public post types (exclude our CPT & ld types)
		$ptype = get_post_type( $post_ID );
		if ( in_array( $ptype, array( 'jrj_announcement', 'revision', 'attachment', 'sfwd-courses' ), true ) ) {
			return;
		}

		if ( 'publish' !== $post_after->post_status ) {
			return;
		}

		$origin = "post:$post_ID:" . $post_after->post_modified_gmt;
		if ( jrj_ann_debounce_exists( $origin ) ) {
			return;
		}

		jrj_ann_create(
			array(
				'title'      => 'Post updated: ' . get_the_title( $post_ID ),
				'content'    => '',
				'type'       => 'post_update',
				'source'     => 'auto',
				'link_url'   => get_permalink( $post_ID ),
				'origin_key' => $origin,
				'expires_at' => '', // optional
			)
		);
	},
	10,
	3
);

/** 2b) LearnDash Course publish/update */
add_action(
	'save_post_sfwd-courses',
	function ( $post_ID, $post, $update ) {
		if ( 'publish' !== get_post_status( $post_ID ) ) {
			return;
		}

		$origin = "course:$post_ID:" . get_post_modified_time( 'U', true, $post_ID );
		if ( jrj_ann_debounce_exists( $origin ) ) {
			return;
		}

		jrj_ann_create(
			array(
				'title'      => ( $update ? 'Course updated: ' : 'New course: ' ) . get_the_title( $post_ID ),
				'type'       => 'new_course',
				'source'     => 'auto',
				'link_url'   => get_permalink( $post_ID ),
				'origin_key' => $origin,
			)
		);
	},
	10,
	3
);

/**
 * Runs daily (see earlier jamrock_check_expirations cron).
 * Creates a global announcement when many users are close to cert expiry for a course.
 */
add_action(
	'jamrock_check_expirations',
	function () {
		// Tune these thresholds.
		$days_window    = 7;  // look-ahead window
		$min_user_count = 5; // fire announcement if >= this many users expiring

		// 1) Get all LD course IDs that issue certificates (adjust if you track differently).
		$courses = get_posts(
			array(
				'post_type'      => 'sfwd-courses',
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				'fields'         => 'ids',
			)
		);

		if ( empty( $courses ) ) {
			return;
		}

		$cutoff_start = ( new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) ) )->format( 'Y-m-d' );
		$cutoff_end   = ( new DateTimeImmutable( "+{$days_window} days", new DateTimeZone( 'UTC' ) ) )->format( 'Y-m-d' );

		foreach ( $courses as $course_id ) {
			global $wpdb;
			// We stored expiry as user meta: _jamrock_cert_expiry_{course_id} = 'YYYY-MM-DD'
			$meta_key = '_jamrock_cert_expiry_' . (int) $course_id;

			// Count users expiring within window.
			$sql            = $wpdb->prepare(
				"SELECT COUNT(um.user_id)
               FROM {$wpdb->usermeta} um
              WHERE um.meta_key = %s
                AND um.meta_value >= %s
                AND um.meta_value <= %s",
				$meta_key,
				$cutoff_start,
				$cutoff_end
			);
			$expiring_count = (int) $wpdb->get_var( $sql );

			if ( $expiring_count >= $min_user_count ) {
				// Debounce so we don't recreate daily for same window.
				$origin = "expiry_notice:course:$course_id:$cutoff_end";
				if ( function_exists( 'jrj_ann_debounce_exists' ) && jrj_ann_debounce_exists( $origin ) ) {
					continue;
				}

				$title = sprintf(
					'Reminder: %s certifications expiring soon',
					get_the_title( $course_id ) ?: 'Course'
				);

				if ( function_exists( 'jrj_ann_create' ) ) {
						jrj_ann_create(
							array(
								'title'      => $title,
								'type'       => 'expiry',
								'source'     => 'auto',
								'link_url'   => get_permalink( $course_id ),
								'origin_key' => $origin,
								// Soft expire the announcement when the window passes
								'expires_at' => $cutoff_end . ' 23:59:59',
								// Optionally pin if it’s critical
								'pinned'     => false,
							)
						);
				}
			}
		}
	}
);
