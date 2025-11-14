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

    const filter = reactive({
      provider: "psymetrics",
      candidness: "",
    });

    const fmt = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    const startDefault = new Date(today);
    startDefault.setDate(startDefault.getDate() - 10);

    const dates = reactive({
      start: fmt(startDefault),
      end: fmt(today),
    });

    const modalOpen = ref(false);
    const detail = ref(null);
    const modalError = ref("");

    // Helpers for HTTP
    const getJSON = async (path) => {
      const res = await fetch(JRJ_ADMIN.root + path, {
        headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        cache: "no-store",
      });
      if (!res.ok) {
        let body;
        try {
          body = await res.json();
        } catch (e) {}
        throw new Error(
          (body && (body.message || body.error)) || "Request failed"
        );
      }
      return res.json();
    };
    const postJSON = async (path, body) => {
      const res = await fetch(JRJ_ADMIN.root + path, {
        method: "POST",
        headers: {
          "X-WP-Nonce": JRJ_ADMIN.nonce,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let data;
        try {
          data = await res.json();
        } catch (e) {}
        throw new Error(
          (data && (data.message || data.error)) || "Request failed"
        );
      }
      return res.json();
    };

    // ----- normalizeItem (keeps previous robustness) -----
    const dig = (obj, path) => {
      if (!obj) return undefined;
      const parts = path.split(".");
      let cur = obj;
      for (let p of parts) {
        if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
        else return undefined;
      }
      return cur;
    };

    const normalizeItem = (row) => {
      const sessionId =
        row.session_id ||
        row.tenantTestAttemptId ||
        row.testAttemptId ||
        row.id ||
        row.session ||
        null;
      const firstName =
        row.first_name ||
        row.firstName ||
        (row.userDetails && row.userDetails.name) ||
        (row.user_name ? row.user_name.split(" ")[0] : "") ||
        "";
      const lastName =
        row.last_name ||
        row.lastName ||
        (row.user_name ? row.user_name.split(" ").slice(1).join(" ") : "") ||
        "";
      const email =
        row.email ||
        row.user_email ||
        (row.userDetails && row.userDetails.email) ||
        "";

      let rawScore =
        row.integrity_score ??
        row.overall_score ??
        row.trustScore ??
        row.score ??
        row.trust_score ??
        dig(row, "test_attempt.trust_score") ??
        dig(row, "test_attempt.trustScore") ??
        dig(row, "raw.test_attempt.trust_score") ??
        dig(row, "raw.test_attempt.trustScore");

      if (rawScore === undefined) {
        rawScore =
          dig(row, "raw.integrity_score") ??
          dig(row, "raw.trustScore") ??
          dig(row, "raw.score") ??
          dig(row, "raw.test_attempt.trust_score");
      }

      let overallScore = null;
      if (typeof rawScore !== "undefined" && rawScore !== null) {
        const s = Number(rawScore);
        if (!isNaN(s)) {
          overallScore =
            s <= 1.1 ? Math.round(s * 10000) / 100 : Math.round(s * 100) / 100;
        }
      }

      const completedAt =
        row.completed_at ||
        row.completedAt ||
        dig(row, "test_attempt.test_finish_time") ||
        dig(row, "raw.test_attempt.test_finish_time") ||
        null;
      const startedAt =
        row.started_at ||
        row.startedAt ||
        dig(row, "test_attempt.test_client_start_time") ||
        dig(row, "raw.test_attempt.test_client_start_time") ||
        null;

      const flags = Array.isArray(row.flags)
        ? row.flags
        : Array.isArray(row.violations)
        ? row.violations
        : (row.flags_json
            ? (() => {
                try {
                  return JSON.parse(row.flags_json);
                } catch (e) {
                  return [];
                }
              })()
            : []) ||
          (row.raw && Array.isArray(row.raw.flags)
            ? row.raw.flags
            : row.raw && Array.isArray(row.raw.violations)
            ? row.raw.violations
            : []);
      const candidness =
        row.candidness ||
        row.status ||
        (Array.isArray(flags) && flags.length
          ? "flagged"
          : overallScore !== null
          ? "completed"
          : "pending");

      return {
        id: row.id || sessionId,
        session_id: sessionId,
        first_name: firstName,
        last_name: lastName,
        email,
        completed_at: completedAt,
        started_at: startedAt,
        overall_score: overallScore,
        raw_score: rawScore,
        candidness,
        flags: Array.isArray(flags) ? flags : [],
        raw: row,
      };
    };

    // ----- FLAG parsing: extract events array from various shapes -----
    const getFlagList = (det) => {
      if (!det) return [];
      // possible candidates (search order)
      const candidates = [];

      // first: explicit detail.flags from normalizeItem
      if (Array.isArray(det.flags) && det.flags.length)
        candidates.push(det.flags);

      // raw under different keys
      const raw = det.raw || {};
      if (Array.isArray(raw.flags)) candidates.push(raw.flags);
      if (Array.isArray(raw.violations)) candidates.push(raw.violations);
      if (raw.test_attempt && Array.isArray(raw.test_attempt.violations))
        candidates.push(raw.test_attempt.violations);
      if (raw.test_attempt && Array.isArray(raw.test_attempt.events))
        candidates.push(raw.test_attempt.events);
      if (Array.isArray(raw.events)) candidates.push(raw.events);

      // misc_data.userDetails maybe not events

      // flatten first non-empty candidate; normalize each item to object {type, ts, evidence_url, ...}
      for (const c of candidates) {
        if (Array.isArray(c) && c.length) {
          return c.map((it) => {
            // different providers name fields differently; try to normalize
            let type =
              it.type ||
              it.name ||
              it.violation ||
              it.eventType ||
              it.key ||
              it.code ||
              it.reason ||
              null;
            let ts =
              it.ts ||
              it.timestamp ||
              it.occurred_at ||
              it.time ||
              it.occurredAt ||
              null;
            // AP often returns ISO strings or epoch; try to convert epoch-like numeric ts into ms string
            if (typeof ts === "number" && ts > 1e10) {
              // milliseconds
            } else if (typeof ts === "number" && ts <= 1e10 && ts > 1e9) {
              // seconds -> convert
              ts = new Date(ts * 1000).toISOString();
            }
            // evidence link maybe under it.evidence_url or it.url or it.cloud_path or it.s3_url
            const evidence_url =
              it.evidence_url ||
              it.url ||
              it.s3_url ||
              it.cloud_url ||
              it.evidenceUrl ||
              (it.meta && (it.meta.evidence_url || it.meta.url)) ||
              null;
            return { raw: it, type, ts, evidence_url };
          });
        }
      }

      return [];
    };

    // map known flag types to human label and simple canonical key
    const mapFlagLabel = (type) => {
      if (!type) return { key: "unknown", label: "Unknown" };
      const t = String(type).toLowerCase();
      if (
        t.includes("tab") ||
        t.includes("tabswitch") ||
        t.includes("tab_switch") ||
        t.includes("tab-switched") ||
        t.includes("switch")
      )
        return { key: "tab_switched", label: "Tab Switched" };
      if (t.includes("noise") || t.includes("audio"))
        return { key: "noise_detected", label: "Noise Detected" };
      if (t.includes("face") && t.includes("not"))
        return { key: "no_face_detected", label: "No Face Detected" };
      if (t.includes("multiple") && t.includes("face"))
        return { key: "multiple_faces", label: "Multiple Faces" };
      if (t.includes("face") && t.includes("missing"))
        return { key: "no_face_detected", label: "No Face Detected" };
      // fallback
      return {
        key: t.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
        label: String(type).replace(/_/g, " "),
      };
    };

    // counts summary for major types
    const getFlagCounts = (det) => {
      const list = getFlagList(det);
      const counts = {
        tab_switched: 0,
        noise_detected: 0,
        no_face_detected: 0,
        multiple_faces: 0,
        total: list.length,
      };
      for (const e of list) {
        const m = mapFlagLabel(e.type);
        if (counts.hasOwnProperty(m.key)) counts[m.key] += 1;
        // some item types may be composite, check raw.type text for keywords
        else {
          const t = String(e.type || "").toLowerCase();
          if (t.includes("tab")) counts.tab_switched++;
          if (t.includes("noise") || t.includes("audio"))
            counts.noise_detected++;
          if (
            t.includes("no face") ||
            t.includes("face_not_found") ||
            t.includes("missing face")
          )
            counts.no_face_detected++;
          if (t.includes("multi") && t.includes("face"))
            counts.multiple_faces++;
        }
      }
      return counts;
    };

    // date formatting helper
    const fmtDate = (s) => {
      if (!s) return "—";
      try {
        const d = new Date(s);
        if (!isNaN(d)) return d.toLocaleString();
      } catch (e) {}
      return String(s);
    };

    // Load list (same logic as before)
    const load = async () => {
      loading.value = true;
      error.value = "";
      try {
        const isAP = filter.provider === "autoproctor";
        let path = "";
        if (isAP) {
          path = `autoproctor/attempts?page=${page.value}&per_page=${perPage.value}`;
        } else {
          const q = new URLSearchParams({
            page: page.value,
            per_page: perPage.value,
            provider: filter.provider || "",
            candidness: filter.candidness || "",
          });
          path = `assessments?` + q.toString();
        }
        const data = await getJSON(path);
        const rows = data.items || [];
        items.value = rows.map(normalizeItem);
        total.value = data.total || rows.length || 0;
      } catch (e) {
        error.value = e.message || "Failed to load";
        items.value = [];
        total.value = 0;
      } finally {
        loading.value = false;
      }
    };

    // Open details: call server and then normalize + annotate flags
    const openDetails = async (id) => {
      modalError.value = "";
      detail.value = null;
      modalOpen.value = true;
      try {
        const isAP = filter.provider === "autoproctor";
        const path = isAP
          ? `autoproctor/attempts/${encodeURIComponent(id)}`
          : `assessments/${encodeURIComponent(id)}`;
        const data = await getJSON(path);
        const attempt = data.attempt || data.assessment || data;
        // ensure parsed raw if string
        if (attempt && attempt.raw && typeof attempt.raw === "string") {
          try {
            attempt.raw = JSON.parse(attempt.raw);
          } catch (e) {}
        }
        // merge nested test_attempt for convenience
        if (attempt && attempt.raw && attempt.raw.test_attempt) {
          attempt.test_attempt = attempt.raw.test_attempt;
          if (
            !attempt.trustScore &&
            (attempt.test_attempt.trust_score ||
              attempt.test_attempt.trustScore)
          ) {
            attempt.trustScore =
              attempt.test_attempt.trust_score ??
              attempt.test_attempt.trustScore;
          }
          if (
            !attempt.started_at &&
            attempt.test_attempt.test_client_start_time
          )
            attempt.started_at = attempt.test_attempt.test_client_start_time;
          if (!attempt.completed_at && attempt.test_attempt.test_finish_time)
            attempt.completed_at = attempt.test_attempt.test_finish_time;
        }
        const normalized = normalizeItem(attempt);
        // compute flag list & counts
        normalized._flagList = getFlagList(normalized);
        normalized._flagCounts = getFlagCounts(normalized);
        detail.value = normalized;
      } catch (e) {
        modalError.value = e.message || "Failed to load details";
      }
    };

    const refreshOne = async (id) => {
      try {
        if (filter.provider === "autoproctor") {
          await postJSON(
            `autoproctor/attempts/${encodeURIComponent(id)}/refresh`
          );
        } else {
          await postJSON(`assessments/${encodeURIComponent(id)}/refresh`);
        }
        await openDetails(id);
        await load();
      } catch (e) {
        alert(e.message || "Refresh failed");
      }
    };

    const recompute = async (id) => {
      try {
        await postJSON(`assessments/${encodeURIComponent(id)}/recompute`);
        alert("Composite recomputed.");
      } catch (e) {
        alert(e.message || "Recompute failed");
      }
    };

    onMounted(async () => {
      await load();
    });

    return {
      items,
      total,
      page,
      perPage,
      loading,
      syncing,
      error,
      filter,
      dates,
      modalOpen,
      detail,
      modalError,
      load,
      openDetails,
      refreshOne,
      recompute,
      syncMissing: async () => {
        syncing.value = true;
        try {
          await postJSON("autoproctor/sync-missing");
          await load();
          alert("Sync triggered");
        } catch (e) {
          alert(e.message || "Sync failed");
        } finally {
          syncing.value = false;
        }
      },
      fmtDate,
    };
  },

  template: `
  <div class="jrj-card">
    <h2 v-if="filter.provider==='psymetrics'">Assessments</h2>
    <h2 v-if="filter.provider==='autoproctor'">LearnDash Quiz Assessments</h2>

    <div v-if="error" class="notice notice-error" style="margin-bottom:10px;">{{ error }}</div>

    <div class="jrj-toolbar">
      <div class="jrj-switcher">
        <button
          :class="['sw-item', filter.provider === 'psymetrics' ? 'active' : '']"
          @click="filter.provider='psymetrics'; page=1; load();"
        >
          Psymetrics
        </button>

        <button
          :class="['sw-item', filter.provider === 'autoproctor' ? 'active' : '']"
          @click="filter.provider='autoproctor'; page=1; load();"
        >
          Autoproctor
        </button>
      </div>

      <label>Status
        <select v-model="filter.candidness" @change="page=1; load()">
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="flagged">Flagged</option>
          <option value="invalid">Invalid</option>
          <option value="pending">Pending</option>
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
        <label>Start <input type="date" v-model="dates.start" /></label>
        <label>End <input type="date" v-model="dates.end" /></label>
        <button class="button" :disabled="syncing" @click="syncPsymetrics">
          {{ syncing ? 'Syncing…' : 'Sync Psymetrics' }}
        </button>
      </template>

      <template v-if="filter.provider==='autoproctor'">
        <button class="button" :disabled="syncing" @click="syncMissing">
          {{ syncing ? 'Syncing…' : 'Sync Missing' }}
        </button>
      </template>
    </div>

    <table class="jrj-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Provider</th>
          <th>Name</th>
          <th>Email</th>
          <th>Date</th>
          <th>Score</th>
          <th>Status</th>
          <th>Flags</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading"><td colspan="9">Loading…</td></tr>
        <tr v-for="r in items" :key="r.session_id">
          <td>{{ r.session_id }}</td>
          <td>{{ filter.provider || r.provider || filter.provider }}</td>
          <td>{{ (r.first_name || '') + (r.last_name ? ' ' + r.last_name : '') }}</td>
          <td>{{ r.email }}</td>
          <td>{{ r.completed_at || '-' }}</td>
          <td>{{ r.overall_score ?? '-' }}</td>
          <td>{{ r.candidness || '-' }}</td>
          <td>
            <span v-if="(r.flags && r.flags.length)">{{ r.flags.length }} flags</span>
          </td>
          <td class="actions">
            <button class="button" @click="openDetails(r.session_id)">Details</button>
            <button class="button" @click="refreshOne(r.session_id)">Refresh</button>
            <button v-if="filter.provider==='psymetrics'" class="button button-primary" @click="recompute(r.session_id)">Recompute Composite</button>
          </td>
        </tr>
        <tr v-if="!loading && items.length===0"><td colspan="9">No items</td></tr>
      </tbody>
    </table>

    <div class="jrj-pagination" v-if="total > perPage">
      <button class="button" :disabled="page===1" @click="page--; load()">«</button>
      <span>Page {{ page }}</span>
      <button class="button" :disabled="page*perPage>=total" @click="page++; load()">»</button>
    </div>

    <!-- Modal -->
    <div v-if="modalOpen" class="jrj-modal">
      <div class="jrj-modal-body">
        <button class="jrj-modal-close" @click="modalOpen=false">×</button>
        <h3>Assessment Details</h3>
        <div v-if="modalError" class="notice notice-error">{{ modalError }}</div>
        <div v-else-if="!detail">Loading…</div>
        <div v-else>
          <div class="row">
            <div style="flex:1;">
              <div><strong>Session:</strong> {{ detail.session_id }}</div>
              <div><strong>Applicant:</strong> {{ (detail.first_name || '') + ' ' + (detail.last_name || '') }}</div>
              <div><strong>Email:</strong> {{ detail.email }}</div>
              <div><strong>Completed:</strong> {{ detail.completed_at ? fmtDate(detail.completed_at) : '-' }}</div>
              <div><strong>Status:</strong> {{ detail.candidness }}</div>
            </div>

            <div style="margin-left:2rem;">
              <div><strong>Raw Score:</strong> {{ detail.raw_score ?? '—' }}</div>
              <div><strong>Normalized:</strong> {{ detail.overall_score ?? '—' }}</div>
              <div v-if="detail.raw && detail.raw.assessment_url"><a :href="detail.raw.assessment_url" target="_blank">Open Assessment</a></div>
            </div>
          </div>

          <!-- Autoproctor-specific proctoring summary -->
          <div v-if="filter.provider==='autoproctor'" style="margin-top:1rem;">
            <h4>Proctoring Summary</h4>
            <div style="display:flex;gap:1rem;margin-bottom:0.75rem;">
              <div style="padding:12px;border:1px solid #eee;border-radius:6px;min-width:140px;text-align:center;">
                <div style="font-size:20px;font-weight:700;">{{ detail._flagCounts?.tab_switched ?? 0 }}</div>
                <div style="font-size:12px;color:#666;">Tab Switched</div>
              </div>
              <div style="padding:12px;border:1px solid #eee;border-radius:6px;min-width:140px;text-align:center;">
                <div style="font-size:20px;font-weight:700;">{{ detail._flagCounts?.noise_detected ?? 0 }}</div>
                <div style="font-size:12px;color:#666;">Noise Detected</div>
              </div>
              <div style="padding:12px;border:1px solid #eee;border-radius:6px;min-width:140px;text-align:center;">
                <div style="font-size:20px;font-weight:700;">{{ detail._flagCounts?.no_face_detected ?? 0 }}</div>
                <div style="font-size:12px;color:#666;">No Face Detected</div>
              </div>
              <div style="padding:12px;border:1px solid #eee;border-radius:6px;min-width:140px;text-align:center;">
                <div style="font-size:20px;font-weight:700;">{{ detail._flagCounts?.multiple_faces ?? 0 }}</div>
                <div style="font-size:12px;color:#666;">Multiple Faces</div>
              </div>
            </div>

            <h4>Events</h4>
            <table class="jrj-table" style="margin-top:0.5rem;">
              <thead>
                <tr><th style="width:40%;">Violation Type</th><th style="width:30%;">Occurred At</th><th>Evidence</th></tr>
              </thead>
              <tbody>
                <tr v-if="!detail._flagList || detail._flagList.length===0"><td colspan="3">No proctoring events recorded.</td></tr>
                <tr v-for="(ev,i) in detail._flagList || []" :key="i">
                  <td>{{ (ev.type ? mapLabel(ev.type).label : (ev.raw && ev.raw.type) || 'Unknown') }}</td>
                  <td>{{ ev.ts ? fmtDate(ev.ts) : '—' }}</td>
                  <td>
                    <template v-if="ev.evidence_url">
                      <!-- if audio (extension .mp3/.wav) -> show audio player -->
                      <audio v-if="ev.evidence_url.match(/\\.(mp3|wav|ogg)(\\?.*)?$/i)" :src="ev.evidence_url" controls preload="none"></audio>
                      <!-- if image -> show small thumb link -->
                      <a v-else :href="ev.evidence_url" target="_blank">Open</a>
                    </template>
                    <template v-else>—</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="filter.provider==='psymetrics'">
            <h4 style="margin-top:1rem;">Totals</h4>
            <ul>
              <li>Total: {{ detail.raw?.totals?.total ?? detail.raw?.totals ?? '—' }}</li>
              <li>Attempted: {{ detail.raw?.totals?.attempted ?? '—' }}</li>
              <li>Correct: {{ detail.raw?.totals?.correct ?? '—' }}</li>
              <li>Incorrect: {{ detail.raw?.totals?.incorrect ?? '—' }}</li>
            </ul>

            <h4>Subscales</h4>
            <table class="jrj-table">
              <thead><tr><th>Scale</th><th>Percentile</th></tr></thead>
              <tbody>
                <tr v-if="!detail.raw?.subscales || !detail.raw.subscales.length"><td colspan="2">No subscales.</td></tr>
                <tr v-for="(s,i) in detail.raw?.subscales || []" :key="i">
                  <td>{{ s.scale }}</td>
                  <td>{{ s.percentile ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

            <div class="row" style="margin-top:1rem;">
              <button class="button" @click="refreshOne(detail.session_id)">Refresh</button>
              <button v-if="filter.provider==='psymetrics'" class="button button-primary" @click="recompute(detail.session_id)">Recompute Composite</button>
            </div>
        </div>
      </div>
    </div>
  </div>
  `,
  methods: {
    // small helper so template can call mapLabel
    mapLabel(type) {
      if (!type) return { key: "unknown", label: "Unknown" };
      const t = String(type).toLowerCase();
      if (t.includes("tab"))
        return { key: "tab_switched", label: "Tab Switched" };
      if (t.includes("noise") || t.includes("audio"))
        return { key: "noise_detected", label: "Noise Detected" };
      if (
        t.includes("no face") ||
        t.includes("face_not_found") ||
        t.includes("missing")
      )
        return { key: "no_face_detected", label: "No Face Detected" };
      if (t.includes("multi") && t.includes("face"))
        return { key: "multiple_faces", label: "Multiple Faces" };
      return {
        key: t.replace(/\s+/g, "_"),
        label: String(type).replace(/_/g, " "),
      };
    },
  },
};
