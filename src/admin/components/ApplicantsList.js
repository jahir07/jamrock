import { ref, reactive, onMounted } from 'vue/dist/vue.esm-bundler.js';

export default {
	name: 'ApplicantsList',
	setup() {
		const items = ref( [] );
		const total = ref( 0 );
		const page = ref( 1 );
		const perPage = ref( 10 );
		const loading = ref( false );
		const filter = reactive( { status: '' } );

		const load = async () => {
      loading.value = true;
      try {
        const q = new URLSearchParams({
          page: page.value,
          per_page: perPage.value,
          status: filter.status || "",
        });
        const res = await fetch(JRJ_ADMIN.root + "applicants?" + q.toString(), {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        if (!res.ok) throw new Error("Failed to load applicants");
        const data = await res.json();
        items.value = data.items || [];
        total.value = data.total || 0;
      } finally {
        loading.value = false;
      }
    };

		onMounted( load );
		return { items, total, page, perPage, filter, loading, load };
	},
	template: `
    <div class="jrj-card">
      <h2>Applicants</h2>
      <div class="jrj-toolbar">
        <label>Status
          <select v-model="filter.status" @change="page=1; load()">
            <option value="">All</option>
            <option>applied</option>
            <option>shortlisted</option>
            <option>hired</option>
            <option>active</option>
            <option>inactive</option>
            <option>knockout</option>
          </select>
        </label>
        <label>Per page
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
            <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Score</th><th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="7">Loading…</td></tr>
          <tr v-for="r in items" :key="r.id">
            <td>{{ r.id }}</td>
            <td>{{ r.first_name }} {{ r.last_name }}</td>
            <td>{{ r.email }}</td>
            <td>{{ r.phone || '-' }}</td>
            <td>{{ r.status }}</td>
            <td>{{ r.score_total ?? '0' }}</td>
            <td>{{ r.updated_at }}</td>
          </tr>
          <tr v-if="!loading && items.length===0"><td colspan="7">No items</td></tr>
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
