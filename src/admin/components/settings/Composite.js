/* global JRJ_ADMIN */
import { reactive, onMounted } from "vue/dist/vue.esm-bundler.js";

export default {
  name: "CompositeSettings",
  setup() {
    const state = reactive({
      weights: {
        psymetrics: 40,
        autoproctor: 20,
        physical: 20,
        skills: 20,
        medical: 0,
      },
      bands: { A: 85, B: 70, C: 55, D: 0 },
      loading: false,
      saving: false,
      error: "",
      notice: "",
    });

    const load = async () => {
      state.loading = true;
      state.error = "";
      state.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "composite/options", {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        state.weights = {
          psymetrics: Number(data.weights?.psymetrics ?? 40),
          autoproctor: Number(data.weights?.autoproctor ?? 20),
          physical: Number(data.weights?.physical ?? 20),
          skills: Number(data.weights?.skills ?? 20),
          medical: Number(data.weights?.medical ?? 0),
        };
        state.bands = {
          A: Number(data.bands?.A ?? 85),
          B: Number(data.bands?.B ?? 70),
          C: Number(data.bands?.C ?? 55),
          D: Number(data.bands?.D ?? 0),
        };
      } catch {
        state.error = "Failed to load composite options.";
      } finally {
        state.loading = false;
      }
    };

    const save = async () => {
      state.saving = true;
      state.error = "";
      state.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "composite/options", {
          method: "POST",
          headers: {
            "X-WP-Nonce": JRJ_ADMIN.nonce,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ weights: state.weights, bands: state.bands }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        await res.json();
        state.notice = "Composite settings saved.";
      } catch {
        state.error = "Failed to save composite settings.";
      } finally {
        state.saving = false;
      }
    };

    const sumWeights = () =>
      Number(state.weights.psymetrics || 0) +
      Number(state.weights.autoproctor || 0) +
      Number(state.weights.physical || 0) +
      Number(state.weights.skills || 0) +
      Number(state.weights.medical || 0);

    const resetDefaults = () => {
      state.weights = {
        psymetrics: 40,
        autoproctor: 20,
        physical: 20,
        skills: 20,
        medical: 0,
      };
      state.bands = { A: 85, B: 70, C: 55, D: 0 };
    };

    onMounted(load);

    return { state, save, sumWeights, resetDefaults };
  },

  template: `
    <div>
      <div v-if="state.loading">Loading…</div>
      <div v-else>
        <p v-if="state.notice" class="notice notice-success">{{ state.notice }}</p>
        <p v-if="state.error" class="notice notice-error">{{ state.error }}</p>

        <h3>Weights (Sum ≈ 100)</h3>
        <table class="form-table striped"><tbody>
          <tr><th>Psymetrics</th><td><input type="number" v-model.number="state.weights.psymetrics" min="0" max="40" class="small-text" /> <small>Max 40</small></td></tr>
          <tr><th>AutoProctor</th><td><input type="number" v-model.number="state.weights.autoproctor" min="0" class="small-text" /></td></tr>
          <tr><th>Physical</th><td><input type="number" v-model.number="state.weights.physical" min="0" max="20" class="small-text" /> <small>Max 20</small></td></tr>
          <tr><th>Skills</th><td><input type="number" v-model.number="state.weights.skills" min="0" max="20" class="small-text" /> <small>Max 20</small></td></tr>
          <tr><th>Medical</th><td><input type="number" v-model.number="state.weights.medical" min="0" max="20" class="small-text" /> <small>Max 20</small></td></tr>
          <tr><th><strong>Total</strong></th><td><span class="muted">{{ sumWeights() }}</span></td></tr>
        </tbody></table>

        <h3 class="mt-24">Grade Bands</h3>
        <table class="form-table striped"><tbody>
          <tr><th>A ≥</th><td><input type="number" v-model.number="state.bands.A" min="0" max="100" class="small-text" /></td></tr>
          <tr><th>B ≥</th><td><input type="number" v-model.number="state.bands.B" min="0" max="100" class="small-text" /></td></tr>
          <tr><th>C ≥</th><td><input type="number" v-model.number="state.bands.C" min="0" max="100" class="small-text" /></td></tr>
          <tr><th>D ≥</th><td><input type="number" v-model.number="state.bands.D" min="0" max="100" class="small-text" disabled /></td></tr>
        </tbody></table>

        <p class="submit">
          <button class="button button-primary" :disabled="state.saving" @click="save">Save Composite Settings</button>
          <button type="button" class="button" @click="resetDefaults">Reset Defaults</button>
        </p>
      </div>
    </div>
  `,
};
