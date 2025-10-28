/**
 * Registers a new block provided a unique name and an object defining its behavior.
 */
import { registerBlockType } from '@wordpress/blocks';

import './editor.scss';

/**
 * Internal dependencies
 */
import metadata from './block.json';
import ServerSideRender from '@wordpress/server-side-render';

import { __ } from '@wordpress/i18n';

const { useSelect } = wp.data;

/**
 * Every block starts by registering a new block type definition.
 */
registerBlockType( metadata.name, {
	title: __( 'Feedback Form' ),
	category: 'design',

	keywords: [ __( 'form' ), __( 'feedback' ) ],

	/**
	 * @see ./edit.js
	 */
	// edit: Edit,
	edit: () => {
		return (
			<div>
				<ServerSideRender block={ metadata.name } />
			</div>
		);
	},
} );
