/* global JRJ_ADMIN */
import { ref, reactive, onMounted } from "vue/dist/vue.esm-bundler.js";
import BarChartCard from "./charts/BarChart.js";

export default {
  name: "Dashboard",
  components: { BarChartCard },
  setup() {
    const active = ref([]);
    const searches = ref([]);
    const timeSpent = ref([]);
    const loading = ref(false);
    const error = ref("");
    const lastUpdated = ref(null);

    // simple filter (days window)
    const filter = reactive({
      days: 7,
    });

    const getJSON = async (path) => {
      const root =
        typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN.root
          ? JRJ_ADMIN.root
          : "/wp-json/jamrock/v1/";
      const nonce =
        typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN.nonce
          ? JRJ_ADMIN.nonce
          : "";
      const url = root + path;
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: { "X-WP-Nonce": nonce, "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        let body = await res.text().catch(() => "");
        try {
          const j = JSON.parse(body);
          body = j.message || j.error || body;
        } catch (e) {
          /* keep text */
        }
        throw new Error(body || `HTTP ${res.status}`);
      }
      return res.json();
    };

    const calcPct = (val) => {
      const arr = active.value.map((x) => Number(x.unique_users || 0));
      const max = Math.max(...arr, 1);
      return Math.round((Number(val || 0) / max) * 100);
    };

    const load = async () => {
      loading.value = true;
      error.value = "";
      try {
        const a = await getJSON(
          `insights/active-users?days=${encodeURIComponent(filter.days)}`
        );
        active.value = a.items || [];

        const s = await getJSON(`insights/searches?limit=10`);
        searches.value = s.items || [];

        const t = await getJSON(
          `insights/time-spent?days=${encodeURIComponent(filter.days)}`
        );
        timeSpent.value = t.items || [];

        lastUpdated.value = new Date().toLocaleString();
      } catch (e) {
        error.value = e.message || "Failed to load insights";
      } finally {
        loading.value = false;
      }
    };

    onMounted(load);

    return {
      active,
      searches,
      timeSpent,
      loading,
      error,
      filter,
      lastUpdated,
      calcPct,
      load,
    };
  },

  template: `
  <div class="jrj-card jrj-insights">
    <h2>Insights</h2>

    <div v-if="error" class="notice notice-error" style="margin-bottom:10px;">{{ error }}</div>

    <div class="jrj-toolbar" style="margin-bottom:12px;">
      <label>Days
        <select v-model.number="filter.days" @change="load">
          <option :value="7">7</option>
          <option :value="14">14</option>
          <option :value="30">30</option>
        </select>
      </label>
      <button class="button" style="margin-left:12px;" @click="load" :disabled="loading">{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
      <span style="margin-left:12px;color:#666">Last: {{ lastUpdated || '—' }}</span>
    </div>

    <div class="jrj-grid" style="display:flex; gap:20px; margin-bottom:16px;">

     
      <BarChartCard
        title="Active users"
        :subtitle="'Last ' + filter.days + ' days'"
        endpoint="insights/active-users"
        :days="filter.days"
        :horizontal="true"
        color="#111"
      />

      <BarChartCard
        title="Searches made"
        :subtitle="'Last ' + filter.days + ' days'"
        endpoint="insights/searches"
        :days="filter.days"
      >
        <template #extra>
          <div v-for="s in searchesList" :key="s.query" style="font-size:13px;margin:6px 0;">
            <div style="font-weight:600">{{ s.query }}</div>
            <div style="color:#666;font-size:12px;">{{ s.cnt }} searches</div>
          </div>
        </template>
      </BarChartCard>

      <BarChartCard
        title="Time spent vs saved"
        :subtitle="'Last ' + filter.days + ' days'"
        endpoint="insights/time-spent"
        :days="28"
      />
      
    </div>

    
  </div>
  `,
};
