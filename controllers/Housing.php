<?php
/**
 * Housing controller (CRUD + toggle + validate)
 */
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class Housing {


	public function hooks(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	public function routes(): void {
		register_rest_route(
			'jamrock/v1',
			'/housing',
			array(
				'methods'             => 'GET',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
				'callback'            => array( $this, 'list' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing',
			array(
				'methods'             => 'POST',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
				'callback'            => array( $this, 'create' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing/(?P<id>\d+)',
			array(
				'methods'             => 'POST',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
				'callback'            => array( $this, 'update' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing/(?P<id>\d+)',
			array(
				'methods'             => 'DELETE',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
				'callback'            => array( $this, 'delete' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing/(?P<id>\d+)/toggle',
			array(
				'methods'             => 'POST',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
				'callback'            => array( $this, 'toggle_visibility' ),
			)
		);

		register_rest_route(
			'jamrock/v1',
			'/housing/(?P<id>\d+)/check',
			array(
				'methods'             => 'POST',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
				'callback'            => array( $this, 'check_url' ),
			)
		);
	}

	public function list( \WP_REST_Request $req ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_housing_links';

		$page   = max( 1, (int) $req->get_param( 'page' ) );
		$per    = min( 100, max( 1, (int) ( $req->get_param( 'per_page' ) ?: 10 ) ) );
		$offset = ( $page - 1 ) * $per;

		$visibility = sanitize_text_field( (string) $req->get_param( 'visibility' ) );
		$category   = sanitize_text_field( (string) $req->get_param( 'category' ) );
		$search     = sanitize_text_field( (string) $req->get_param( 'q' ) );

		$where  = array( '1=1' );
		$params = array();

		if ( $visibility !== '' ) {
			$where[]  = 'visibility_status = %s';
			$params[] = $visibility;
		}
		if ( $category !== '' ) {
			$where[]  = 'category = %s';
			$params[] = $category;
		}
		if ( $search !== '' ) {
			$where[]  = '(title LIKE %s OR url LIKE %s)';
			$params[] = '%' . $wpdb->esc_like( $search ) . '%';
			$params[] = '%' . $wpdb->esc_like( $search ) . '%';
		}

		$where_sql = implode( ' AND ', $where );
		$sql_total = $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE $where_sql", $params );
		$total     = (int) $wpdb->get_var( $sql_total );

		$sql_rows = $wpdb->prepare(
			"SELECT id, title, url, category, visibility_status, sort_order, http_status, last_checked, updated_at
			 FROM $t
			 WHERE $where_sql
			 ORDER BY sort_order ASC, id DESC
			 LIMIT %d OFFSET %d",
			array_merge( $params, array( $per, $offset ) )
		);
		$rows     = $wpdb->get_results( $sql_rows, ARRAY_A ) ?: array();

		return rest_ensure_response(
			array(
				'items'    => $rows,
				'total'    => $total,
				'page'     => $page,
				'per_page' => $per,
			)
		);
	}

	public function create( \WP_REST_Request $req ) {
		global $wpdb;
		$t = $wpdb->prefix . 'jamrock_housing_links';
		$b = $req->get_json_params() ?: array();

		$title = sanitize_text_field( (string) ( $b['title'] ?? '' ) );
		$url   = esc_url_raw( (string) ( $b['url'] ?? '' ) );
		$cat   = sanitize_text_field( (string) ( $b['category'] ?? '' ) );
		$vis   = in_array( ( $b['visibility'] ?? 'public' ), array( 'public', 'private', 'hidden' ), true ) ? $b['visibility'] : 'public';
		$notes = wp_kses_post( (string) ( $b['notes'] ?? '' ) );
		$sort  = (int) ( $b['sort_order'] ?? 0 );

		if ( $title === '' || $url === '' ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'title_url_required',
				),
				400
			);
		}

		$ok = $wpdb->insert(
			$t,
			array(
				'title'             => $title,
				'url'               => $url,
				'category'          => ( $cat !== '' ? $cat : null ),
				'visibility_status' => $vis,
				'sort_order'        => $sort,
				'notes'             => ( $notes !== '' ? $notes : null ),
				'created_at'        => current_time( 'mysql' ),
				'updated_at'        => current_time( 'mysql' ),
			)
		);

		if ( $ok === false ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'db_error',
				),
				500
			);
		}
		return rest_ensure_response(
			array(
				'ok' => true,
				'id' => (int) $wpdb->insert_id,
			)
		);
	}

	public function update( \WP_REST_Request $req ) {
		global $wpdb;
		$t  = $wpdb->prefix . 'jamrock_housing_links';
		$id = (int) $req['id'];
		$b  = $req->get_json_params() ?: array();

		$row = $wpdb->get_row( $wpdb->prepare( "SELECT id FROM $t WHERE id=%d", $id ), ARRAY_A );
		if ( ! $row ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		$data = array();
		if ( isset( $b['title'] ) ) {
			$data['title'] = sanitize_text_field( (string) $b['title'] );
		}
		if ( isset( $b['url'] ) ) {
			$data['url'] = esc_url_raw( (string) $b['url'] );
		}
		if ( isset( $b['category'] ) ) {
			$data['category'] = sanitize_text_field( (string) $b['category'] ) ?: null;
		}
		if ( isset( $b['visibility'] ) ) {
			$v = (string) $b['visibility'];
			if ( in_array( $v, array( 'public', 'private', 'hidden' ), true ) ) {
				$data['visibility_status'] = $v;
			}
		}
		if ( isset( $b['notes'] ) ) {
			$data['notes'] = wp_kses_post( (string) $b['notes'] ) ?: null;
		}
		if ( isset( $b['sort_order'] ) ) {
			$data['sort_order'] = (int) $b['sort_order'];
		}

		if ( empty( $data ) ) {
			return rest_ensure_response( array( 'ok' => true ) ); // nothing to update
		}

		$data['updated_at'] = current_time( 'mysql' );
		$ok                 = $wpdb->update( $t, $data, array( 'id' => $id ) );
		if ( $ok === false ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'db_error',
				),
				500
			);
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	public function delete( \WP_REST_Request $req ) {
		global $wpdb;
		$t  = $wpdb->prefix . 'jamrock_housing_links';
		$id = (int) $req['id'];
		$ok = $wpdb->delete( $t, array( 'id' => $id ) );
		if ( $ok === false ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'db_error',
				),
				500
			);
		}
		return rest_ensure_response( array( 'ok' => true ) );
	}

	public function toggle_visibility( \WP_REST_Request $req ) {
		global $wpdb;
		$t  = $wpdb->prefix . 'jamrock_housing_links';
		$id = (int) $req['id'];

		$row = $wpdb->get_row( $wpdb->prepare( "SELECT visibility_status FROM $t WHERE id=%d", $id ), ARRAY_A );
		if ( ! $row ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		$next = $row['visibility_status'] === 'public' ? 'hidden' : 'public';
		$ok   = $wpdb->update(
			$t,
			array(
				'visibility_status' => $next,
				'updated_at'        => current_time( 'mysql' ),
			),
			array( 'id' => $id )
		);
		if ( $ok === false ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'db_error',
				),
				500
			);
		}

		return rest_ensure_response(
			array(
				'ok'         => true,
				'visibility' => $next,
			)
		);
	}

	public function check_url( \WP_REST_Request $req ) {
		global $wpdb;
		$t  = $wpdb->prefix . 'jamrock_housing_links';
		$id = (int) $req['id'];

		$row = $wpdb->get_row( $wpdb->prepare( "SELECT url FROM $t WHERE id=%d", $id ), ARRAY_A );
		if ( ! $row ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'not_found',
				),
				404
			);
		}

		$url = esc_url_raw( (string) $row['url'] );
		if ( $url === '' ) {
			return new \WP_REST_Response(
				array(
					'ok'    => false,
					'error' => 'no_url',
				),
				400
			);
		}

		$r = wp_remote_head( $url, array( 'timeout' => 8 ) );
		if ( is_wp_error( $r ) || (int) wp_remote_retrieve_response_code( $r ) === 405 ) {
			$r = wp_remote_get(
				$url,
				array(
					'timeout'     => 8,
					'redirection' => 3,
				)
			);
		}
		$code = is_wp_error( $r ) ? 0 : (int) wp_remote_retrieve_response_code( $r );

		$wpdb->update(
			$t,
			array(
				'http_status'  => $code ?: null,
				'last_checked' => current_time( 'mysql' ),
				'updated_at'   => current_time( 'mysql' ),
			),
			array( 'id' => $id )
		);

		return rest_ensure_response(
			array(
				'ok'          => true,
				'http_status' => $code ?: null,
			)
		);
	}
}
