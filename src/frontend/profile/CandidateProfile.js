/* global JRJ_ADMIN */
import { createApp, ref, reactive, onMounted, computed } from "vue"; // use 'vue' for bundlers
import HousingForm from "./HousingApplicationForm.js";
import ExtensionForm from "./PaymentExtensionForm.js";
import MedicalForm from "./MedicalAffidavit.js";

const CandidateProfile = {
  name: "CandidateProfile",
  props: { userId: { type: [String, Number], default: "" } },
  components: { HousingForm, ExtensionForm, MedicalForm },
  setup(props) {
    const loading = ref(true);
    const error = ref("");
    const currentApp = ref(null);
    const items = ref([]);

    const profile = reactive({
      id: null,
      display_name: "",
      name: "",
      email: "",
      avatar: "",
      courses_count: 0,
      completed_count: 0,
      certificates_count: 0,
      points: 0,
      courses: [],
    });

    const activeTab = ref("overview");

    // helper - safe parse payment_extension which might be string or object
    function parsePaymentExtension(src) {
      if (!src) return {};
      if (typeof src === "object") return src;
      try {
        return JSON.parse(src);
      } catch (e) {
        return {};
      }
    }

    // computed: whether we should show Extension agreement tab
    // checks currentApp first, then items array for any enabled extension
    const hasExtension = computed(() => {
      // check current application
      const ext1 = currentApp.value?.extension_enabled;

      if (ext1 && Number(ext1) === 1) return true;

      // fallback: check items list (if populated elsewhere)
      if (Array.isArray(items.value) && items.value.length > 0) {
        for (const r of items.value) {
          const ex = parsePaymentExtension(r?.payment_extension);
          if (ex && Number(ex.extension_enabled) === 1) return true;
        }
      }

      return false;
    });

    const profileLoad = async () => {
      loading.value = true;
      error.value = "";
      try {
        const mountEl = document.getElementById("jrj-candidate-profile");
        const mountedUserId =
          props.userId || (mountEl && mountEl.dataset.userId) || "me";
        const idForUrl = mountedUserId || "me";
        const url = `${JRJ_ADMIN.root}profile/${encodeURIComponent(idForUrl)}`;
        const res = await fetch(url, {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "No profile");
        const p = json.profile || json.user || {};

        // normalize into profile object
        profile.id = p.id ?? p.ID ?? p.user_id ?? null;
        profile.display_name = p.display_name ?? p.name ?? p.user_name ?? "";
        profile.name = p.name ?? p.display_name ?? p.user_name ?? "";
        profile.email = p.email ?? p.user_email ?? "";
        profile.avatar = p.avatar ?? p.avatar_url ?? "";
        profile.courses_count = Number(p.courses_count ?? p.courses_total ?? 0);
        profile.completed_count = Number(p.completed_count ?? 0);
        profile.certificates_count = Number(p.certificates_count ?? 0);
        profile.points = Number(p.points ?? 0);
        profile.courses = Array.isArray(p.courses) ? p.courses : [];
      } catch (e) {
        error.value = e.message || "Failed to load profile";
      } finally {
        loading.value = false;
      }
    };

    async function loadCurrent() {
      loading.value = true;
      try {
        const url = JRJ_ADMIN.root + "housing/current";
        const res = await fetch(url, {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "no data");
        currentApp.value = json.application || null;
      } catch (e) {
        // ignore or set error
        // console.warn('loadCurrent', e);
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => {
      profileLoad();
      loadCurrent();
      // if you need to fetch items list, do it here (optional)
      // loadItems();
    });

    const setTab = (t) => (activeTab.value = t);

    // computed userId to pass into child components (props.userId or profile.id)
    const userId = computed(() => props.userId || profile.id || "");

    return {
      loading,
      loadCurrent,
      error,
      profile,
      activeTab,
      setTab,
      // returned so template can check
      currentApp,
      items,
      parsePaymentExtension,
      hasExtension,
      // child user-id
      userId,
    };
  },

  template: `
  <div class="jrj-candidate-profile flex min-h-screen bg-[#F7F7F7] font-sans text-[#000000]">
    
    <aside class="sticky top-0 h-screen w-20 lg:w-72 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col transition-all duration-300 z-20">
      
      <div class="p-6 border-b border-gray-100 flex flex-col items-center text-center">
        <div class="w-10 h-10 lg:w-20 lg:h-20 rounded-full p-0.5 border-2 border-[#E8A674] mb-2 lg:mb-4 transition-all duration-300">
          <img v-if="profile.avatar" :src="profile.avatar" alt="avatar" class="w-full h-full rounded-full object-cover" />
          <div v-else class="w-full h-full rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
            <i class="fa-solid fa-user text-sm lg:text-2xl"></i>
          </div>
        </div>
        <div class="hidden lg:block">
          <h2 class="font-bold text-lg text-black truncate px-2">{{ profile.display_name }}</h2>
          <p class="text-xs text-[#666666] truncate px-2">{{ profile.email }}</p>
        </div>
      </div>

      <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
        
        <button @click="setTab('overview')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'overview' ? 'bg-[#E8A674]/10 text-black' : 'text-[#666666] hover:bg-gray-50 hover:text-black'"
          title="Overview">
          
          <span class="flex-shrink-0 transition-colors duration-200" :class="activeTab === 'overview' ? 'text-[#E8A674]' : 'text-gray-400 group-hover:text-[#E8A674]'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
          </span>
          
          <span class="hidden lg:block">Overview</span>
          
          <div v-if="activeTab === 'overview'" class="hidden lg:block ml-auto w-1.5 h-1.5 rounded-full bg-[#E8A674]"></div>
        </button>

        <button @click="setTab('housing')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'housing' ? 'bg-[#E8A674]/10 text-black' : 'text-[#666666] hover:bg-gray-50 hover:text-black'"
          title="Housing Application">
          
          <span class="flex-shrink-0 transition-colors duration-200" :class="activeTab === 'housing' ? 'text-[#E8A674]' : 'text-gray-400 group-hover:text-[#E8A674]'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
          </span>
          
          <span class="hidden lg:block">Housing Application</span>
          <div v-if="activeTab === 'housing'" class="hidden lg:block ml-auto w-1.5 h-1.5 rounded-full bg-[#E8A674]"></div>
        </button>

        <button v-if="hasExtension" @click="setTab('extension_agreement')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'extension_agreement' ? 'bg-red-50 text-red-600' : 'text-[#666666] hover:bg-red-50 hover:text-red-600'"
          title="Extension Agreement">
          
          <span class="flex-shrink-0 transition-colors duration-200" :class="activeTab === 'extension_agreement' ? 'text-red-600' : 'text-gray-400 group-hover:text-red-500'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          </span>
          
          <span class="hidden lg:block">Extension Agreement</span>
          <span v-if="!activeTab === 'extension_agreement'" class="hidden lg:block ml-auto w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
        </button>

        <button @click="setTab('medical')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'medical' ? 'bg-[#E8A674]/10 text-black' : 'text-[#666666] hover:bg-gray-50 hover:text-black'"
          title="Medical Forms">
          
          <span class="flex-shrink-0 transition-colors duration-200" :class="activeTab === 'medical' ? 'text-[#E8A674]' : 'text-gray-400 group-hover:text-[#E8A674]'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          </span>
          
          <span class="hidden lg:block">Medical Forms</span>
          <div v-if="activeTab === 'medical'" class="hidden lg:block ml-auto w-1.5 h-1.5 rounded-full bg-[#E8A674]"></div>
        </button>

      </nav>
    </aside>

    <main class="flex-1 w-0 p-4 lg:p-6 overflow-y-auto">
      
      <div v-if="loading" class="flex flex-col items-center justify-center h-64 text-[#666666]">
        <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-[#E8A674]"></i>
        <p>Loading profile...</p>
      </div>
      
      <div v-else-if="error" class="bg-red-50 border border-red-200 p-6 rounded-lg shadow-sm text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-500 mb-3">
            <i class="fa-solid fa-triangle-exclamation text-xl"></i>
        </div>
        <h3 class="text-lg font-semibold text-red-700">Error Loading Profile</h3>
        <p class="text-sm text-red-600 mt-1">{{ error }}</p>
      </div>

      <div v-else>
        
        <div v-if="activeTab === 'overview'" class="space-y-8 fade-in">
          
          <div class="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 pb-6">
            <div>
                <h1 class="text-3xl font-bold text-black tracking-tight">Overview</h1>
                <p class="text-[#666666] mt-2 text-lg">Welcome back, {{ profile.display_name }}</p>
            </div>
            <div class="mt-4 md:mt-0">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#E8A674]/10 text-[#E8A674]">
                    Student Portal
                </span>
            </div>
          </div>

          <div v-if="hasExtension" class="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 shadow-sm">
            <i class="fa-solid fa-bell text-amber-500 mt-1"></i>
            <div>
              <h4 class="font-bold text-amber-900 text-sm">Action Required</h4>
              <p class="text-sm text-amber-800 mt-1">Please submit your <button @click="setTab('extension_agreement')" class="underline font-medium hover:text-amber-950">Payment Extension Agreement</button> file.</p>
            </div>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div class="bg-white p-6 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 text-center group hover:border-[#E8A674]/30 transition-all duration-300">
              <div class="text-4xl font-bold text-black mb-2 group-hover:text-[#E8A674] transition-colors">{{ profile.courses_count }}</div>
              <div class="text-xs font-semibold text-[#666666] uppercase tracking-widest">Courses</div>
            </div>
            <div class="bg-white p-6 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 text-center group hover:border-[#E8A674]/30 transition-all duration-300">
              <div class="text-4xl font-bold text-black mb-2 group-hover:text-[#E8A674] transition-colors">{{ profile.completed_count }}</div>
              <div class="text-xs font-semibold text-[#666666] uppercase tracking-widest">Completed</div>
            </div>
            <div class="bg-white p-6 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 text-center group hover:border-[#E8A674]/30 transition-all duration-300">
              <div class="text-4xl font-bold text-black mb-2 group-hover:text-[#E8A674] transition-colors">{{ profile.certificates_count }}</div>
              <div class="text-xs font-semibold text-[#666666] uppercase tracking-widest">Certificates</div>
            </div>
            <div class="bg-white p-6 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 text-center group hover:border-[#E8A674]/30 transition-all duration-300">
              <div class="text-4xl font-bold text-black mb-2 group-hover:text-[#E8A674] transition-colors">{{ profile.points }}</div>
              <div class="text-xs font-semibold text-[#666666] uppercase tracking-widest">Points</div>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div class="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
              <h3 class="font-bold text-gray-800 text-lg">Enrolled Courses</h3>
            </div>
            
            <div v-if="!profile.courses || profile.courses.length === 0" class="p-12 text-center text-gray-400">
              <i class="fa-solid fa-book-open text-4xl mb-3 opacity-20"></i>
              <p>No active courses found.</p>
            </div>
            
            <div v-else class="divide-y divide-gray-100">
              <div v-for="c in profile.courses" :key="c.id" class="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#FAFAFA] transition-colors">
                
                <div class="flex items-center gap-5">
                  <div class="relative w-12 h-12 flex-shrink-0">
                    <svg class="w-full h-full" viewBox="0 0 36 36">
                      <path class="text-gray-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" stroke-width="3" />
                      <path class="text-[#E8A674] transition-all duration-1000 ease-out" 
                            :stroke-dasharray="100" 
                            :stroke-dashoffset="100 - Math.max(0, Math.min(100, c.progress_percent))"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                            fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
                    </svg>
                    <div class="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-black">
                      {{ Math.round(c.progress_percent) }}%
                    </div>
                  </div>

                  <div>
                    <a :href="c.permalink" target="_blank" class="font-bold text-gray-900 hover:text-[#E8A674] text-lg decoration-0 transition-colors">{{ c.title }}</a>
                    <div class="flex items-center gap-4 text-sm mt-1.5">
                      <span v-if="c.status === 'completed'" class="text-emerald-600 flex items-center gap-1.5 font-medium">
                        <i class="fa-solid fa-circle-check"></i> Completed
                      </span>
                      <span v-else class="text-[#E8A674] flex items-center gap-1.5 font-medium">
                        <i class="fa-solid fa-spinner"></i> In Progress
                      </span>
                      
                      <a v-if="c.certificate_url" :href="c.certificate_url" target="_blank" class="text-gray-500 hover:text-black flex items-center gap-1.5 transition-colors">
                        <i class="fa-solid fa-award"></i> Certificate
                      </a>
                    </div>
                  </div>
                </div>

                <a :href="c.permalink" target="_blank" class="px-6 py-2.5 bg-white border border-gray-300 text-black rounded-lg text-sm font-semibold hover:border-[#E8A674] hover:text-[#E8A674] transition-all shadow-sm text-center whitespace-nowrap">
                  Continue
                </a>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab==='housing'" class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 fade-in">
          <HousingForm :user-id="userId" />
        </div>

        <div v-if="activeTab==='extension_agreement'" class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 fade-in">
          <ExtensionForm :user-id="userId" />
        </div>

        <div v-if="activeTab==='medical'" class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 fade-in">
          <MedicalForm :user-id="userId" />
        </div>

      </div>
    </main>
  </div>
  `,
};

// mount
document.addEventListener("DOMContentLoaded", function () {
  const mount = document.getElementById("jrj-candidate-profile");
  if (mount) {
    const userId = mount.dataset.userId || "";
    createApp(CandidateProfile, { userId }).mount(mount);
  }
});
