/* global JRJ_ADMIN */
import { ref, onMounted, watch } from "vue/dist/vue.esm-bundler.js";

export default {
  name: "BarChartCard",
  props: {
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" }, // e.g. "Last 4 weeks"
    endpoint: { type: String, required: true }, // rest endpoint path relative to JRJ_ADMIN.root e.g. "insights/active-users"
    days: { type: Number, default: 7 } // optional override
  },
  setup(props) {
    const loading = ref(true);
    const error = ref("");
    const rows = ref([]); // {label, value}

    const buildUrl = (base, params = {}) => {
      // JRJ_ADMIN.root includes trailing slash in your setup; ensure no double slash
      const root = (typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN.root) ? JRJ_ADMIN.root.replace(/\/+$/, "") + "/" : "/wp-json/jamrock/v1/";
      let url = props.endpoint.indexOf(root) === 0 ? props.endpoint : root + props.endpoint.replace(/^\/+/, "");
      const urlObj = new URL(url, window.location.origin);
      Object.keys(params).forEach(k => urlObj.searchParams.set(k, params[k]));
      return urlObj.toString();
    };

    const fetchData = async (daysOverride = null) => {
      loading.value = true;
      error.value = "";
      rows.value = [];
      try {
        const daysParam = daysOverride || props.days || 7;
        // the endpoint may already include query params; we'll pass days param
        const url = buildUrl(props.endpoint, { days: daysParam });
        const res = await fetch(url, {
          headers: { "X-WP-Nonce": (typeof JRJ_ADMIN !== "undefined" ? JRJ_ADMIN.nonce : "") },
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(body || `HTTP ${res.status}`);
        }
        const json = await res.json();

        // normalize payloads — many possible shapes
        // expect either { items: [...] } or { results: [...] } or array
        let items = [];
        if (!Array.isArray(items)) {
          // maybe object of date=>value
          items = Object.keys(items).map(k => ({ day: k, value: items[k] }));
        }

        // heuristics: try to detect structure
        // common shapes:
        //  active-users: [{ day: '2025-11-16', unique_users: 2 }, ...]
        //  searches: [{ query: 'x', cnt: 10 }, ...]  -> show top 5 as rows: query — cnt
        //  time-spent: [{ day:'..', seconds: 1234 }, ...]
        if (items.length && items[0].hasOwnProperty("unique_users")) {
          rows.value = items.map(i => ({ label: i.day || i.label || i.date || i.x || "", value: Number(i.unique_users || 0) }));
        } else if (items.length && items[0].hasOwnProperty("cnt") && items[0].hasOwnProperty("query")) {
          rows.value = items.map(i => ({ label: i.query, value: Number(i.cnt || 0) }));
        } else if (items.length && (items[0].hasOwnProperty("seconds") || items[0].hasOwnProperty("minutes"))) {
          rows.value = items.map(i => ({ label: i.day || i.label || i.date || "", value: Number(i.seconds ?? (i.minutes ? i.minutes * 60 : 0)) }));
        } else if (items.length && items[0].hasOwnProperty("value")) {
          rows.value = items.map(i => ({ label: i.label || i.day || "", value: Number(i.value || 0) }));
        } else {
          // fallback: flatten numeric properties
          rows.value = items.map(i => {
            const label = i.day || i.label || i.query || i.name || "";
            // find first numeric property
            let v = 0;
            for (const k in i) {
              if (k === "day" || k === "label" || k === "query" || k === "name") continue;
              const n = Number(i[k]);
              if (!isNaN(n)) { v = n; break; }
            }
            return { label, value: v };
          });
        }

        // if there are lots of rows, keep latest/top 10
        if (rows.value.length > 10 && rows.value[0].label && rows.value[0].label.match(/^\d{4}/)) {
          // assume date-ordered -> keep last 7-10 according to days
          rows.value = rows.value.slice(-Math.min(10, rows.value.length));
        }

      } catch (e) {
        error.value = e.message || String(e);
      } finally {
        loading.value = false;
      }
    };

    onMounted(() => fetchData(props.days));

    watch(() => props.days, (nv) => {
      fetchData(nv);
    });

    return { loading, error, rows, fetchData };
  },
  template: `
    <div class="card" style="flex:1 1 300px;min-width:260px;">
      <h3>{{ title }}</h3>
      <div style="color:#666;margin-bottom:8px;font-size:13px;">{{ subtitle }}</div>

      <div v-if="loading" style="padding:18px;">Loading…</div>
      <div v-else-if="error" class="notice notice-error" style="padding:18px;">{{ error }}</div>
      <div v-else>
        <div v-if="rows.length===0" style="padding:18px;">No data yet.</div>
        <div v-else>
          <div v-for="(r,i) in rows" :key="i" style="display:flex;align-items:center;gap:8px;margin:6px 0;">
            <div style="width:110px;color:#666;font-size:13px; white-space:nowrap; overflow:hidden; text-overflow: ellipsis;">{{ r.label }}</div>
            <div style="flex:1;height:12px;background:#f0f0f0;border-radius:6px;overflow:hidden;">
              <div :style="{ width: (rowsMax(rows)>0 ? Math.round(r.value/rowsMax(rows)*100) : 0) + '%', height: '100%', transition: 'width .3s', background:'#2271b1' }"></div>
            </div>
            <div style="width:44px;text-align:right;font-weight:600;">{{ r.value }}</div>
          </div>
        </div>
      </div>

      <div style="padding:12px;">
        <button class="button" @click="$emit('refresh')">Refresh</button>
      </div>
    </div>
  `,
  methods: {
    // helper for template; keep inside methods so template can call
    rowsMax(rows) {
      if (!rows || !rows.length) return 0;
      let m = 0;
      for (const r of rows) if (r.value > m) m = r.value;
      return m;
    }
  }
};