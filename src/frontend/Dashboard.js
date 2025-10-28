/* global JRJ_DASH */
import {
  createApp,
  ref,
  onMounted,
  computed,
} from "vue/dist/vue.esm-bundler.js";
// import { createApp, ref, onMounted, computed } from "vue";

const fetchJSON = async (path) => {
  const res = await fetch(JRJ_DASH.root + path, {
    headers: { "X-WP-Nonce": JRJ_DASH.nonce, "Cache-Control": "no-store" },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
};

const App = {
  setup() {
    const loading = ref(false);
    const error = ref("");
    const certifications = ref([]);
    const progress = ref({
      assigned: 0,
      completed: 0,
      required_cert_total: 0,
      required_cert_completed: 0,
      total_learning_hours: 0,
    });

    const completionPct = computed(() => {
      if (!progress.value.assigned) return 0;
      return Math.round(
        (progress.value.completed / progress.value.assigned) * 100
      );
    });

    const requiredPct = computed(() => {
      if (!progress.value.required_cert_total) return 0;
      return Math.round(
        (progress.value.required_cert_completed /
          progress.value.required_cert_total) *
          100
      );
    });

    const stateBadge = (s) => {
      switch (s) {
        case "active":
          return { label: "Active", cls: "badge green" };
        case "expiring_soon":
          return { label: "Expiring soon", cls: "badge amber" };
        case "expired":
          return { label: "Expired", cls: "badge red" };
        default:
          return { label: "Not completed", cls: "badge gray" };
      }
    };

    const load = async () => {
      loading.value = true;
      error.value = "";
      try {
        const data = await fetchJSON("me/dashboard");
        certifications.value = data.certifications || [];
        progress.value = data.progress || progress.value;
      } catch (e) {
        console.error(e);
        error.value = e.message || "Failed to load dashboard.";
      } finally {
        loading.value = false;
      }
    };

    onMounted(load);
    return {
      loading,
      error,
      certifications,
      progress,
      completionPct,
      requiredPct,
      stateBadge,
    };
  },

  template: `
  <div class="jrj-dash">
    <h2>Certification Tracker</h2>
    <p class="subtle">Required vs earned certifications at a glance.</p>

    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="loading" class="notice">Loading…</div>

    <div class="cards">
      <div v-for="c in certifications" :key="c.course_id" class="card">
        <div class="row">
          <span :class="stateBadge(c.status).cls">• {{ stateBadge(c.status).label }}</span>
          <div class="title">{{ c.title }}</div>
          <div class="spacer"></div>
          <a v-if="c.status==='active' && c.certificate_url" class="btn ghost" :href="c.certificate_url" target="_blank" rel="noopener">View</a>
          <a v-else-if="c.status==='expiring_soon'" class="btn" :href="'/courses/' + c.course_id">Renew</a>
          <a v-else-if="c.status==='expired'" class="btn danger" :href="'/courses/' + c.course_id">Re-certify</a>
          <span v-else class="btn muted">Start</span>
        </div>
        <div class="meta" v-if="c.expires_on">Expires: {{ c.expires_on }}</div>
      </div>
      <div v-if="!loading && certifications.length===0" class="muted">No certifications assigned yet.</div>
    </div>

    <h2>Training & Certification Progress</h2>
    <div class="grid">
      <div class="panel">
        <h3>Training Completion</h3>
        <div class="donut-wrap">
          <svg viewBox="0 0 36 36" class="donut">
            <!-- Background ring -->
            <circle class="donut-ring" cx="18" cy="18" r="15.9155" fill="transparent" stroke="#eee" stroke-width="3"></circle>

            <!-- Progress arc -->
            <circle
              class="donut-segment"
              cx="18"
              cy="18"
              r="15.9155"
              fill="transparent"
              stroke="#4CAF50"
              stroke-width="3"
              :stroke-dasharray="completionPct + ', 100'"
              stroke-dashoffset="0"
            />

            <!-- Label -->
            <text x="18" y="20.35" class="donut-label" text-anchor="middle" font-size="5" fill="#333">
              {{ completionPct }}%
            </text>
          </svg>
        </div>
        <div class="meta">{{ progress.completed }} of {{ progress.assigned }} ({{ completionPct }}%)</div>
      </div>

      <div class="panel">
        <h3>Required Certifications</h3>
        <div class="meter">
          <div class="meter-fill" :style="{width: requiredPct + '%'}"></div>
        </div>
        <div class="meta">{{ progress.required_cert_completed }} of {{ progress.required_cert_total }} ({{ requiredPct }}%)</div>
      </div>

      <div class="panel">
        <h3>Total Learning Hours</h3>
        <div class="big-number">{{ progress.total_learning_hours }}h</div>
        <div class="meta">Cumulative (estimated)</div>
      </div>
    </div>
    <p class="motivate" v-if="completionPct > 0">
      You’re {{ completionPct }}% through your core training — great work!
    </p>
  </div>
  `,
};

document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("jamrock-dashboard-app");
  if (el) {
    createApp(App).mount(el);
  }
});
