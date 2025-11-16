<?php
/**
 * Custom Post Type: Announcements
 *
 * @package Jamrock
 * @since   1.0.0
 */
add_action(
	'init',
	function () {
		register_post_type(
			'jrj_announcement',
			array(
				'label'        => 'Announcements',
				'public'       => false,
				'show_ui'      => true,
				'show_in_menu' => false,
				// 'show_in_menu'  => 'wp-jamrock',
				'supports'     => array( 'title', 'editor' ),
				// 'menu_icon'     => 'dashicons-megaphone',
				// 'menu_position' => 57,
			)
		);

		// type: new_course | policy | ai_update | general | post_update
		register_post_meta(
			'jrj_announcement',
			'type',
			array(
				'type'          => 'string',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => '__return_true',
			)
		);
		// source: auto | manual
		register_post_meta(
			'jrj_announcement',
			'source',
			array(
				'type'          => 'string',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => '__return_true',
			)
		);
		// link to detail page/course/etc.
		register_post_meta(
			'jrj_announcement',
			'link_url',
			array(
				'type'          => 'string',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => '__return_true',
			)
		);
		// pin to top
		register_post_meta(
			'jrj_announcement',
			'pinned',
			array(
				'type'          => 'boolean',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => '__return_true',
				'default'       => false,
			)
		);
		// soft expiry
		register_post_meta(
			'jrj_announcement',
			'expires_at',
			array(
				'type'          => 'string',
				'single'        => true,
				'show_in_rest'  => true,
				'auth_callback' => '__return_true',
			)
		);
	}
);

add_action(
	'add_meta_boxes',
	function () {
		add_meta_box(
			'jrj_pin_box',
			'Announcement Settings',
			function ( $post ) {
				$pinned = (bool) get_post_meta( $post->ID, 'pinned', true );
				$link   = (string) get_post_meta( $post->ID, 'link_url', true );
				?>
				<p><label><input type="checkbox" name="jrj_pinned" <?php checked( $pinned ); ?> /> Pin this announcement</label></p>
				<p><label>Link URL<br><input type="url" name="jrj_link_url" value="<?php echo esc_attr( $link ); ?>" class="widefat" /></label></p>
				<?php
			},
			'jrj_announcement',
			'side'
		);
	}
);

add_action(
	'save_post_jrj_announcement',
	function ( $post_id ) {
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		update_post_meta( $post_id, 'pinned', isset( $_POST['jrj_pinned'] ) );
		if ( isset( $_POST['jrj_link_url'] ) ) {
			update_post_meta( $post_id, 'link_url', esc_url_raw( $_POST['jrj_link_url'] ) );
		}
	}
);