import { registerBlockType } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import metadata from './block.json';

/**
 * Registering our block in JavaScript
 */
registerBlockType( metadata.name, {
	title: __( 'Feedback Result', 'jamrock' ),
	description: __( 'Result Display', 'jamrock' ),
	category: 'design',

	keywords: [ 'form', 'result' ],

	category: 'design',
	icon: 'star-filled',
	edit: () => {
		return <ServerSideRender block={ metadata.name } />;
	},
} );
