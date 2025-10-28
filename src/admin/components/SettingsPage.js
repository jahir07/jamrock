/* global JRJ_ADMIN */
import { reactive, onMounted, nextTick } from 'vue/dist/vue.esm-bundler.js';

export default {
	name: 'SettingsPage',
	setup() {
		const settings = reactive( {
			form_id: '',
			api_key: '',
			callback_ok: '',
		} );

		// simple status string; render in template
		const ui = reactive( {
			notice: '',
			saving: false,
			loading: false,
		} );

		const load = async () => {
			ui.loading = true;
			try {
				const res = await fetch( JRJ_ADMIN.root + "settings", {
					headers: { 'X-WP-Nonce': JRJ_ADMIN.nonce },
					cache: 'no-store',
				} );
				const data = await res.json();

				// explicit assignments (reactivity-safe)
				settings.form_id = data.form_id ?? '';
				settings.api_key = data.api_key ?? '';
				settings.callback_ok = data.callback_ok ?? '';

				ui.notice = '';
				await nextTick();
			} catch ( err ) {
				ui.notice = 'Failed to load settings.';
			} finally {
				ui.loading = false;
			}
		};

		const save = async () => {
			ui.saving = true;
			ui.notice = '';
			try {
				const res = await fetch( JRJ_ADMIN.root + 'settings', {
					method: 'POST',
					headers: {
						'X-WP-Nonce': JRJ_ADMIN.nonce,
						'Content-Type': 'application/json',
						'Cache-Control': 'no-store',
					},
					body: JSON.stringify( {
						form_id: Number( settings.form_id ) || 0, // keep type stable
						api_key: settings.api_key || '',
						callback_ok: settings.callback_ok || '',
					} ),
				} );

				if ( ! res.ok ) {
					// try to surface API error text if available
					let msg = 'Save failed.';
					try {
						const j = await res.json();
						if ( j && j.message ) msg = j.message;
					} catch ( _ ) {}
					ui.notice = msg;
					return;
				}

				ui.notice = 'Settings saved.';
			} catch ( err ) {
				ui.notice = 'Network error while saving.';
				// optionally log: console.error(err);
			} finally {
				ui.saving = false;
			}
		};

		onMounted( load );
		return { settings, ui, save };
	},
	template: `
    <div class="jrj-card">
      <h2>Settings</h2>
	  <p v-if="ui.notice">{{ ui.notice }}</p>
      <form @submit.prevent="save">
        <table class="form-table"><tbody>
          <tr>
            <th><label>Gravity Form ID</label></th>
            <td><input type="number" v-model.number="settings.form_id" /></td>
          </tr>
          <tr>
            <th><label>Psymetrics API Key</label></th>
            <td><input type="text" v-model="settings.api_key" /></td>
          </tr>
          <tr>
            <th><label>Callback URL</label></th>
            <td><input type="url" v-model="settings.callback_ok" placeholder="https://..." /></td>
          </tr>
        </tbody></table>
        <p><button type="submit" :disabled="ui.saving" class="button button-primary">Save Settings</button></p>
      </form>
    </div>
  `,
};
