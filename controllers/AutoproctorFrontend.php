<?php
namespace Jamrock\Controllers;

defined( 'ABSPATH' ) || exit;

class AutoproctorFrontend {

	public function hooks(): void {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ), 20 );
		add_filter( 'the_content', array( $this, 'inject_container' ), 20 );
	}

	public function enqueue(): void {
		if ( ! is_user_logged_in() ) {
			return;
		}

		$quiz_id = is_singular( 'sfwd-quiz' ) ? get_the_ID() : 0;
		if ( ! $quiz_id ) {
			return;
		}

		// Settings
		$client_id = (string) get_option( 'jrj_autoproctor_api_id', '' );
		$secret    = (string) get_option( 'jrj_autoproctor_api_key', '' );
		if ( $client_id === '' || $secret === '' ) {
			return;
		}

		// Map your meta box → proctoringOptions.trackingOptions
		$enabled = (bool) get_post_meta( $quiz_id, '_jrj_proctor_enabled', true );
		$over    = (array) get_post_meta( $quiz_id, '_jrj_proctor_overrides', true );
		if ( $over ) {
			$camera = isset( $over['camera'] ) ? (bool) $over['camera'] : false;
			$mic    = isset( $over['mic'] ) ? (bool) $over['mic'] : false;
			$screen = isset( $over['screen'] ) ? (bool) $over['screen'] : false;
			$record = isset( $over['record'] ) ? (bool) $over['record'] : false;
		}
		$opts = array(
			'trackingOptions' => array(
				'audio'                 => $mic,
				'numHumans'             => true,
				'tabSwitch'             => true,
				'photosAtRandom'        => $camera,
				'detectMultipleScreens' => $screen,
				'forceFullScreen'       => false,
				'auxiliaryDevice'       => false,
				'recordSession'         => $record,
			),
			'showHowToVideo'  => false,
			'userDetails'     => array(
				'name'  => wp_get_current_user()->display_name,
				'email' => wp_get_current_user()->user_email,
			),
		);

		// Enqueue vendor scripts
		wp_enqueue_script( 'crypto-js', 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js', array(), '4.1.1', true );
		wp_enqueue_script( 'ap-entry', 'https://cdn.autoproctor.co/ap-entry.js', array( 'crypto-js' ), null, true );

		// Your frontend driver
		wp_enqueue_script( 'jrj-ap-frontend', JRJ_ASSETS . '/js/autoproctor.js', array( 'ap-entry' ), '1.0.0', true );

		$user_id = get_current_user_id();
		$quiz_id = get_the_ID();

		// Generate short alphanumeric id under 40 chars.
		$random        = substr( md5( uniqid( '', true ) ), 0, 10 );
		$testAttemptId = sprintf( 'U%dQ%d%s', $user_id, $quiz_id, $random );

		// Generate raw HMAC-SHA256
		$raw = hash_hmac( 'sha256', $testAttemptId, $secret, true );

		// Encode in Base64 (AutoProctor expects Base64, not hex)
		$hashedTestAttemptId = base64_encode( $raw );

		wp_localize_script(
			'jrj-ap-frontend',
			'JRJ_AP',
			array(
				'enabled'             => $enabled,
				'quizId'              => get_the_ID(),
				'userId'              => get_current_user_id(),
				'email'               => wp_get_current_user()->user_email,
				'clientId'            => $client_id,
				'secret'              => $secret,
				'testAttemptId'       => $quiz_id,
				'hashedTestAttemptId' => $hashedTestAttemptId,
				'autoStart'           => false,
				'opts'                => $opts,
				'root'                => esc_url_raw( rest_url( 'jamrock/v1/' ) ),
				'nonce'               => wp_create_nonce( 'wp_rest' ),
			)
		);
	}

	public function inject_container( string $content ): string {
		if ( ! is_singular( 'sfwd-quiz' ) ) {
			return $content;
		}

		// Lightweight container (hidden toolbar; we’ll auto start/stop)
		$html = '
    <div id="ap-test-proctoring-status"></div>
    ';

		return $content . $html;
	}
}
