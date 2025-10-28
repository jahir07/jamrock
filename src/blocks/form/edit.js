/**
 * Retrieves the translation of text.
 */
import { __ } from '@wordpress/i18n';

/**
 * React hook that is used to mark the block wrapper element.
 */
import { useBlockProps } from '@wordpress/block-editor';

/**
 * Editor styles for the block.
 */
import './editor.scss';

export default function Edit() {
	return (
		<div { ...useBlockProps() }>
			<div className="jamrock-feedback-section">
				<div className="container">
					<h2 className="my-5 mt-0">
						{ __( 'Submit your feedback', 'jamrock' ) }
					</h2>

					<div className="feedback-area">
						<form action="" className="feedback-form" method="POST">
							<div className="form-group mb-4">
								<label htmlFor="inputFirstName">
									{ __( 'First Name', 'jamrock' ) }
								</label>
								<input
									name="first_name"
									type="text"
									className="form-control rounded-0 inputFirstName"
									placeholder={ __(
										'First Name',
										'jamrock'
									) }
									defaultValue=""
									required
								/>
								<div className="alert-msg text-danger" />
							</div>

							<div className="form-group mb-4">
								<label htmlFor="inputLastName">
									{ __( 'Last Name', 'jamrock' ) }
								</label>
								<input
									name="last_name"
									type="text"
									className="form-control rounded-0 inputLastName"
									placeholder={ __( 'Last Name', 'jamrock' ) }
									defaultValue=""
									required
								/>
								<div className="alert-msg text-danger" />
							</div>

							<div className="form-group mb-4">
								<label htmlFor="inputEmail">
									{ __( 'Email', 'jamrock' ) }
								</label>
								<input
									name="email"
									type="email"
									className="form-control rounded-0 inputEmail"
									placeholder={ __( 'Email', 'jamrock' ) }
									defaultValue=""
								/>
								<div className="alert-msg text-danger" />
							</div>

							<div className="form-group mb-4">
								<label htmlFor="inputSubject">
									{ __( 'Subject', 'jamrock' ) }
								</label>
								<input
									name="subject"
									type="text"
									className="form-control rounded-0 inputSubject"
									placeholder={ __( 'Subject', 'jamrock' ) }
									defaultValue=""
								/>
								<div className="alert-msg text-danger" />
							</div>

							<div className="form-group mb-4">
								<label htmlFor="inputMessage">
									{ __( 'Message', 'jamrock' ) }
								</label>
								<textarea
									name="message"
									className="form-control rounded-0 inputMessage"
									placeholder={ __(
										'Write Your Message',
										'jamrock'
									) }
									defaultValue=""
								/>
								<div className="alert-msg text-danger" />
							</div>

							<button
								type="button"
								className="action-btn btn btn-success rounded-0 text-white"
							>
								{ __( 'Submit', 'jamrock' ) }
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
}
