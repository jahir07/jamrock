/* global JRJ_ADMIN */
import { createApp, ref, reactive, onMounted, computed } from "vue"; 
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

    // --- Profile Data ---
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

    // --- Edit Profile State ---
    const showEditModal = ref(false);
    const isSaving = ref(false);
    const editForm = reactive({
        display_name: "",
        password: "",
        confirm_password: ""
    });
    
    // Image Upload State
    const selectedFile = ref(null);
    const previewAvatar = ref("");

    // --- Notification System ---
    const notification = reactive({
        show: false,
        message: "",
        isError: false
    });

    const showNotification = (msg, isError = false) => {
        notification.message = msg;
        notification.isError = isError;
        notification.show = true;
        setTimeout(() => {
            notification.show = false;
        }, 3000);
    };

    // Helper: Parse Extension
    function parsePaymentExtension(src) {
      if (!src) return {};
      if (typeof src === "object") return src;
      try {
        return JSON.parse(src);
      } catch (e) {
        return {};
      }
    }

    const hasExtension = computed(() => {
      const ext1 = parsePaymentExtension(
        currentApp.value?.payment_extension
      ).show_candidate;
      return ext1 && Number(ext1) === 1;
    });

    // --- Load Profile ---
    const profileLoad = async () => {
      loading.value = true;
      error.value = "";
      try {
        const mountEl = document.getElementById("jrj-candidate-profile");
        const mountedUserId = props.userId || (mountEl && mountEl.dataset.userId) || "me";
        const idForUrl = mountedUserId || "me";
        
        const apiRoot = JRJ_ADMIN.root.endsWith('/') ? JRJ_ADMIN.root : JRJ_ADMIN.root + '/';
        const url = `${apiRoot}profile/${encodeURIComponent(idForUrl)}`;

        const res = await fetch(url, {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();        
        if (!json.ok) throw new Error(json.error || "No profile");
        const p = json.profile || json.user || {};
        console.log(p);

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

    // --- Load Current Housing ---
    async function loadCurrent() {
      loading.value = true;
      try {
        const apiRoot = JRJ_ADMIN.root.endsWith('/') ? JRJ_ADMIN.root : JRJ_ADMIN.root + '/';
        const url = apiRoot + "housing/current";
        const res = await fetch(url, {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "no data");
        currentApp.value = json.application || null;
      } catch (e) {
         // console.warn('loadCurrent', e);
      } finally {
        loading.value = false;
      }
    }

    // --- Edit Modal Logic ---
    const openEditModal = () => {
        editForm.display_name = profile.display_name;
        editForm.password = "";
        editForm.confirm_password = "";
        
        // Reset image states
        selectedFile.value = null;
        previewAvatar.value = profile.avatar; // Start with current avatar
        
        showEditModal.value = true;
    };

    // Handle File Selection
    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            selectedFile.value = file;
            // Create preview URL
            previewAvatar.value = URL.createObjectURL(file);
        }
    };

    // --- Save Profile (Updated for FormData) ---
    const saveProfile = async () => {
        if (editForm.password && editForm.password !== editForm.confirm_password) {
            showNotification("Passwords do not match!", true);
            return;
        }

        isSaving.value = true;
        try {
            const apiRoot = JRJ_ADMIN.root.endsWith('/') ? JRJ_ADMIN.root : JRJ_ADMIN.root + '/';
            const url = apiRoot + "profile/update";

            // Use FormData for file upload
            const formData = new FormData();
            formData.append('display_name', editForm.display_name);
            
            if (editForm.password) {
                formData.append('password', editForm.password);
            }
            
            if (selectedFile.value) {
                formData.append('profile_image', selectedFile.value);
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: { 
                    "X-WP-Nonce": JRJ_ADMIN.nonce
                },
                body: formData,
                credentials: "same-origin",
            });

            const json = await res.json();
            
            if (json.success) {
                // Update local profile data
                profile.display_name = editForm.display_name;
                
                // If API returns the new avatar URL, update it
                if (json.new_avatar_url) {
                    profile.avatar = json.new_avatar_url;
                } else if (selectedFile.value) {
                     // Fallback: show local preview until refresh
                    profile.avatar = previewAvatar.value;
                }

                showEditModal.value = false;
                showNotification("Profile updated successfully!");
                
            } else {
                throw new Error(json.message || "Update failed");
            }
        } catch (e) {
            console.error(e);
            showNotification(e.message || "Something went wrong", true);
        } finally {
            isSaving.value = false;
        }
    };

    onMounted(() => {
      profileLoad();
      loadCurrent();
    });

    const setTab = (t) => (activeTab.value = t);
    const userId = computed(() => props.userId || profile.id || "");

    return {
      loading, loadCurrent, error, profile, activeTab, setTab,
      currentApp, items, parsePaymentExtension, hasExtension, userId,
      showEditModal, editForm, openEditModal, saveProfile, isSaving,
      notification, handleFileUpload, previewAvatar, selectedFile
    };
  },

  template: `
  <div class="jrj-candidate-profile flex min-h-screen bg-[#F7F7F7] font-sans text-[#000000] relative">
    
    <aside class="sticky top-0 h-screen w-20 lg:w-72 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col transition-all duration-300 z-20">
      
      <div class="p-6 border-b border-gray-100 flex flex-col items-center text-center">
        
        <div class="relative mb-4 group cursor-pointer" @click="openEditModal">
            <div class="w-20 h-20 lg:w-24 lg:h-24 rounded-full p-1 border-2 border-[#E8A674] overflow-hidden bg-white">
                <img v-if="profile.avatar" :src="profile.avatar" alt="avatar" class="w-full h-full rounded-full object-cover" />
                <div v-else class="w-full h-full rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                    <svg class="w-8 h-8 lg:w-12 lg:h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                </div>
            </div>

            <button class="absolute bottom-0 right-0 bg-white text-gray-600 hover:text-[#E8A674] rounded-full p-2 shadow-md border border-gray-100 transition-all transform hover:scale-105" title="Edit Profile">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            </button>
        </div>
        
        <div class="hidden lg:block w-full">
             <h2 class="font-bold text-xl text-black truncate px-2" :title="profile.display_name">
                {{ profile.display_name }}
             </h2>
             <p class="text-xs text-[#666666] truncate px-2 mt-1">{{ profile.email }}</p>
        </div>
      </div>

      <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
        <button @click="setTab('overview')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'overview' ? 'bg-[#E8A674]/10 text-black' : 'text-[#666666] hover:bg-gray-50 hover:text-black'" title="Overview">
          <span class="flex-shrink-0 transition-colors duration-200" :class="activeTab === 'overview' ? 'text-[#E8A674]' : 'text-gray-400 group-hover:text-[#E8A674]'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
          </span>
          <span class="hidden lg:block">Overview</span>
          <div v-if="activeTab === 'overview'" class="hidden lg:block ml-auto w-1.5 h-1.5 rounded-full bg-[#E8A674]"></div>
        </button>

        <button @click="setTab('housing')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'housing' ? 'bg-[#E8A674]/10 text-black' : 'text-[#666666] hover:bg-gray-50 hover:text-black'" title="Housing Application">
          <span class="flex-shrink-0 transition-colors duration-200" :class="activeTab === 'housing' ? 'text-[#E8A674]' : 'text-gray-400 group-hover:text-[#E8A674]'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
          </span>
          <span class="hidden lg:block">Housing Application</span>
          <div v-if="activeTab === 'housing'" class="hidden lg:block ml-auto w-1.5 h-1.5 rounded-full bg-[#E8A674]"></div>
        </button>

        <button v-if="hasExtension" @click="setTab('extension_agreement')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'extension_agreement' ? 'bg-red-50 text-red-600' : 'text-[#666666] hover:bg-red-50 hover:text-red-600'" title="Extension Agreement">
          <span class="flex-shrink-0 transition-colors duration-200" :class="activeTab === 'extension_agreement' ? 'text-red-600' : 'text-gray-400 group-hover:text-red-500'">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          </span>
          <span class="hidden lg:block">Extension Agreement</span>
          <span v-if="!activeTab === 'extension_agreement'" class="hidden lg:block ml-auto w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
        </button>

        <button @click="setTab('medical')" 
          class="w-full flex items-center justify-center lg:justify-start gap-3 px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group"
          :class="activeTab === 'medical' ? 'bg-[#E8A674]/10 text-black' : 'text-[#666666] hover:bg-gray-50 hover:text-black'" title="Medical Forms">
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
        <svg class="animate-spin w-10 h-10 text-[#E8A674] mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p>Loading profile...</p>
      </div>
      
      <div v-else-if="error" class="bg-red-50 border border-red-200 p-6 rounded-lg shadow-sm text-center">
         <svg class="w-6 h-6 inline-block mb-2 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
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
                <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#E8A674]/10 text-[#E8A674]">Student Portal</span>
            </div>
          </div>

          <div v-if="hasExtension" class="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 shadow-sm">
            <svg class="w-5 h-5 text-amber-500 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
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
              <svg class="w-12 h-12 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
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
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Completed
                      </span>
                      <span v-else class="text-[#E8A674] flex items-center gap-1.5 font-medium">
                        <svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        In Progress
                      </span>
                      
                      <a v-if="c.certificate_url" :href="c.certificate_url" target="_blank" class="text-gray-500 hover:text-black flex items-center gap-1.5 transition-colors">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        Certificate
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
        
        <div v-if="activeTab==='housing'" class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 fade-in"><HousingForm :user-id="userId" /></div>
        <div v-if="activeTab==='extension_agreement'" class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 fade-in"><ExtensionForm :user-id="userId" /></div>
        <div v-if="activeTab==='medical'" class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 fade-in"><MedicalForm :user-id="userId" /></div>

      </div>
    </main>

    <div v-if="notification.show" 
         class="fixed bottom-5 right-5 z-[60] flex items-center gap-3 px-6 py-4 rounded-lg shadow-lg text-white transition-all duration-300 transform translate-y-0 animate-fade-in-up"
         :class="notification.isError ? 'bg-red-500' : 'bg-emerald-500'">
        <span class="text-xl">
            <svg v-if="!notification.isError" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <svg v-else class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </span>
        <div class="font-medium text-sm">{{ notification.message }}</div>
        <button @click="notification.show = false" class="ml-2 hover:bg-white/20 rounded-full p-1">
             <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    </div>

    <div v-if="showEditModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 transition-opacity duration-300">
        <div class="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 relative transform transition-all scale-100">
            
            <div class="flex justify-between items-center mb-6 border-b pb-2">
                <h3 class="text-xl font-bold text-gray-900">Edit Profile</h3>
                <button @click="showEditModal = false" class="text-gray-400 hover:text-red-500 transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <form @submit.prevent="saveProfile" class="space-y-5">
                
                <div class="flex flex-col items-center mb-4">
                     <div class="w-24 h-24 rounded-full border-2 border-[#E8A674] mb-3 overflow-hidden bg-gray-50 relative">
                         <img v-if="previewAvatar" :src="previewAvatar" class="w-full h-full object-cover" />
                         <div v-else class="w-full h-full flex items-center justify-center text-gray-300">
                             <svg class="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                         </div>
                     </div>
                     <label class="cursor-pointer text-sm text-[#E8A674] font-semibold hover:underline">
                         Change Photo
                         <input type="file" accept="image/*" @change="handleFileUpload" class="hidden" />
                     </label>
                </div>

                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1">Display Name</label>
                    <input v-model="editForm.display_name" type="text" 
                        class="block w-full rounded-md border-gray-300 shadow-sm focus:border-[#E8A674] focus:ring focus:ring-[#E8A674] focus:ring-opacity-50 border p-2.5 bg-gray-50" 
                        required 
                    />
                </div>

                <div class="pt-2">
                    <p class="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Change Password (Optional)</p>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs text-gray-600 mb-1">New Password</label>
                            <input v-model="editForm.password" type="password" 
                                class="block w-full rounded-md border-gray-300 shadow-sm focus:border-[#E8A674] focus:ring focus:ring-[#E8A674] focus:ring-opacity-50 border p-2.5 bg-gray-50" 
                            />
                        </div>

                        <div>
                            <label class="block text-xs text-gray-600 mb-1">Confirm Password</label>
                            <input v-model="editForm.confirm_password" type="password" 
                                class="block w-full rounded-md border-gray-300 shadow-sm focus:border-[#E8A674] focus:ring focus:ring-[#E8A674] focus:ring-opacity-50 border p-2.5 bg-gray-50" 
                            />
                        </div>
                    </div>
                </div>

                <div class="flex justify-end gap-3 mt-8 pt-4 border-t">
                    <button type="button" @click="showEditModal = false" 
                        class="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                        Cancel
                    </button>
                    <button type="submit" :disabled="isSaving" 
                        class="px-5 py-2.5 text-sm font-medium text-white bg-[#E8A674] rounded-lg hover:bg-[#d69564] flex items-center shadow-sm disabled:opacity-70 disabled:cursor-not-allowed transition-all">
                        
                        <span v-if="isSaving" class="mr-2">
                            <svg class="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        </span>
                        {{ isSaving ? 'Saving...' : 'Save Changes' }}
                    </button>
                </div>
            </form>
        </div>
    </div>

  </div>
  `,
};

document.addEventListener("DOMContentLoaded", function () {
  const mount = document.getElementById("jrj-candidate-profile");
  if (mount) {
    const userId = mount.dataset.userId || "";
    createApp(CandidateProfile, { userId }).mount(mount);
  }
});