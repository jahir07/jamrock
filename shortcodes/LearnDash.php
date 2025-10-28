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

/**
 * Class LearnDash
 */
class LearnDash {


	/**
	 * Register shortcodes on initialization.
	 */
	public function __construct() {
		// LearnDash dashboard shortcodes.
		add_shortcode( 'jamrock_learndash_dashboard', array( $this, 'learndash_dashboard' ) );
		add_shortcode( 'jamrock_learndash_overall_progress', array( $this, 'learndash_overall_progress' ) );
		add_shortcode( 'jamrock_learndash_cert_count', array( $this, 'learndash_cert_count' ) );
		add_shortcode( 'jamrock_learndash_courses_in_progress', array( $this, 'learndash_courses_in_progress' ) );
		add_shortcode( 'jamrock_learndash_last_active', array( $this, 'learndash_last_active' ) );
		add_shortcode( 'jamrock_learndash_course_grid', array( $this, 'learndash_course_grid' ) );
	}

	/** [jamrock_learndask_dashboard] */
	public function learndash_dashboard(): string {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return sprintf(
				'<div class="jrj-card">%s</div>',
				esc_html__( 'Please sign in to view your progress.', 'jamrock' )
			);
		}

		// Load css and js.
		wp_enqueue_style( 'jamrock-frontend' );
		wp_enqueue_script( 'jamrock-frontend' );

		$overall = (int) $this->get_overall_progress_pct( $user_id );
		$certs   = (int) $this->get_cert_count( $user_id );
		$in      = $this->get_in_progress_list( $user_id );
		$last    = $this->get_last_active_course( $user_id );

		ob_start();
		?>
		<div class="jrj-grid">
			<div class="jrj-card">
				<div class="jrj-row">
					<h3 class="m0"><?php echo esc_html__( 'Overall Progress', 'jamrock' ); ?></h3>
					<span class="jrj-tag"><?php echo esc_html__( 'Updated', 'jamrock' ); ?></span>
				</div>

				<div class="jrj-progress mt-10 mb-6">
					<?php
					$overall_style = sprintf( '--pct:%d%%;', $overall );
					?>
					<span style="<?php echo esc_attr( $overall_style ); ?>"></span>
				</div>

				<div class="jrj-muted">
					<?php
					/* translators: %1$d complete is the user's overall completion percentage. */
					echo esc_html(
						sprintf( __( '%1$d%% complete', 'jamrock' ), $overall )
					);
					?>
				</div>

				<div class="mt-12">
					<a class="jrj-btn jrj-btn-primary" href="<?php echo esc_url( $this->courses_url() ); ?>">
						<?php echo esc_html__( 'Continue Training', 'jamrock' ); ?>
					</a>
				</div>
			</div>

			<div class="jrj-card">
				<h3 class="m0 mb-6"><?php echo esc_html__( 'Certifications Earned', 'jamrock' ); ?></h3>
				<div class="jrj-muted">
					<?php
					/* translators: %1$d earned is the number of certificates earned. */
					echo esc_html(
						sprintf( __( '%1$d earned', 'jamrock' ), $certs )
					);
					?>
				</div>
				<div class="mt-12">
					<a class="jrj-btn" href="<?php echo esc_url( $this->certs_url() ); ?>">
						<?php echo esc_html__( 'View Tracker', 'jamrock' ); ?>
					</a>
				</div>
			</div>

			<div class="jrj-card">
				<h3 class="m0 mb-6"><?php echo esc_html__( 'Courses in Progress', 'jamrock' ); ?></h3>

				<?php if ( empty( $in ) ) : ?>
					<div class="jrj-muted"><?php echo esc_html__( 'No courses in progress', 'jamrock' ); ?></div>
				<?php else : ?>
					<ul class="jrj-list mt-10">
						<?php foreach ( $in as $row ) : ?>
							<li>
								<a href="<?php echo esc_url( get_permalink( (int) $row['id'] ) ); ?>">
									<?php echo esc_html( (string) $row['title'] ); ?>
								</a>
								<span class="jrj-muted">
									(<?php echo esc_html( number_format_i18n( (float) $row['pct'] ) ); ?>%)
								</span>
							</li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>

				<div class="mt-12">
					<a class="jrj-btn" href="<?php echo esc_url( $this->courses_url() ); ?>">
						<?php echo esc_html__( 'View All Courses', 'jamrock' ); ?>
					</a>
				</div>
			</div>

			<div class="jrj-card">
				<h3 class="m0 mb-6"><?php echo esc_html__( 'Last Active Course', 'jamrock' ); ?></h3>

				<?php if ( ! empty( $last ) ) : ?>
					<div class="jrj-muted mb-10">
						<?php echo esc_html( (string) $last['title'] ); ?>
					</div>
					<a class="jrj-btn jrj-btn-primary" href="<?php echo esc_url( get_permalink( (int) $last['id'] ) ); ?>">
						<?php echo esc_html__( 'View', 'jamrock' ); ?>
					</a>
				<?php else : ?>
					<div class="jrj-muted"><?php echo esc_html__( 'No recent activity', 'jamrock' ); ?></div>
				<?php endif; ?>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	/** [jamrock_learndask_overall_progress] */
	public function learndash_overall_progress(): string {
		$uid = get_current_user_id();
		return $uid ? (string) $this->get_overall_progress_pct( $uid ) : '';
	}

	/** [jamrock_learndask_cert_count] */
	public function learndash_cert_count(): string {
		$uid = get_current_user_id();
		return $uid ? (string) $this->get_cert_count( $uid ) : '0';
	}

	/** [jamrock_learndask_courses_in_progress] */
	public function learndash_courses_in_progress(): string {
		$uid = get_current_user_id();
		if ( ! $uid ) {
			return '';
		}
		$list = $this->get_in_progress_list( $uid );
		if ( empty( $list ) ) {
			return sprintf( '<span>%s</span>', esc_html__( 'No courses in progress', 'jamrock' ) );
		}

		$out = '<ul class="jrj-list-inprogress">';
		foreach ( $list as $row ) {
			$out .= sprintf(
				'<li><a href="%1$s">%2$s</a> <span class="jrj-muted">(%3$s%%)</span></li>',
				esc_url( get_permalink( (int) $row['id'] ) ),
				esc_html( (string) $row['title'] ),
				esc_html( number_format_i18n( (float) $row['pct'] ) )
			);
		}
		$out .= '</ul>';
		return $out;
	}

	/** [jamrock_learndask_last_active] */
	public function learndash_last_active(): string {
		$uid = get_current_user_id();
		if ( ! $uid ) {
			return '';
		}
		$last = $this->get_last_active_course( $uid );
		if ( ! $last ) {
			return sprintf( '<span>%s</span>', esc_html__( 'No recent activity', 'jamrock' ) );
		}

		$btn = sprintf(
			'<a class="jrj-btn jrj-btn-primary" href="%s">%s</a>',
			esc_url( get_permalink( (int) $last['id'] ) ),
			esc_html__( 'Resume', 'jamrock' )
		);
		return sprintf(
			'<span class="jrj-last-title">%1$s</span> %2$s',
			esc_html( (string) $last['title'] ),
			$btn
		);
	}

	/**
	 * Get enrolled courses for a user.
	 *
	 * @param int $user_id User ID to fetch enrolled courses for.
	 * @return int[] List of course IDs.
	 */
	private function get_enrolled_courses( int $user_id ): array {
		if ( function_exists( 'learndash_user_get_enrolled_courses' ) ) {
			$courses = learndash_user_get_enrolled_courses( $user_id, array( 'num' => -1 ) );
		} elseif ( function_exists( 'ld_get_mycourses' ) ) {
			$courses = ld_get_mycourses( $user_id );
		} else {
			$courses = array();
		}
		return is_array( $courses ) ? array_map( 'intval', $courses ) : array();
	}

	/**
	 * Summary course progress percentage for a user/course pair.
	 *
	 * @param int $user_id   User ID.
	 * @param int $course_id Course ID.
	 * @return float Percentage (0–100).
	 */
	private function get_course_progress_pct( int $user_id, int $course_id ): float {
		if ( function_exists( 'learndash_course_progress' ) ) {
			$p = learndash_course_progress(
				array(
					'user_id'   => $user_id,
					'course_id' => $course_id,
					'array'     => true,
				)
			);
			if ( is_array( $p ) ) {
				if ( isset( $p['percentage'] ) ) {
					return (float) $p['percentage'];
				}
				if ( isset( $p['completed'], $p['total'] ) && (int) $p['total'] > 0 ) {
					return round( ( (int) $p['completed'] / (int) $p['total'] ) * 100, 2 );
				}
			}
		}
		return 0.0;
	}

	/**
	 * Overall progress percentage across a user's enrolled courses.
	 *
	 * @param int $user_id User ID.
	 * @return float Percentage (0–100).
	 */
	private function get_overall_progress_pct( int $user_id ): float {
		$courses = $this->get_enrolled_courses( $user_id );
		if ( empty( $courses ) ) {
			return 0.0;
		}

		$sum = 0.0;
		foreach ( $courses as $cid ) {
			$sum += $this->get_course_progress_pct( $user_id, $cid );
		}
		return round( $sum / max( 1, count( $courses ) ), 0 );
	}

	/**
	 * Get certificate count for a user (cached).
	 *
	 * @param int $user_id User ID.
	 * @return int Certificate count.
	 */
	private function get_cert_count( int $user_id ): int {
		$cache_key = "jamrock_cert_count_{$user_id}";
		$cached    = wp_cache_get( $cache_key, 'jamrock' );
		if ( false !== $cached ) {
			return (int) $cached;
		}

		if ( function_exists( 'learndash_get_user_certificates' ) ) {
			$certs = \learndash_get_user_certificates( $user_id );
			$count = is_array( $certs ) ? count( $certs ) : 0;
			wp_cache_set( $cache_key, $count, 'jamrock', 5 * MINUTE_IN_SECONDS );
			return $count;
		}

		// Fallback: conservative count from usermeta when API not available.
		global $wpdb;
		$like = $wpdb->esc_like( 'certificates' ) . '%';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- No core helper available for this specific fallback query.
		$rows = $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery.NoCaching -- Cached above via wp_cache_*.
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->usermeta} WHERE user_id = %d AND meta_key LIKE %s",
				$user_id,
				$like
			)
		);

		$count = (int) $rows;
		wp_cache_set( $cache_key, $count, 'jamrock', 5 * MINUTE_IN_SECONDS );
		return $count;
	}

	/**
	 * In-progress courses for a user.
	 *
	 * @param int $user_id User ID.
	 * @return array[] List of arrays: { id, title, pct }.
	 */
	private function get_in_progress_list( int $user_id ): array {
		$out = array();
		foreach ( $this->get_enrolled_courses( $user_id ) as $cid ) {
			$pct = $this->get_course_progress_pct( $user_id, $cid );
			if ( $pct > 0 && $pct < 100 ) { // Only list courses that have started and are not completed.
				$out[] = array(
					'id'    => (int) $cid,
					'title' => get_the_title( $cid ),
					'pct'   => (float) $pct,
				);
			}
		}
		return $out;
	}

	/**
	 * Last active course (heuristic).
	 *
	 * @param int $user_id User ID.
	 * @return array|null Last active course data or null if none.
	 */
	private function get_last_active_course( int $user_id ): ?array {
		// Heuristic: the in-progress course with the highest progress.
		$in = $this->get_in_progress_list( $user_id );
		if ( ! empty( $in ) ) {
			usort(
				$in,
				static function ( $a, $b ) {
					return $b['pct'] <=> $a['pct'];
				}
			);
			return $in[0];
		}
		// Fallback: first enrolled course.
		$courses = $this->get_enrolled_courses( $user_id );
		if ( ! empty( $courses ) ) {
			$cid = (int) reset( $courses );
			return array(
				'id'    => $cid,
				'title' => get_the_title( $cid ),
				'pct'   => $this->get_course_progress_pct( $user_id, $cid ),
			);
		}
		return null;
	}

	/**
	 * Render the LearnDash course grid.
	 *
	 * @param array $atts Shortcode attributes.
	 * @return string HTML.
	 */
	public function learndash_course_grid( $atts = array() ): string {
		$atts = shortcode_atts(
			array(
				'posts_per_page' => 12,
				'show_all'       => 'yes', // yes = all courses; no = only enrolled for current user.
			),
			$atts,
			'jj_ld_course_grid'
		);

		wp_enqueue_style( 'jamrock-frontend' );
		wp_enqueue_script( 'jamrock-frontend' );

		$user_id = get_current_user_id();

		// Fetch courses.
		$courses = $this->get_courses( (int) $atts['posts_per_page'], 'yes' === $atts['show_all'] ? 0 : $user_id );

		// Precompute per-course data for current user.
		$items = array_map( fn( \WP_Post $p ) => $this->course_view_model( $p, $user_id ), $courses );

		ob_start();
		?>
		<div class="jrj-courses-block mt-10 mb-10">
			<div class="jrj-grid-controls" data-jrj-grid="controls">
				<div class="jrj-pills" role="tablist" aria-label="<?php echo esc_attr__( 'Course filters', 'jamrock' ); ?>">
					<button class="jrj-pill active" data-filter="all" role="tab"
						aria-selected="true"><?php echo esc_html__( 'All', 'jamrock' ); ?></button>
					<button class="jrj-pill" data-filter="required" role="tab"
						aria-selected="false"><?php echo esc_html__( 'Required', 'jamrock' ); ?></button>
					<button class="jrj-pill" data-filter="progress" role="tab"
						aria-selected="false"><?php echo esc_html__( 'In Progress', 'jamrock' ); ?></button>
					<button class="jrj-pill" data-filter="completed" role="tab"
						aria-selected="false"><?php echo esc_html__( 'Completed', 'jamrock' ); ?></button>
				</div>

				<label class="jrj-search" aria-label="<?php echo esc_attr__( 'Search courses', 'jamrock' ); ?>">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"
						stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
					</svg>
					<input type="search" placeholder="<?php echo esc_attr__( 'Search courses…', 'jamrock' ); ?>"
						data-jrj-grid="search" />
				</label>
			</div>

			<div class="jrj-grid" data-jrj-grid="list">
				<?php foreach ( $items as $it ) : ?>
					<article class="jrj-card" data-title="<?php echo esc_attr( $it['title_plain'] ); ?>"
						data-required="<?php echo esc_attr( $it['required'] ? '1' : '0' ); ?>"
						data-status="<?php echo esc_attr( $it['status'] ); ?>">
						<a href="<?php echo esc_url( $it['permalink'] ); ?>"
							aria-label="<?php echo esc_attr( $it['title_plain'] ); ?>">
							<?php
							// Provide the thumb via CSS var for clean SCSS control.
							$thumb_style = sprintf( '--thumb:url(%s);', "'" . esc_url( $it['thumb'] ) . "'" );
							?>
							<div class="jrj-thumb" style="<?php echo esc_attr( $thumb_style ); ?>"></div>
						</a>

						<div class="jrj-row">
							<h3 class="jrj-title">
								<a class="jrj-title__link" href="<?php echo esc_url( $it['permalink'] ); ?>">
									<?php echo esc_html( $it['title'] ); ?>
								</a>
							</h3>

							<?php if ( $it['required'] ) : ?>
								<span class="jrj-tag"><?php echo esc_html__( 'Required', 'jamrock' ); ?></span>
							<?php else : ?>
								<span class="jrj-tag"><?php echo esc_html__( 'Optional', 'jamrock' ); ?></span>
							<?php endif; ?>
						</div>

						<p class="jrj-desc"><?php echo esc_html( $it['desc'] ); ?></p>

						<?php $pct_style = sprintf( '--pct:%d%%;', (int) $it['percent'] ); ?>
						<div class="jrj-progress"><span style="<?php echo esc_attr( $pct_style ); ?>"></span></div>

						<div class="jrj-meta">
							<span><?php echo ! empty( $it['duration'] ) ? esc_html( $it['duration'] ) : '&#160;'; ?></span>
							<span>
								<?php
								echo ( (int) $it['percent'] >= 100 )
									? esc_html__( 'Completed', 'jamrock' )
									: esc_html( (int) $it['percent'] . '%' );
								?>
							</span>
						</div>
					</article>
				<?php endforeach; ?>
			</div>
		</div>

		<script>
			(function () {
				const root = document.currentScript.closest('.entry-content') || document;
				const list = root.querySelector('[data-jrj-grid="list"]');
				const pills = root.querySelectorAll('.jrj-pill');
				const search = root.querySelector('[data-jrj-grid="search"]');

				if (!list) { return; }

				let activeFilter = 'all';

				function applyFilters() {
					const q = (search?.value || '').trim().toLowerCase();
					list.querySelectorAll('.jrj-card').forEach(card => {
						const title = (card.dataset.title || '').toLowerCase();
						const isReq = card.dataset.required === '1';
						const st = card.dataset.status; // 'completed' | 'progress' | 'fresh'.

						let pass = true;

						if ('required' === activeFilter) { pass = isReq; }
						if ('progress' === activeFilter) { pass = st === 'progress'; }
						if ('completed' === activeFilter) { pass = st === 'completed'; }

						if (pass && q) { pass = title.includes(q); }

						card.classList.toggle('jrj-hidden', !pass);
					});
				}

				pills.forEach(btn => {
					btn.addEventListener('click', () => {
						pills.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
						btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
						activeFilter = btn.dataset.filter;
						applyFilters();
					});
				});

				search?.addEventListener('input', applyFilters);
			})();
		</script>
		<?php
		return ob_get_clean();
	}

	/**
	 * Get courses. If $only_user_id > 0, restrict to user-enrolled courses.
	 *
	 * @param int $ppp           Posts per page.
	 * @param int $only_user_id  User ID to restrict to (0 = no restriction).
	 * @return \WP_Post[] Array of posts.
	 */
	private function get_courses( int $ppp = 24, int $only_user_id = 0 ): array {
		$args = array(
			'post_type'      => 'sfwd-courses',
			'post_status'    => 'publish',
			'posts_per_page' => $ppp,
			'orderby'        => 'menu_order title',
			'order'          => 'ASC',
			'no_found_rows'  => true,
		);

		if ( $only_user_id > 0 && function_exists( 'learndash_user_get_enrolled_courses' ) ) {
			$ids              = learndash_user_get_enrolled_courses( $only_user_id, array( 'num' => -1 ) );
			$args['post__in'] = ( is_array( $ids ) && $ids ) ? array_map( 'intval', $ids ) : array( 0 );
		}

		$q = new \WP_Query( $args );
		return $q->have_posts() ? $q->posts : array();
	}

	/**
	 * Build a course card view-model for the current user.
	 *
	 * @param \WP_Post $p       Course post.
	 * @param int      $user_id Current user ID.
	 * @return array<string,mixed> View model.
	 */
	private function course_view_model( \WP_Post $p, int $user_id ): array {
		$cid   = (int) $p->ID;
		$title = get_the_title( $cid );

		if ( has_excerpt( $cid ) ) {
			$desc = get_the_excerpt( $cid );
		} else {
			$raw  = (string) get_post_field( 'post_content', $cid );
			$desc = wp_trim_words( wp_strip_all_tags( $raw ), 24 );
		}

		$thumb_url = get_the_post_thumbnail_url( $cid, 'medium' );
		if ( empty( $thumb_url ) ) {
			// Fallback tiny SVG if no thumbnail exists.
			$thumb_url = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width=\\"600\\" height=\\"400\\"></svg>';
		}

		$duration = get_post_meta( $cid, '_jj_duration', true ); // e.g. "~ 1h 20m" (optional).
		$required = $this->is_required_course( $cid );

		$percent = 0.0;
		$status  = 'fresh';

		if ( $user_id && function_exists( 'learndash_course_progress' ) ) {
			$progress = learndash_course_progress(
				array(
					'user_id'   => $user_id,
					'course_id' => $cid,
					'array'     => true,
				)
			);
			if ( is_array( $progress ) ) {
				if ( isset( $progress['percentage'] ) ) {
					$percent = (float) $progress['percentage'];
				} elseif ( isset( $progress['completed'], $progress['total'] ) && (int) $progress['total'] > 0 ) {
					$percent = round( ( (int) $progress['completed'] / (int) $progress['total'] ) * 100, 2 );
				}
			}
		}

		if ( $percent >= 100 ) {
			$status = 'completed';
		} elseif ( $percent > 0 ) {
			$status = 'progress';
		}

		return array(
			'id'          => $cid,
			'title'       => $title,
			'title_plain' => wp_strip_all_tags( $title ),
			'desc'        => $desc,
			'thumb'       => $thumb_url,
			'duration'    => $duration, // Show "~ 1h 20m" if present.
			'required'    => $required,
			'percent'     => $percent,
			'status'      => $status,
			'permalink'   => get_permalink( $cid ),
		);
	}

	/**
	 * Determine if a course is “Required”.
	 *
	 * Logic:
	 * - Meta `_jj_required` == '1'.
	 * - OR has term 'required' in 'ld_course_category' or default 'category'.
	 *
	 * @param int $course_id Course ID.
	 * @return bool Whether the course is required.
	 */
	private function is_required_course( int $course_id ): bool {
		$meta = get_post_meta( $course_id, '_jj_required', true );
		if ( '1' === $meta || 1 === $meta ) {
			return true;
		}

		$taxes = array( 'ld_course_category', 'category' );
		foreach ( $taxes as $tax ) {
			$terms = get_the_terms( $course_id, $tax );
			if ( is_array( $terms ) ) {
				foreach ( $terms as $t ) {
					if ( 'required' === strtolower( $t->slug ) || 'required' === strtolower( $t->name ) ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * Courses archive URL.
	 *
	 * @return string URL.
	 */
	private function courses_url(): string {
		// Adjust to your LearnDash courses archive URL.
		return home_url( '/courses/' );
	}

	/**
	 * Certifications page URL.
	 *
	 * @return string URL.
	 */
	private function certs_url(): string {
		// Adjust to your Certifications page URL.
		return home_url( '/certifications/' );
	}
}