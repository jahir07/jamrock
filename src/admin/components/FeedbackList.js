/* global JRJ_ADMIN */
import { ref, reactive, onMounted } from 'vue/dist/vue.esm-bundler.js';

const api = async ( path, { method = 'GET', body } = {} ) => {
	const res = await fetch( JRJ_ADMIN.root + path, {
		method,
		headers: {
			'X-WP-Nonce': JRJ_ADMIN.nonce,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify( body ) : undefined,
	} );
	if ( ! res.ok ) {
		throw new Error( ( await res.json() ).message || 'Request failed' );
	}
	return res.json();
};

const FeedbackList = {
	name: 'FeedbackList',
	setup() {
		const items = ref( [] );
		const total = ref( 0 );
		const page = ref( 1 );
		const perPage = ref( 10 );
		const loading = ref( false );
		const editing = reactive( {} );

		const load = async () => {
			loading.value = true;
			try {
				const data = await api(
					`feedback?page=${ page.value }&per_page=${ perPage.value }`
				);
				items.value = data.items || [];
				total.value = data.total || 0;
			} finally {
				loading.value = false;
			}
		};

		const editRow = ( row ) => {
			editing[ row.id ] = { subject: row.subject, message: row.message };
		};

		const saveRow = async ( row ) => {
			const payload = editing[ row.id ] || {};
			await api( `feedback/${ row.id }`, {
				method: 'POST',
				body: payload,
			} );
			delete editing[ row.id ];
			await load();
		};

		const deleteRow = async ( row ) => {
			if ( ! confirm( JRJ_ADMIN.i18n.areYouSure ) ) return;
			await api( `feedback/${ row.id }`, { method: 'DELETE' } );
			await load();
		};

		onMounted( load );

		return {
			items,
			total,
			page,
			perPage,
			loading,
			editing,
			load,
			editRow,
			saveRow,
			deleteRow,
		};
	},
	template: `
        <div class="jrj-card">
            <h2>All Feedback</h2>

            <div class="jrj-toolbar">
                <label>Per page:
                    <select v-model.number="perPage" @change="page=1; load()">
                        <option :value="10">10</option>
                        <option :value="20">20</option>
                        <option :value="50">50</option>
                    </select>
                </label>
            </div>

            <table class="jrj-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>First</th>
                        <th>Last</th>
                        <th>Email</th>
                        <th>Subject</th>
                        <th>Message</th>
                        <th style="width:140px;">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if="loading"><td colspan="7">Loading…</td></tr>
                    <tr v-for="row in items" :key="row.id">
                        <td>{{ row.id }}</td>
                        <td>{{ row.first_name }}</td>
                        <td>{{ row.last_name }}</td>
                        <td>{{ row.email }}</td>
                        <td>
                            <div v-if="!editing[row.id]">{{ row.subject }}</div>
                            <input v-else v-model="editing[row.id].subject" />
                        </td>
                        <td>
                            <div v-if="!editing[row.id]" class="ellipsis">{{ row.message }}</div>
                            <textarea v-else v-model="editing[row.id].message"></textarea>
                        </td>
                        <td>
                            <button v-if="!editing[row.id]" class="button button-small" @click="editRow(row)">Edit</button>
                            <button v-else class="button button-primary button-small" @click="saveRow(row)">Save</button>
                            <button class="button button-link-delete button-small" @click="deleteRow(row)">Delete</button>
                        </td>
                    </tr>
                    <tr v-if="!loading && items.length===0"><td colspan="7">No items found.</td></tr>
                </tbody>
            </table>

            <div class="jrj-pagination" v-if="total > perPage">
                <button class="button" :disabled="page===1" @click="page--; load()">«</button>
                <span>Page {{ page }}</span>
                <button class="button" :disabled="page * perPage >= total" @click="page++; load()">»</button>
            </div>
        </div>
    `,
};

export default FeedbackList;
