/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useBlockProps } from '@wordpress/block-editor';

const Save = () => {
	return (
		<div { ...useBlockProps.save() }>
			<div className="jamrock-feedback-section">
				<div className="container">
					<h2 className="my-5 mt-0">
						{ __( 'Submit your feedback', 'jamrock' ) }
					</h2>
					<div className="feedback-area">
						<form action className="feedback-form" method="POST">
							<div className="form-group mb-4">
								<label htmlFor="inputFirstName">
									First Name
								</label>
								<input
									name="first_name"
									type="text"
									className="form-control rounded-0 inputFirstName"
									placeholder="First Name"
									defaultValue=""
									required
								/>
								<div className="alert-msg text-danger" />
							</div>
							<div className="form-group mb-4">
								<label htmlFor="inputLastName">Last Name</label>
								<input
									name="last_name"
									type="text"
									className="form-control rounded-0 inputLastName"
									placeholder="Last Name"
									defaultValue=""
									required
								/>
								<div className="alert-msg text-danger" />
							</div>
							<div className="form-group mb-4">
								<label htmlFor="inputEmail">Email</label>
								<input
									name="email"
									type="email"
									className="form-control rounded-0 inputEmail"
									placeholder="Email"
									defaultValue=""
								/>
								<div className="alert-msg text-danger" />
							</div>
							<div className="form-group mb-4">
								<label htmlFor="inputSubject">Subject</label>
								<input
									name="subject"
									type="text"
									className="form-control rounded-0 inputSubject"
									placeholder="Subject"
								/>
								<div className="alert-msg text-danger" />
							</div>
							<div className="form-group mb-4">
								<label htmlFor="inputMessage">Message</label>
								<textarea
									name="message"
									className="form-control rounded-0 inputMessage"
									placeholder="Write Your Message"
									defaultValue={ '' }
								/>
								<div className="alert-msg text-danger" />
							</div>
							{ /*?php wp_nonce_field( 'feedback_nonce_validation', 'feedback_nonce' ); ?*/ }
							<button
								type="button"
								className="action-btn btn btn-success rounded-0 text-white"
							>
								Submit
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
};
export default Save;
