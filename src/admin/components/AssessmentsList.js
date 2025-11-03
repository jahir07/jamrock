/* global JRJ_ADMIN */
import { ref, reactive, onMounted } from "vue/dist/vue.esm-bundler.js";

export default {
  name: "AssessmentsList",
  setup() {
    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const perPage = ref(10);
    const loading = ref(false);
    const syncing = ref(false);
    const error = ref("");

    // Default provider = psymetrics, default candidness = ''
    const filter = reactive({
      provider: "psymetrics",
      candidness: "",
    });

    // Date helpers -----------------------------------------------------------
    const fmt = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD

    const today = new Date();
    const startDefault = new Date(today);
    startDefault.setDate(startDefault.getDate() - 10);

    const dates = reactive({
      start: fmt(startDefault),
      end: fmt(today),
    });

    // API helpers ------------------------------------------------------------
    const getJSON = async (path) => {
      const res = await fetch(JRJ_ADMIN.root + path, {
        headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
      });
      if (!res.ok)
        throw new Error((await res.json()).message || "Request failed");
      return res.json();
    };

    const postJSON = async (path) => {
      const res = await fetch(JRJ_ADMIN.root + path, {
        method: "POST",
        headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
      });
      if (!res.ok) throw new Error((await res.json()).message || "Sync failed");
      return res.json();
    };

    // Load table (paged, filtered) ------------------------------------------
    const load = async () => {
      loading.value = true;
      error.value = "";
      try {
        const q = new URLSearchParams({
          page: page.value,
          per_page: perPage.value,
          provider: filter.provider || "",
          candidness: filter.candidness || "",
        });
        const data = await getJSON("assessments?" + q.toString());
        console.log(data);
        
        items.value = data.items || [];
        total.value = data.total || 0;
      } catch (e) {
        error.value = e.message || "Failed to load";
      } finally {
        loading.value = false;
      }
    };

    // Sync from Psymetrics for date range, then reload table ----------------
    const syncPsymetrics = async () => {
      if (filter.provider !== "psymetrics") return; // safe guard
      syncing.value = true;
      error.value = "";
      try {
        const q = new URLSearchParams({ start: dates.start, end: dates.end });
        await postJSON("assessments/sync?" + q.toString());
        // After sync completes, refresh list (page 1)
        page.value = 1;
        await load();
      } catch (e) {
        error.value = e.message || "Sync failed";
      } finally {
        syncing.value = false;
      }
    };

    // On mount: auto-sync last 30 days (optional), then load table ----------
    onMounted(async () => {
      if (filter.provider === "psymetrics") {
        await syncPsymetrics(); // comment this line if you prefer manual sync first
      } else {
        await load();
      }
    });

    return {
      // state
      items,
      total,
      page,
      perPage,
      loading,
      syncing,
      error,
      filter,
      dates,
      // methods
      load,
      syncPsymetrics,
    };
  },

  template: `
  <div class="jrj-card">
    <h2>Assessments</h2>

    <div v-if="error" class="notice notice-error" style="margin-bottom:10px;">{{ error }}</div>

    <div class="jrj-toolbar">
      <label>Provider
        <select v-model="filter.provider" @change="page=1; load()">
          <option value="">All</option>
          <option value="psymetrics">psymetrics</option>
          <option value="autoproctor">autoproctor</option>
        </select>
      </label>

      <label>Candidness
        <select v-model="filter.candidness" @change="page=1; load()">
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="cleared">cleared</option>
          <option value="flagged">flagged</option>
          <option value="pending">pending</option>
        </select>
      </label>

      <label>Per page
        <select v-model.number="perPage" @change="page=1; load()">
          <option :value="10">10</option>
          <option :value="20">20</option>
          <option :value="50">50</option>
        </select>
      </label>

      <template v-if="filter.provider==='psymetrics'">
        <label>Start
          <input type="date" v-model="dates.start" @change="" />
        </label>
        <label>End
          <input type="date" v-model="dates.end" @change="" />
        </label>
        <button class="button" :disabled="syncing" @click="syncPsymetrics">
          {{ syncing ? 'Syncing…' : 'Sync Psymetrics' }}
        </button>
      </template>
    </div>

    <table class="jrj-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Applicant</th>
          <th>Email</th>
          <th>Provider</th>
          <th>Assessment url</th>
          <th>Score</th>
          <th>Candidness</th>
          <!-- <th>Completed</th> -->
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading"><td colspan="7">Loading…</td></tr>
        <tr v-for="r in items" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.first_name }} {{ r.last_name }}</td>
          <td>{{ r.email }}</td>
          <td>{{ r.provider }}</td>
          <td>{{ r.assessment_url }}</td>
          <td>{{ r.overall_score ?? '-' }}</td>
          <td>{{ r.candidness === 'pending' ? 'Awaiting Results' : r.candidness }}</td>
          <!-- <td>{{ r.completed_at || '-' }}</td> -->
        </tr>
        <tr v-if="!loading && items.length===0"><td colspan="7">No items</td></tr>
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
