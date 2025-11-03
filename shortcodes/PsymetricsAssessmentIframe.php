<?php
/**
 * Assessment iFrame Shortcode + GF confirmation redirect + Polling endpoint.
 *
 * @package Jamrock
 * @since   1.0.0
 */

namespace Jamrock\Shortcodes;

defined( 'ABSPATH' ) || exit;

/**
 * Renders [jamrock_assessment_iframe] and wires GF confirmation to /assessment?entry=ID.
 *
 * Usage:
 *  - Create a WordPress page at /assessment and put the shortcode [jamrock_assessment_iframe] in its content.
 *  - Ensure GF Apply form ID saved in option jrj_form_id and Psymetrics secret in jrj_api_key.
 */
class PsymetricsAssessmentIframe {


	/**
	 * Boot hook.
	 */
	public static function register(): void {
		add_shortcode( 'jamrock_assessment_iframe', array( __CLASS__, 'render' ) ); // test
	}

	public static function render( $atts ): string {
		unset( $atts ); // Unused.

		wp_enqueue_style( 'jamrock-frontend' );

		if ( ! function_exists( 'gform_get_meta' ) ) {
			return '<div class="notice notice-warning">Gravity Forms is required.</div>';
		}

		// Read entry & token from URL.
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$entry_id = isset( $_GET['entry'] ) ? absint( $_GET['entry'] ) : 0;
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$token = isset( $_GET['token'] ) ? sanitize_text_field( (string) $_GET['token'] ) : '';

		if ( ! $entry_id || $token === '' ) {
			$apply_now     = (string) get_option( 'jrj_set_login_page', '' );
			$apply_now_url = home_url( $apply_now );

			// Use safe WordPress redirect
			wp_safe_redirect( $apply_now_url );
			exit; // Always exit after redirect.
		}

		// If URL already on entry, render immediately.
		$candidate_url = (string) gform_get_meta( $entry_id, 'psymetrics_candidate_url' );

		// Build REST endpoints with token (public, token-checked).
		$get_endpoint  = esc_url_raw(
			add_query_arg(
				array( 'token' => rawurlencode( $token ) ),
				rest_url( 'jamrock/v1/entry/' . $entry_id . '/psymetrics-url' )
			)
		);
		$post_endpoint = esc_url_raw(
			add_query_arg(
				array( 'token' => rawurlencode( $token ) ),
				rest_url( 'jamrock/v1/entry/' . $entry_id . '/psymetrics-register' )
			)
		);

		ob_start();
		?>
		<div class="jrj-step" id="jrj-step2-root">
			<div class="jrj-breadcrumb">Step 2 of 4 — Assessment.</div>

			<?php if ( $candidate_url ) : ?>
				<p class="jrj-note">If the test does not load, <br /><a class="jrj-btn" href="<?php echo esc_url( $candidate_url ); ?>"
						target="_blank" rel="noopener">open in a new tab</a>.</p>
				<div id="jrj-iframe-wrap" class="loading">
					<div class="loader">Loading…</div>
					<iframe class="jrj-psym" id="jrj-psymetrics" src="<?php echo esc_url( $candidate_url ); ?>"
						allow="camera *; microphone *; geolocation *" referrerpolicy="no-referrer"></iframe>
				</div>
				<script>
					(function () {
						const wrap = document.getElementById('jrj-iframe-wrap');
						const iframe = document.getElementById('jrj-psymetrics');
						iframe.addEventListener('load', () => wrap.classList.remove('loading'));
						if (window.dataLayer) window.dataLayer.push({ event: 'assessment_iframe_loaded', entry: <?php echo (int) $entry_id; ?> });
						if (typeof gtag === 'function') gtag('event', 'assessment_iframe_loaded', { entry: <?php echo (int) $entry_id; ?> });
					})();
				</script>
			<?php else : ?>
				<div class="jrj-err" id="jrj-step2-msg" style="display:none"></div>
				<div class="jrj-note">Preparing your assessment… If it doesn’t appear automatically, a button will let you open it
					in a new tab.</div>
				<div id="jrj-iframe-wrap" class="loading" style="display:none">
					<div class="loader">Loading…</div>
					<iframe class="jrj-psym" id="jrj-psymetrics" src="" allow="camera *; microphone *; geolocation *"
						referrerpolicy="no-referrer"></iframe>
				</div>
				<script>
					(function () {
						const root = document.getElementById('jrj-step2-root');
						const msg = document.getElementById('jrj-step2-msg');
						const wrap = document.getElementById('jrj-iframe-wrap');
						const iframe = document.getElementById('jrj-psymetrics');
						const GET_URL = <?php echo wp_json_encode( $get_endpoint ); ?>;
						const POST_URL = <?php echo wp_json_encode( $post_endpoint ); ?>;

						let triedRegister = false;
						let tries = 0, maxTries = 12;

						function mount(url) {
							wrap.style.display = 'block';
							iframe.src = url;
							iframe.addEventListener('load', () => wrap.classList.remove('loading'));
							// Analytics.
							if (window.dataLayer) window.dataLayer.push({ event: 'assessment_iframe_loaded', entry: <?php echo (int) $entry_id; ?> });
							if (typeof gtag === 'function') gtag('event', 'assessment_iframe_loaded', { entry: <?php echo (int) $entry_id; ?> });
							// Visible helper link.
							const p = document.createElement('p');
							p.className = 'jrj-note';
							p.innerHTML = 'If the test does not load, <a class="jrj-btn" href="' + url + '" target="_blank" rel="noopener">open in a new tab</a>.';
							root.insertBefore(p, wrap);
						}

						async function pollOnce() {
							const res = await fetch(GET_URL);
							if (!res.ok) throw new Error('HTTP ' + res.status);
							const data = await res.json();
							return (data && data.url) ? data.url : '';
						}

						async function tryRegister() {
							// POST to create/register on-demand (token-authorized).
							const res = await fetch(POST_URL, { method: 'POST' });
							if (!res.ok) throw new Error('HTTP ' + res.status);
							const data = await res.json();
							return (data && data.url) ? data.url : '';
						}

						async function tick() {
							tries++;
							try {
								// 1) Poll GET for url.
								let url = await pollOnce();
								if (url) { mount(url); return; }

								// 2) If not found and we haven't tried registering yet → POST.
								if (!triedRegister) {
									triedRegister = true;
									url = await tryRegister();
									if (url) { mount(url); return; }
								}
							} catch (e) { /* swallow & retry */ }

							if (tries < maxTries) {
								setTimeout(tick, 1000);
							} else {
								msg.style.display = 'block';
								msg.textContent = 'We couldn’t load the test automatically. Please check your email link.';
							}
						}

						// Analytics: submit-success marker if you want
						if (window.dataLayer) window.dataLayer.push({ event: 'assessment_submit_success', entry: <?php echo (int) $entry_id; ?> });
						if (typeof gtag === 'function') gtag('event', 'assessment_submit_success', { entry: <?php echo (int) $entry_id; ?> });

						tick();

						// Optional postMessage: if provider notifies completion
						window.addEventListener('message', function (ev) {
							try {
								const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
								if (data && data.type === 'psymetrics.completed') {
									window.location.href = <?php echo wp_json_encode( home_url( '/step-3/' ) ); ?>;
								}
							} catch (e) { }
						}, false);
					})();
				</script>
			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}
}