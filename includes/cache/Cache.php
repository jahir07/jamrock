<?php
/**
 * Cache class
 *
 * @package Jamrock
 * @since   1.0
 */

namespace Jamrock\Cache;

// Exit if accessed directly
if ( ! defined('ABSPATH') ) {
    exit;
}

class Cache {

    private static $redis   = null;
    private static $enabled = null;

    /**
     * Detect & init redis (phpredis only)
     */
    private static function init() {

        if ( self::$enabled !== null ) {
            return;
        }

        self::$enabled = false;

        // phpredis not available
        if ( ! class_exists( '\Redis' ) ) {
            return;
        }

        try {
            $r = new \Redis();
            $r->connect(
                defined( 'JAMROCK_REDIS_HOST' ) ? JAMROCK_REDIS_HOST : '127.0.0.1',
                defined( 'JAMROCK_REDIS_PORT' ) ? JAMROCK_REDIS_PORT : 6379,
                1
            );

            if ( defined( 'JAMROCK_REDIS_PASSWORD' ) && JAMROCK_REDIS_PASSWORD ) {
                $r->auth( JAMROCK_REDIS_PASSWORD );
            }

            self::$redis   = $r;
            self::$enabled = true;

        } catch ( \Throwable $e ) {
            // Redis exists but connection failed
            self::$enabled = false;
        }
    }

    /**
     * Get cached value
     */
    public static function get( $key ) {
        self::init();

        if ( self::$enabled ) {
            $value = self::$redis->get( $key );
            return $value !== false ? maybe_unserialize( $value ) : false;
        }

        return get_transient( $key );
    }

    /**
     * Set cache
     */
    public static function set( $key, $value, $ttl = 300 ) {
        self::init();

        if ( self::$enabled ) {
            return self::$redis->setex(
                $key,
                (int) $ttl,
                maybe_serialize( $value )
            );
        }

        return set_transient( $key, $value, $ttl );
    }

    /**
     * Delete cache
     */
    public static function delete( $key ) {
        self::init();

        if ( self::$enabled ) {
            return self::$redis->del( $key );
        }

        return delete_transient( $key );
    }

    /**
     * Helper for key prefixing
     */
    public static function key( $suffix ) {
        return 'jamrock:' . $suffix;
    }
}