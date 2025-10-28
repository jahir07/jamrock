import { ref, reactive, onMounted } from 'vue/dist/vue.esm-bundler.js';

export default {
	name: 'LogsList',
	setup() {
		const items = ref( [] ),
			total = ref( 0 ),
			page = ref( 1 ),
			perPage = ref( 20 ),
			loading = ref( false );
		const filter = reactive( { event: '' } );

		const load = async () => {
			loading.value = true;
			try {
				const q = new URLSearchParams( {
					page: page.value,
					per_page: perPage.value,
					event: filter.event || '',
				} );
				const data = await api(JRJ_ADMIN.root + "logs?" + q.toString());
				items.value = data.items || [];
				total.value = data.total || 0;
			} finally {
				loading.value = false;
			}
		};

		onMounted( load );
		return { items, total, page, perPage, loading, filter, load };
	},
	template: `
  <div class="jrj-card">
    <h2>Logs</h2>
    <div class="jrj-toolbar">
      <label>Event
        <input type="text" v-model="filter.event" placeholder="e.g. psymetrics_webhook" @keyup.enter="page=1; load()" />
      </label>
      <label>Per page
        <select v-model.number="perPage" @change="page=1; load()"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select>
      </label>
    </div>
    <table class="jrj-table">
      <thead><tr><th>#</th><th>Event</th><th>Result</th><th>Payload</th><th>When</th></tr></thead>
      <tbody>
        <tr v-if="loading"><td colspan="5">Loading…</td></tr>
        <tr v-for="r in items" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.event }}</td>
          <td>{{ r.result || '-' }}</td>
          <td><pre style="white-space:pre-wrap;max-width:520px;overflow:auto;">{{ r.payload_json || '' }}</pre></td>
          <td>{{ r.created_at }}</td>
        </tr>
        <tr v-if="!loading && items.length===0"><td colspan="5">No items</td></tr>
      </tbody>
    </table>
    <div class="jrj-pagination" v-if="total > perPage">
      <button class="button" :disabled="page===1" @click="page--; load()">«</button>
      <span>Page {{ page }}</span>
      <button class="button" :disabled="page*perPage>=total" @click="page++; load()">»</button>
    </div>
  </div>
  `,
};
