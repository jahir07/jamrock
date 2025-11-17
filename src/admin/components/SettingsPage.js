import { ref } from "vue/dist/vue.esm-bundler.js";
import GeneralSettings from "./settings/General.js";
import CompositeSettings from "./settings/Composite.js";
import AutoproctorSettings from "./settings/Autoproctor.js";

export default {
  name: "SettingsPage",
  components: { GeneralSettings, CompositeSettings, AutoproctorSettings },
  setup() {
    const tab = ref("general");
    return { tab };
  },
  template: `
    <div class="jrj-card">
      <div class="nav-tab-wrapper">
        <button :class="['nav-tab', {'nav-tab-active': tab==='general'}]" @click="tab='general'">General</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='composite'}]" @click="tab='composite'">Composite</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='autoproctor'}]" @click="tab='autoproctor'">Autoproctor</button>
      </div>

      <div v-if="tab==='general'"><GeneralSettings /></div>
      <div v-else-if="tab==='composite'"><CompositeSettings /></div>
      <div v-else-if="tab==='autoproctor'"><AutoproctorSettings /></div>
    </div>
  `,
};
