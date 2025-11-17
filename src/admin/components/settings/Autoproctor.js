/* global JRJ_ADMIN */
import { reactive, onMounted } from "vue/dist/vue.esm-bundler.js";

export default {
  name: "AutoproctorSettings",
  setup() {
    const state = reactive({
      api_id: "",
      api_key: "",
      defaults: { enable: false },
      loading: false,
      saving: false,
      testing: false,
      notice: "",
      error: "",
      testResult: "",
      testing: false,
      testResult: "",
      connected: false,
    });

    const load = async () => {
      state.loading = true;
      state.error = "";
      state.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "autoproctor/options", {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        state.api_id = data.api_id ?? "";
        state.api_key = data.api_key ?? "";
        state.defaults = {
          enable: !!data.defaults?.enable,
        };
      } catch {
        state.error = "Failed to load AutoProctor settings.";
      } finally {
        state.loading = false;
      }
    };

    const save = async () => {
      state.saving = true;
      state.error = "";
      state.notice = "";
      try {
        const res = await fetch(JRJ_ADMIN.root + "autoproctor/options", {
          method: "POST",
          headers: {
            "X-WP-Nonce": JRJ_ADMIN.nonce,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_id: state.api_id,
            api_key: state.api_key,
            webhook_secret: state.webhook_secret,
            defaults: state.defaults,
          }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        await res.json();
        state.notice = "AutoProctor settings saved.";
      } catch {
        state.error = "Failed to save AutoProctor settings.";
      } finally {
        state.saving = false;
      }
    };

    // optional: connection test endpoint
    const testConnection = async () => {
      state.testing = true;
      state.testResult = "";
      state.connected = false;
      try {
        const res = await fetch(JRJ_ADMIN.root + "autoproctor/test", {
          method: "GET",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        const j = await res.json().catch(() => ({}));

        if (res.ok && j.ok) {
          state.testResult = "Connection OK";
          setTimeout(() => {
            state.connected = true;
            localStorage.setItem("jrj_ap_connected", "1");
            state.testResult = "";
          }, 2500);
        } else {
          state.testResult = j.error || j.message || "Test failed ❌";
        }
      } catch (e) {
        state.testResult = "Network error";
      } finally {
        state.testing = false;
      }
    };

    onMounted(() => {
      if (localStorage.getItem("jrj_ap_connected") === "1") {
        state.connected = true;
      }
    });

    onMounted(load);

    return { state, save, testConnection };
  },

  template: `
    <div>
      <div v-if="state.loading">Loading…</div>
      <div v-else>
        <p v-if="state.notice" class="notice notice-success">{{ state.notice }}</p>
        <p v-if="state.error" class="notice notice-error">{{ state.error }}</p>

        <h3>Connection</h3>
        <table class="form-table striped"><tbody>
          <tr><th>Client ID</th><td><input type="password" v-model="state.api_id" class="regular-text" /></td></tr>
          <tr><th>Client Secret Key</th><td><input type="password" v-model="state.api_key" class="regular-text" /></td></tr>
        </tbody></table>
        
        <div class="ap-connection">
          <button class="button" :disabled="state.testing" @click="testConnection">
            {{ state.testing ? 'Testing…' : state.connected ? 'Reconnect' : 'Test Connection' }}
          </button>

          <!-- Status text -->
          <span v-if="state.testResult" style="margin-left:8px">
            {{ state.testResult }}
          </span>

          <!-- Connected indicator -->
          <span v-else-if="state.connected" style="margin-left:10px; display:inline-flex; align-items:center;">
            <span
              style="
                width:10px;
                height:10px;
                background-color:#22c55e;
                border-radius:50%;
                margin-right:6px;
                display:inline-block;
              "
            ></span>
            Connected
          </span>
        </div>

        <div v-if="state.connected">
        <h3>Default Proctoring Options</h3>
          <table class="form-table striped">
            <tbody>
              <tr>
                <th>Enable Autoproctor</th>
                <td><label><input type="checkbox" v-model="state.defaults.enable" /> Enable Autoproctor (LearnDash Quiz)</label></td>
              </tr>
            </tbody>
          </table>
        </div>

        <p><button class="button button-primary" :disabled="state.saving" @click="save">Save</button></p>
      </div>
    </div>
  `,
};
