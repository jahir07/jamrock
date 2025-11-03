// Inject component-scoped CSS once.!
const JRJ_APPLICANTS_CSS_ID = "jrj-applicants-css"; //!

function injectApplicantsCss() {
  //!
  if (document.getElementById(JRJ_APPLICANTS_CSS_ID)) return; //!
  const style = document.createElement("style"); //!
  style.id = JRJ_APPLICANTS_CSS_ID; //!
  style.textContent = `
  .jrj-card { background:#fff; border:1px solid #e5e5e5; padding:16px; margin:16px 0; border-radius:8px; }
  .jrj-table { width:100%; border-collapse:collapse; }
  .jrj-table th, .jrj-table td { border-bottom:1px solid #eee; padding:8px 10px; text-align:left; }
  .jrj-table thead th { background:#fafafa; font-weight:600; }
  .jrj-pagination { display:flex; gap:8px; align-items:center; margin-top:10px; }

  .notice.error { background:#ffecec; color:#c00; padding:8px 10px; border:1px solid #fcc; border-radius:6px; }

  .button { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid #ddd; border-radius:6px; background:#f8f8f8; cursor:pointer; text-decoration:none; }
  .button[disabled]{ opacity:.5; cursor:not-allowed; }

  .actions .button + .button { margin-left:6px; }

  .row { display:flex; gap:16px; }
  .items-center { align-items:center; }
  .ml-16 { margin-left:16px; }
  .spacer { flex:1; }
  .big { font-size:20px; font-weight:700; margin-bottom:4px; }
  .muted { color:#666; font-size:12px; }

  .badge { padding:2px 8px; border-radius:999px; font-size:12px; text-transform:capitalize; border:1px solid transparent; }
  .badge.red { background:#fde7e7; color:#b30000; border-color:#f4bebe; }
  .badge.amber { background:#fff4e1; color:#7a4b00; border-color:#f8da9e; }
  .badge.blue { background:#e7f0ff; color:#0a3d91; border-color:#bcd3ff; }
  .badge.gray { background:#f2f2f2; color:#444; border-color:#e0e0e0; }
  .badge.green { background:#e8f7ee; color:#166534; border-color:#bfe6cd; }

  /* Donut — percentage comes from the CSS var --pct, set via Vue inline style. */
  .donut {
    --size: 80px;
    --border: 10px;
    --pct: 0;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: conic-gradient(#4caf50 calc(var(--pct) * 1%), #ddd 0);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.2em;
    color: #333;
  }
  .donut-ring {
    width: calc(var(--size) - var(--border) * 2);
    height: calc(var(--size) - var(--border) * 2);
    background: #fff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .grid { display:flex; gap:20px; justify-content:space-between; max-width:900px; flex-wrap:wrap; }
  .grid .panel { flex:1 1 260px; padding:10px; border:1px solid #ccc; border-radius:8px; }
  .grid .panel h4 { margin-top:0; }
  `;
  document.head.appendChild(style); //!
}

export default {
  name: "ApplicantsWithComposite",
  data() {
    return {
      rows: [],
      total: 0,
      page: 1,
      perPage: 10,
      loading: false,
      error: "",
      selectedId: null,
      snap: null,
      snapLoading: false,
      snapErr: "",
    };
  },
  methods: {
    async loadList() {
      this.loading = true;
      this.error = "";
      try {
        const q = new URLSearchParams({
          page: this.page,
          per_page: this.perPage,
        });
        const res = await fetch(`${JRJ_ADMIN.root}applicants?` + q.toString(), {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        if (!res.ok) throw new Error("HTTP " + res.status); //!
        const data = await res.json();
        this.rows = data.items || [];
        this.total = data.total || 0;
      } catch (e) {
        this.error = e?.message || "Failed to load applicants.";
      } finally {
        this.loading = false;
      }
    },
    async showComposite(id) {
      this.selectedId = id;
      this.snap = null;
      this.snapErr = "";
      this.snapLoading = true;
      try {
        const res = await fetch(`${JRJ_ADMIN.root}applicants/${id}/composite`, {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        if (!res.ok) throw new Error("HTTP " + res.status); //!
        this.snap = await res.json();
      } catch (e) {
        this.snapErr = e?.message || "Failed to load composite.";
      } finally {
        this.snapLoading = false;
      }
    },
    async recompute() {
      if (!this.selectedId) return; //!
      this.snapLoading = true;
      try {
        const res = await fetch(
          `${JRJ_ADMIN.root}applicants/${this.selectedId}/composite/recompute`,
          {
            method: "POST",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          }
        );
        if (!res.ok) throw new Error("HTTP " + res.status); //!
        const data = await res.json();
        this.snap = data.snapshot;
      } catch (e) {
        alert(e?.message || "Recompute failed."); //!
      } finally {
        this.snapLoading = false;
      }
    },
    pct() {
      return this.snap ? Math.round(this.snap.composite || 0) : 0; //!
    },
    badge() {
      if (!this.snap) return ""; //!
      const s = this.snap.status_flag;
      if (s === "disqualified") return "badge red"; //!
      if (s === "hold") return "badge amber"; //!
      if (s === "provisional") return "badge blue"; //!
      if (s === "pending") return "badge gray"; //!
      return "badge green"; //!
    },
    urlPhysical(r) {
      return `${
        window.location.origin
      }/internal-physical/?applicant_id=${encodeURIComponent(
        r.jamrock_user_id
      )}&applicant_email=${encodeURIComponent(r.email)}&jrj_edit=1`; //!
    },
    urlSkills(r) {
      return `${
        window.location.origin
      }/internal-skills/?applicant_id=${encodeURIComponent(
        r.jamrock_user_id
      )}&applicant_email=${encodeURIComponent(r.email)}&jrj_edit=1`; //!
    },
    urlMedical(r) {
      return `${
        window.location.origin
      }/internal-medical/?applicant_id=${encodeURIComponent(
        r.jamrock_user_id
      )}&applicant_email=${encodeURIComponent(r.email)}&jrj_edit=1`; //!
    },
  },
  mounted() {
    injectApplicantsCss(); // Ensure CSS is present.!
    this.loadList(); //!
  },
  template: `
  <div class="jrj-card">
    <h2>Applicants</h2>
    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="loading">Loading…</div>

    <table class="jrj-table" v-else>
      <thead>
      <tr>
        <th>#</th>
        <th>Name</th>
        <th>Email</th>
        <th>Status</th>
        <th>Score</th>
        <th>Updated</th>
        <th>Composite</th>
        <th>Recruiter/manager</th>
      </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.first_name }} {{ r.last_name }}</td>
          <td>{{ r.email }}</td>
          <td>{{ r.status }}</td>
          <td>{{ r.score_total ?? 0 }}</td>
          <td>{{ r.updated_at }}</td>
          <td><button class="button" @click="showComposite(r.id)">View Composite</button></td>
          <td class="actions">
            <a class="button" :href="urlPhysical(r)" target="_blank">Physical</a>
            <a class="button" :href="urlSkills(r)"   target="_blank">Skills</a>
            <a class="button" :href="urlMedical(r)"  target="_blank">Medical</a>
          </td>
        </tr>
        <tr v-if="!rows.length"><td colspan="8">No applicants.</td></tr>
      </tbody>
    </table>

    <div class="jrj-pagination" v-if="total>perPage">
      <button class="button" :disabled="page===1" @click="page--; loadList()">«</button>
      <span>Page {{ page }}</span>
      <button class="button" :disabled="page*perPage>=total" @click="page++; loadList()">»</button>
    </div>
  </div>

  <div class="jrj-card" v-if="selectedId">
    <h2>Composite — Applicant #{{ selectedId }}</h2>
    <div v-if="snapErr" class="notice error">{{ snapErr }}</div>
    <div v-else-if="snapLoading">Loading…</div>
    <div v-else-if="snap">
      <div class="row items-center">
        <!-- Bind --pct so the donut fills correctly. -->
        <div class="donut" :style="{ '--pct': pct() }"><div class="donut-ring">{{ pct() }}</div></div>
        <div class="ml-16">
          <div class="big">{{ Math.round(snap.composite||0) }}/100 ({{ snap.grade||'?' }})</div>
          <span :class="badge()">{{ snap.status_flag }}</span>
          <div class="muted">Computed: {{ snap.computed_at }} · v{{ snap.formula }}</div>
        </div>
        <div class="spacer"></div>
        <button class="button" @click="recompute">Recompute</button>
      </div>

      <h3>Components</h3>
      <div class="grid">
        <div class="panel" v-for="(comp, key) in snap.components" :key="key">
          <h4 style="text-transform:capitalize">{{ key }}</h4>
          <div>Raw: {{ comp.raw ?? '—' }}</div>
          <div>Normalized: {{ comp.norm ?? '—' }}</div>
          <div v-if="comp.flags && Object.keys(comp.flags).length">Flags: {{ comp.flags }}</div>
          <div class="muted">Updated: {{ comp.ts || '—' }}</div>
        </div>
      </div>
    </div>
    <div v-else class="muted">No composite yet.</div>
  </div>
  `,
};
