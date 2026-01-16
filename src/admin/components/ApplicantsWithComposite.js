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
        if (!res.ok) throw new Error("HTTP " + res.status); 
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
        if (!res.ok) throw new Error("HTTP " + res.status); 
        this.snap = await res.json();
      } catch (e) {
        this.snapErr = e?.message || "Failed to load composite.";
      } finally {
        this.snapLoading = false;
      }
    },
    async recompute() {
      if (!this.selectedId) return; 
      this.snapLoading = true;
      try {
        const res = await fetch(
          `${JRJ_ADMIN.root}applicants/${this.selectedId}/composite/recompute`,
          {
            method: "POST",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          }
        );
        if (!res.ok) throw new Error("HTTP " + res.status); 
        const data = await res.json();
        this.snap = data.snapshot;
      } catch (e) {
        alert(e?.message || "Recompute failed."); 
      } finally {
        this.snapLoading = false;
      }
    },
    pct() {
      return this.snap ? Math.round(this.snap.composite || 0) : 0; 
    },
    badge() {
      if (!this.snap) return ""; 
      const s = this.snap.status_flag;
      if (s === "disqualified") return "badge red"; 
      if (s === "hold") return "badge amber"; 
      if (s === "provisional") return "badge blue"; 
      if (s === "pending") return "badge gray"; 
      return "badge green"; 
    },
    urlPhysical(r) {
      return `${
        window.location.origin
      }/internal-physical/?applicant_id=${encodeURIComponent(
        r.jamrock_user_id
      )}&applicant_email=${encodeURIComponent(r.email)}&jrj_edit=1`; 
    },
    urlSkills(r) {
      return `${
        window.location.origin
      }/internal-skills/?applicant_id=${encodeURIComponent(
        r.jamrock_user_id
      )}&applicant_email=${encodeURIComponent(r.email)}&jrj_edit=1`; 
    },
    urlMedical(r) {
      return `${
        window.location.origin
      }/internal-medical/?applicant_id=${encodeURIComponent(
        r.jamrock_user_id
      )}&applicant_email=${encodeURIComponent(r.email)}&jrj_edit=1`; 
    },
  },
  mounted() {
    this.loadList(); 
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
            <!-- <a class="button" :href="urlMedical(r)"  target="_blank">Medical</a> -->
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
