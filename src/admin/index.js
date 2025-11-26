import {
	createApp,
	ref,
	onMounted,
	onBeforeUnmount,
} from 'vue/dist/vue.esm-bundler.js';
import './index.scss';

import Dashboard from './components/Dashboard.js';
import SettingsPage from "./components/SettingsPage.js";
import ApplicantsWithComposite from "./components/ApplicantsWithComposite.js";
import AssessmentsList from './components/AssessmentsList.js';
import CoursesList from './components/CoursesList.js';
import HousingList from "./components/HousingList.js";
import LogsList from './components/LogsList.js';


const InfoPage = {
	template: `
		<div class="jrj-card">
			<h2>Info & Shortcodes</h2>
			<p>Use these shortcodes in pages/posts:</p>
			<ul>
				<li><code>[jamrock_learndash_dashboard]</code> — renders the jamrock_learndash_dashboard</li>
				<li><code>[jamrock_form]</code> — renders the feedback form</li>
				<li><code>[jamrock_results]</code> — list results (admins only)</li>
			</ul>
			<p>Blocks are also available in the editor: <strong>Feedback Form</strong> and <strong>Feedback Result</strong>.</p>
		</div>
	`,
};

const allowedTabs = [
  "dashboard",
  "settings",
  "courses",
  "housing",
  "applicantswithcomposite",
  "assessments",
  "logs",
  "info",
];

function readTabFromUrl() {
	const u = new URL( window.location.href );
	const v = u.searchParams.get( 'view' );
	return allowedTabs.includes( v ) ? v : null;
}

function writeTabToUrl( tab ) {
	const u = new URL( window.location.href );
	u.searchParams.set( 'view', tab );
	history.replaceState( null, '', u.toString() );
}

const App = {
  components: {
    Dashboard,
    SettingsPage,
    CoursesList,
    HousingList,
    ApplicantsWithComposite,
    AssessmentsList,
    LogsList,
    InfoPage,
  },
  setup() {
    // 1) PHP to __JAMROCK_BOOT_TAB -> URL ? 'settings' (default)
    const boot =
      window.__JAMROCK_BOOT_TAB &&
      allowedTabs.includes(window.__JAMROCK_BOOT_TAB)
        ? window.__JAMROCK_BOOT_TAB
        : readTabFromUrl() || "settings";

    const tab = ref(boot);

    // URL sync (initial render + later changes)
    writeTabToUrl(tab.value);

    const setTab = (next) => {
      if (!allowedTabs.includes(next)) return;
      tab.value = next;
      writeTabToUrl(next);
    };

    const onPopState = () => {
      const fromUrl = readTabFromUrl();
      if (fromUrl && fromUrl !== tab.value) {
        tab.value = fromUrl;
      }
    };

    onMounted(() => {
      window.addEventListener("popstate", onPopState);
    });
    onBeforeUnmount(() => {
      window.removeEventListener("popstate", onPopState);
    });

    return { tab, setTab };
  },
  template: `
    <div class="wrap jrj-admin">
      <h1 class="wp-heading-inline">Jamrock</h1>
      <h2 class="nav-tab-wrapper">
        <button :class="['nav-tab', {'nav-tab-active': tab==='dashboard'}]"    @click.prevent="setTab('dashboard')">Dashboard</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='settings'}]"    @click.prevent="setTab('settings')">Settings</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='courses'}]"     @click.prevent="setTab('courses')">Courses</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='applicantswithcomposite'}]" @click.prevent="setTab('applicantswithcomposite')">Applicants</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='assessments'}]"  @click.prevent="setTab('assessments')">Assessments</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='housing'}]"  @click.prevent="setTab('housing')">Housing/Rental</button>
		    <button :class="['nav-tab', {'nav-tab-active': tab==='logs'}]"        @click.prevent="setTab('logs')">Logs</button>
        <button :class="['nav-tab', {'nav-tab-active': tab==='info'}]"        @click.prevent="setTab('info')">Info</button>
      </h2>

      <Dashboard       v-if="tab==='dashboard'" />
      <SettingsPage    v-else-if="tab==='settings'" />
      <CoursesList     v-else-if="tab==='courses'" />
      <ApplicantsWithComposite  v-else-if="tab==='applicantswithcomposite'" />
      <AssessmentsList v-else-if="tab==='assessments'" />
      <HousingList v-else-if="tab==='housing'" />
      <LogsList        v-else-if="tab==='logs'" />
      <InfoPage        v-else />
    </div>
  `,
};

document.addEventListener( 'DOMContentLoaded', () => {
	const el = document.getElementById( 'jamrock-admin-app' );
	if ( el ) {
		createApp( App ).mount( el );
	}
} );
