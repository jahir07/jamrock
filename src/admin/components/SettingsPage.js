/* global JRJ_ADMIN */
import {
  reactive,
  ref,
  onMounted,
  nextTick,
} from "vue/dist/vue.esm-bundler.js";

export default {
  name: "SettingsPage",
  setup() {
    // Active tab: 'general' | 'composite'.
    const tab = ref("general"); // default general.

    const settings = reactive({
      // General.
      form_id: "",
      api_key: "",
      callback_ok: "",
      set_login_page: "",
      set_assessment_page: "",
      // Composite.
      weights: {
        psymetrics: 40,
        autoproctor: 20,
        physical: 20,
        skills: 20,
        medical: 0,
      },
      bands: { A: 85, B: 70, C: 55, D: 0 },
    });

    const ui = reactive({
      // General status.
      loading: false,
      saving: false,
      notice: "",
      // Composite status.
      compLoading: false,
      compSaving: false,
      compError: "",
      compNotice: "",
    });

    // ------- General load/save -------

    const loadGeneral = async () => {
      ui.loading = true;
      ui.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "settings", {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();

        settings.form_id = data.form_id ?? "";
        settings.api_key = data.api_key ?? "";
        settings.callback_ok = data.callback_ok ?? "";
        settings.set_login_page = data.set_login_page ?? "";
        settings.set_assessment_page = data.set_assessment_page ?? "";

        await nextTick();
      } catch (e) {
        ui.notice = "Failed to load general settings.";
      } finally {
        ui.loading = false;
      }
    };

    const saveGeneral = async () => {
      ui.saving = true;
      ui.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "settings", {
          method: "POST",
          headers: {
            "X-WP-Nonce": JRJ_ADMIN.nonce,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
          body: JSON.stringify({
            form_id: Number(settings.form_id) || 0,
            api_key: settings.api_key || "",
            callback_ok: settings.callback_ok || "",
            set_login_page: settings.set_login_page || "",
            set_assessment_page: settings.set_assessment_page || "",
          }),
        });
        if (!res.ok) {
          let msg = "Save failed.";
          try {
            const j = await res.json();
            if (j && j.message) msg = j.message;
          } catch (_) {}
          ui.notice = msg;
          return;
        }
        ui.notice = "General settings saved.";
      } catch (e) {
        ui.notice = "Network error while saving general settings.";
      } finally {
        ui.saving = false;
      }
    };

    // ------- Composite load/save -------

    const loadCompositeOptions = async () => {
      ui.compLoading = true;
      ui.compError = "";
      ui.compNotice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "composite/options", {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        settings.weights = {
          psymetrics: Number(data.weights?.psymetrics ?? 40),
          autoproctor: Number(data.weights?.autoproctor ?? 20),
          physical: Number(data.weights?.physical ?? 20),
          skills: Number(data.weights?.skills ?? 20),
          medical: Number(data.weights?.medical ?? 0),
        };
        settings.bands = {
          A: Number(data.bands?.A ?? 85),
          B: Number(data.bands?.B ?? 70),
          C: Number(data.bands?.C ?? 55),
          D: Number(data.bands?.D ?? 0),
        };
      } catch (e) {
        ui.compError = "Failed to load composite options.";
      } finally {
        ui.compLoading = false;
      }
    };

    const saveCompositeOptions = async () => {
      ui.compSaving = true;
      ui.compError = "";
      ui.compNotice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "composite/options", {
          method: "POST",
          headers: {
            "X-WP-Nonce": JRJ_ADMIN.nonce,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            weights: settings.weights,
            bands: settings.bands,
          }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        await res.json();
        ui.compNotice = "Composite settings saved.";
      } catch (e) {
        ui.compError = "Failed to save composite settings.";
      } finally {
        ui.compSaving = false;
      }
    };

    // ------- Helpers -------

    const sumWeights = () =>
      Number(settings.weights.psymetrics || 0) +
      Number(settings.weights.autoproctor || 0) +
      Number(settings.weights.physical || 0) +
      Number(settings.weights.skills || 0) +
      Number(settings.weights.medical || 0);

    const resetDefaults = () => {
      settings.weights = {
        psymetrics: 40,
        autoproctor: 20,
        physical: 20,
        skills: 20,
        medical: 0,
      };
      settings.bands = { A: 85, B: 70, C: 55, D: 0 };
    };

    // Load both areas initially so users can switch tabs instantly.
    onMounted(async () => {
      await Promise.all([loadGeneral(), loadCompositeOptions()]);
    });

    return {
      tab,
      settings,
      ui,
      // general
      saveGeneral,
      // composite
      saveCompositeOptions,
      sumWeights,
      resetDefaults,
    };
  },

  template: `
    <div class="jrj-card">
      <!-- Local tabs -->
      <div class="nav-tab-wrapper">
        <button :class="['nav-tab', {'nav-tab-active': tab==='general'}]" @click="tab='general'">
          General
        </button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='composite'}]" @click="tab='composite'">
          Composite
        </button>
      </div>

      <!-- General tab -->
      <div v-if="tab==='general'">
        <p v-if="ui.notice">{{ ui.notice }}</p>

        <form @submit.prevent="saveGeneral">
          <h3>Psymetrics and Gravity Form Settings</h3>
          <table class="form-table striped"><tbody>
            <tr>
              <th><label>Gravity Form ID</label></th>
              <td><input type="number" v-model.number="settings.form_id" /></td>
            </tr>
            <tr>
              <th><label>Set Login page URL</label></th>
              <td><input type="text" v-model="settings.set_login_page" placeholder="/apply-now" /></td>
            </tr>
            <tr>
              <th><label>Set Assessment page URL</label></th>
              <td><input type="text" v-model="settings.set_assessment_page" placeholder="/assessment" /></td>
            </tr>
            <tr>
              <th><label>Psymetrics API Key</label></th>
              <td><input type="text" v-model="settings.api_key" /></td>
            </tr>
            <tr>
              <th><label>Callback URL (webhook)</label></th>
              <td><input type="url" v-model="settings.callback_ok" placeholder="https://..." /></td>
            </tr>
          </tbody></table>

          <p>
            <button type="submit" :disabled="ui.saving" class="button button-primary">
              Save Settings
            </button>
          </p>
        </form>
      </div>

      <!-- Composite tab -->
      <div v-else-if="tab==='composite'">
        <div v-if="ui.compLoading">Loading…</div>
        <div v-else>
          <p v-if="ui.compNotice" class="notice notice-success">{{ ui.compNotice }}</p>
          <p v-if="ui.compError" class="notice notice-error">{{ ui.compError }}</p>

          <h3>Weights (Sum ≈ 100)</h3>
          <table class="form-table striped">
            <tbody>
              <tr>
                <th scope="row"><label>Psymetrics</label></th>
                <td><input type="number" v-model.number="settings.weights.psymetrics" min="0" max="40" class="small-text" /><small> Max 40</small></td>
              </tr>
              <tr>
                <th scope="row"><label>AutoProctor</label></th>
                <td><input type="number" v-model.number="settings.weights.autoproctor" min="0" class="small-text" /></td>
              </tr>
              <tr>
                <th scope="row"><label>Physical</label></th>
                <td><input type="number" v-model.number="settings.weights.physical" min="0" max="20" class="small-text" /> <small> Max 20</small></td>
              </tr>
              <tr>
                <th scope="row"><label>Skills</label></th>
                <td><input type="number" v-model.number="settings.weights.skills" min="0" max="20" class="small-text" /> <small> Max 20</small></td>
              </tr>
              <tr>
                <th scope="row"><label>Medical</label></th>
                <td><input type="number" v-model.number="settings.weights.medical" min="0" max="20" class="small-text" /> <small> Max 20</small></td>
              </tr>
              <tr>
                <th scope="row"><strong>Total</strong></th>
                <td><span class="muted">{{ sumWeights() }}</span></td>
              </tr>
            </tbody>
          </table>

          <h3 class="mt-24">Grade Bands</h3>
          <table class="form-table striped">
            <tbody>
              <tr>
                <th scope="row"><label>A ≥</label></th>
                <td><input type="number" v-model.number="settings.bands.A" min="0" max="100" class="small-text" /></td>
              </tr>
              <tr>
                <th scope="row"><label>B ≥</label></th>
                <td><input type="number" v-model.number="settings.bands.B" min="0" max="100" class="small-text" /></td>
              </tr>
              <tr>
                <th scope="row"><label>C ≥</label></th>
                <td><input type="number" v-model.number="settings.bands.C" min="0" max="100" class="small-text" /></td>
              </tr>
              <tr>
                <th scope="row"><label>D ≥</label></th>
                <td><input type="number" v-model.number="settings.bands.D" min="0" max="100" class="small-text" disabled /></td>
              </tr>
            </tbody>
          </table>

          <p class="submit">
            <button class="button button-primary" :disabled="ui.compSaving" @click="saveCompositeOptions">
              Save Composite Settings
            </button>
            <button type="button" class="button" @click="resetDefaults">
              Reset Defaults
            </button>
          </p>
        </div>
      </div>
    </div>
  `,
};
