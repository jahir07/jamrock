/* global JRJ_ADMIN */
import { ref, reactive, onMounted } from "vue/dist/vue.esm-bundler.js";

export default {
  name: "CoursesList",
  setup() {
    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const perPage = ref(10);
    const loading = ref(false);

    // match controller whitelist: 'completed','in_progress','expired'
    const filter = reactive({ status: "" });

    const load = async () => {
      loading.value = true;
      try {
        const q = new URLSearchParams({
          page: String(page.value),
          per_page: String(perPage.value),
          status: filter.status || "", // '' means all.
        });

        const url = `${JRJ_ADMIN.root}courses?${q.toString()}`;
        const res = await fetch(url, {
          method: "GET",
          credentials: "same-origin", // send WP cookies
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `HTTP ${res.status}`);
        }

        const json = await res.json();
        items.value = json.items || [];
        console.log(items);
        
        // total comes from headers (per controller)
        const totalHeader = res.headers.get("X-WP-Total");
        total.value = totalHeader ? parseInt(totalHeader, 10) : json.total || 0;
      } finally {
        loading.value = false;
      }
    };

    onMounted(load);
    return { items, total, page, perPage, loading, filter, load };
  },
  template: `
  <div class="jrj-card">
    <h2>Courses</h2>

    <div class="jrj-toolbar">
      <label>Status
        <select v-model="filter.status" @change="page=1; load()">
          <option value="">All</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="expired">Expired</option>
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
          <th>#</th><th>Course ID</th><th>Status</th><th>Score</th><th>Certificate</th><th>Expiry</th><th>Updated</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading"><td colspan="8">Loading…</td></tr>

        <tr v-for="r in items" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.course_id }}</td>
          <td>{{ r.status }}</td>
          <td>{{ r.score ?? '-' }}</td>
          <td>
            <a v-if="r.certificate_url" :href="r.certificate_url" target="_blank" rel="noopener">View</a>
            <span v-else>-</span>
          </td>
          <td>{{ r.expiry_date || '-' }}</td>
          <td>{{ r.updated_at }}</td>
        </tr>

        <tr v-if="!loading && items.length===0"><td colspan="8">No items</td></tr>
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
