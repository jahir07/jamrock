/* global JRJ_ADMIN */
import { reactive, onMounted, nextTick } from "vue/dist/vue.esm-bundler.js";

export default {
  name: "GeneralSettings",
  setup() {
    const state = reactive({
      form_id: "",
      api_key: "",
      callback_ok: "",
      set_login_page: "",
      set_assessment_page: "",
      loading: false,
      saving: false,
      notice: "",
    });

    const load = async () => {
      state.loading = true;
      state.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "settings", {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        state.form_id = data.form_id ?? "";
        state.api_key = data.api_key ?? "";
        state.callback_ok = data.callback_ok ?? "";
        state.set_login_page = data.set_login_page ?? "";
        state.set_assessment_page = data.set_assessment_page ?? "";
        await nextTick();
      } catch {
        state.notice = "Failed to load general settings.";
      } finally {
        state.loading = false;
      }
    };

    const save = async () => {
      state.saving = true;
      state.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "settings", {
          method: "POST",
          headers: {
            "X-WP-Nonce": JRJ_ADMIN.nonce,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
          body: JSON.stringify({
            form_id: Number(state.form_id) || 0,
            api_key: state.api_key || "",
            callback_ok: state.callback_ok || "",
            set_login_page: state.set_login_page || "",
            set_assessment_page: state.set_assessment_page || "",
          }),
        });
        if (!res.ok) {
          let msg = "Save failed.";
          try {
            const j = await res.json();
            if (j?.message) msg = j.message;
          } catch {}
          state.notice = msg;
          return;
        }
        state.notice = "General settings saved.";
      } catch {
        state.notice = "Network error while saving general settings.";
      } finally {
        state.saving = false;
      }
    };

    onMounted(load);

    return { state, save };
  },

  template: `
    <div>
      <p v-if="state.notice">{{ state.notice }}</p>
      <div v-if="state.loading">Loading…</div>
      <form v-else @submit.prevent="save">
        <h3>Psymetrics and Gravity Form Settings</h3>
        <table class="form-table striped"><tbody>
          <tr><th><label>Gravity Form ID</label></th><td><input type="number" v-model.number="state.form_id" /></td></tr>
          <tr><th><label>Set Login page URL</label></th><td><input type="text" v-model="state.set_login_page" placeholder="/apply-now" /></td></tr>
          <tr><th><label>Set Assessment page URL</label></th><td><input type="text" v-model="state.set_assessment_page" placeholder="/assessment" /></td></tr>
          <tr><th><label>Psymetrics API Key</label></th><td><input type="password" v-model="state.api_key" /></td></tr>
          <tr><th><label>Callback URL (webhook)</label></th><td><input type="url" v-model="state.callback_ok" placeholder="https://..." /></td></tr>
        </tbody></table>
        <p><button type="submit" :disabled="state.saving" class="button button-primary">Save Settings</button></p>
      </form>
    </div>
  `,
};