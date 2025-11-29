/* global JRJ_ADMIN */
import { ref, reactive, onMounted } from "vue";

function safeParseJson(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
  }
}

export default {
  name: "HousingList",
  setup() {
    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const perPage = ref(10);
    const loading = ref(false);

    // Filters
    const filter = reactive({ status: "", extension_status: "" });

    // UI State
    const activeTab = ref("history"); // for medical modal

    // Notice System
    const notice = reactive({ show: false, type: "success", message: "" });
    let noticeTimer = null;
    function showNotice(type, msg, ms = 4000) {
      if (noticeTimer) clearTimeout(noticeTimer);
      notice.type = type;
      notice.message = msg;
      notice.show = true;
      noticeTimer = setTimeout(() => (notice.show = false), ms);
    }

    // Modals
    const modalOpen = ref(false); // Housing Details
    const medicalModalOpen = ref(false); // Medical Details
    const extensionModalOpen = ref(false); // Payment Extension

    const modalItem = ref(null); // Active Item context
    const medicalItem = ref(null); // Medical data
    const modalLoading = ref(false);
    const modalRejection = ref("");
    const extensionModalLoading = ref(false);

    // Extension Form Data
    const extensionForm = reactive({
      tenant_first_name: "",
      tenant_last_name: "",
      rental_address: "",
      tenant_phone: "",
      tenant_email: "",
      due_on: "",
      signed_date: "",
      extended_until: "",
      note: "",
      enabled: 0,
    });

    // --- Load List ---
    const load = async () => {
      loading.value = true;
      try {
        const q = new URLSearchParams({
          page: String(page.value),
          per_page: String(perPage.value),
          status: filter.status || "",
          extension_status: filter.extension_status || "",
        });

        const res = await fetch(`${JRJ_ADMIN.root}housing/applicants?${q}`, {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        const json = await res.json();
        if (json.ok) {
          items.value = json.items || [];
          total.value = json.total || 0;
        }
      } catch (e) {
        showNotice("error", "Error loading list");
      } finally {
        loading.value = false;
      }
    };

    // --- Housing Detail Logic ---
    const openDetail = async (id) => {
      modalOpen.value = true;
      modalLoading.value = true;
      try {
        const res = await fetch(`${JRJ_ADMIN.root}housing/applicants/${id}`, {
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        const json = await res.json();
        if (json.ok && json.item) {
          const it = json.item;
          [
            "for_rental",
            "for_verification",
            "payment_extension",
            "fields_json",
          ].forEach((k) => {
            it[k] = safeParseJson(it[k]);
          });
          modalItem.value = it;
        }
      } catch (e) {
        showNotice("error", "Fetch error");
      } finally {
        modalLoading.value = false;
      }
    };

    const updateHousingStatus = async (status) => {
      if (!modalItem.value) return;
      if (status === "rejected" && !modalRejection.value) {
        return showNotice("error", "Rejection reason required");
      }
      modalLoading.value = true;
      try {
        const body = new URLSearchParams();
        body.append("status", status);
        if (status === "rejected")
          body.append("rejection_reason", modalRejection.value);

        await fetch(
          `${JRJ_ADMIN.root}housing/applicants/${modalItem.value.id}`,
          {
            method: "POST",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
            body,
          }
        );
        showNotice("success", "Status updated");
        modalOpen.value = false;
        load();
      } catch (e) {
        showNotice("error", e.message);
      } finally {
        modalLoading.value = false;
      }
    };

    // --- Medical Logic ---
    const openMedicalDetail = async (housingId) => {
      medicalModalOpen.value = true;
      modalLoading.value = true;
      medicalItem.value = null;
      activeTab.value = "history";

      try {
        const res = await fetch(
          `${JRJ_ADMIN.root}housing/applicants/${housingId}/medical`,
          {
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          }
        );
        const json = await res.json();
        if (json.ok) {
          medicalItem.value = json.item;
        } else {
          showNotice("warning", "No medical record found.");
        }
      } catch (e) {
        showNotice("error", "Medical fetch error");
      } finally {
        modalLoading.value = false;
      }
    };

    const updateMedicalStatus = async (status) => {
      if (!medicalItem.value) return;
      modalLoading.value = true;
      try {
        const url = `${JRJ_ADMIN.root}housing/medical/${medicalItem.value.id}/status`;
        const body = new URLSearchParams();
        body.append("status", status);

        const res = await fetch(url, {
          method: "POST",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          body,
        });
        const json = await res.json();
        if (json.ok) {
          showNotice("success", `Medical Clearance ${status}`);
          medicalItem.value.medical_clearance_status = status;
        } else {
          throw new Error(json.error);
        }
      } catch (e) {
        showNotice("error", "Update failed");
      } finally {
        modalLoading.value = false;
      }
    };

    // --- Payment Extension Logic ---
    function isExtensionEnabled(item) {
      const p = item.extension_enabled;
      if (!p) return false;
      return Number(p) === 1;
    }

    async function toggleExtension(applicantId, enable = 1) {
      try {
        const body = new URLSearchParams();
        body.append("enable", enable ? "1" : "0");
        const res = await fetch(
          `${JRJ_ADMIN.root}housing/applicants/${applicantId}/extension`,
          {
            method: "POST",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
            body,
          }
        );
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || "Failed");

        await load();
        showNotice(
          "success",
          enable ? "Extension Enabled." : "Extension Revoked."
        );
      } catch (e) {
        showNotice("error", e.message);
      }
    }

    function openExtensionModal(item) {
      if (!item) return;
      modalItem.value = item;

      // Reset Form
      Object.assign(extensionForm, {
        tenant_first_name: "",
        tenant_last_name: "",
        rental_address: "",
        tenant_phone: "",
        tenant_email: "",
        due_on: "",
        signed_date: "",
        extended_until: "",
        note: "",
        enabled: 0,
      });

      // Parse Data Sources
      const ext =
        safeParseJson(item.payment_extension) || item.payment_extension || {};
      const fieldsFromPaymentExt = safeParseJson(ext.fields_json) || {};
      const globalFields = safeParseJson(item.fields_json) || {};
      const forRental = safeParseJson(item.for_rental) || {};
      const forVerification = safeParseJson(item.for_verification) || {};

      // Intelligent Mapping (Restored from your code)
      extensionForm.tenant_first_name =
        fieldsFromPaymentExt.tenant_first_name ||
        globalFields.tenant_first_name ||
        forRental.tenant_first_name ||
        forVerification.tenant_first_name ||
        item.name?.split?.(" ")?.[0] ||
        "";
      extensionForm.tenant_last_name =
        fieldsFromPaymentExt.tenant_last_name ||
        globalFields.tenant_last_name ||
        forRental.tenant_last_name ||
        forVerification.tenant_last_name ||
        item.name?.split?.(" ")?.slice(1).join(" ") ||
        "";
      extensionForm.rental_address =
        fieldsFromPaymentExt.rental_address ||
        globalFields.rental_address ||
        forRental.address_line1 ||
        forVerification.rental_address ||
        "";
      extensionForm.tenant_phone =
        fieldsFromPaymentExt.phone ||
        globalFields.phone ||
        forRental.phone ||
        forVerification.phone ||
        item.phone ||
        "";
      extensionForm.tenant_email =
        fieldsFromPaymentExt.email ||
        globalFields.email ||
        forRental.email ||
        forVerification.email ||
        item.email ||
        "";
      extensionForm.due_on =
        fieldsFromPaymentExt.due_on ||
        globalFields.due_on ||
        item.original_due_date ||
        "";
      extensionForm.signed_date =
        fieldsFromPaymentExt.date || globalFields.date || "";

      // Meta
      extensionForm.extended_until = ext.extended_until || "";
      extensionForm.note = ext.notes || ext.note || "";
      extensionForm.enabled = ext.enabled ? 1 : 0;

      extensionModalOpen.value = true;
    }

    async function saveExtensionForApplicant(applicantId) {
      extensionModalLoading.value = true;
      try {
        const fields_json_obj = {
          tenant_first_name: extensionForm.tenant_first_name || "",
          tenant_last_name: extensionForm.tenant_last_name || "",
          rental_address: extensionForm.rental_address || "",
          phone: extensionForm.tenant_phone || "",
          email: extensionForm.tenant_email || "",
          due_on: extensionForm.due_on || "",
          date: extensionForm.signed_date || "",
        };

        const body = new URLSearchParams();
        body.append("agreement_enable", 1);
        body.append("extended_until", extensionForm.extended_until || "");
        body.append("note", extensionForm.note || "");
        body.append("status", "pending");
        body.append("fields_json", JSON.stringify(fields_json_obj));

        const res = await fetch(
          `${JRJ_ADMIN.root}housing/applicants/${applicantId}/extension`,
          {
            method: "POST",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
            body,
          }
        );
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.message || "Failed");

        showNotice("success", "Extension saved & agreement enabled.");
        extensionModalOpen.value = false;
        await load();
      } catch (e) {
        showNotice("error", e.message);
      } finally {
        extensionModalLoading.value = false;
      }
    }

    async function extensionUpdateStatus(id, status) {
      extensionModalLoading.value = true;
      try {
        const body = new URLSearchParams();
        body.append("status", status);
        // reusing housing status update logic but context is extension modal
        const res = await fetch(`${JRJ_ADMIN.root}housing/applicants/${id}`, {
          method: "POST",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          body,
        });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error("Update failed");

        showNotice("success", "Status updated.");
        extensionModalOpen.value = false;
        await load();
      } catch (e) {
        showNotice("error", e.message);
      } finally {
        extensionModalLoading.value = false;
      }
    }

    // --- Helpers ---
    const statusClass = (s) => {
      if (!s) return "bg-gray-100 text-gray-600";
      switch (s.toLowerCase()) {
        case "approved":
          return "bg-emerald-100 text-emerald-700 border-emerald-200";
        case "rejected":
          return "bg-red-100 text-red-700 border-red-200";
        case "submitted":
        case "pending":
          return "bg-amber-100 text-amber-700 border-amber-200";
        default:
          return "bg-blue-50 text-blue-600 border-blue-100";
      }
    };

    const pretty = (str) =>
      str.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    const nextDay = () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().split("T")[0];
    };

    onMounted(load);

    return {
      items,
      total,
      page,
      perPage,
      loading,
      filter,
      load,
      // Housing
      modalOpen,
      modalItem,
      modalLoading,
      modalRejection,
      openDetail,
      updateHousingStatus,
      // Medical
      medicalModalOpen,
      medicalItem,
      openMedicalDetail,
      updateMedicalStatus,
      activeTab,
      // Extension
      extensionModalOpen,
      extensionForm,
      extensionModalLoading,
      openExtensionModal,
      toggleExtension,
      saveExtensionForApplicant,
      isExtensionEnabled,
      extensionUpdateStatus,
      // UI
      notice,
      showNotice,
      statusClass,
      pretty,
      nextDay,
    };
  },

  template: `
  <div class="p-6 max-w-[1400px] mx-auto font-sans text-slate-600">
    
    <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
      <div>
        <h2 class="text-2xl font-bold text-slate-800">Housing & Rental Manager</h2>
        <p class="text-sm text-slate-500">Manage applications, medical clearances, and payment extensions.</p>
      </div>
      
      <div class="flex flex-wrap gap-3 bg-white p-2 rounded-lg border shadow-sm">
        <select v-model="filter.status" @change="page=1; load()" class="text-sm border-none bg-slate-50 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        
        <select v-model="filter.extension_status" @change="page=1; load()" class="text-sm border-none bg-slate-50 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none">
          <option value="">Any Extension</option>
          <option value="enabled">Ext. Enabled</option>
          <option value="disabled">Ext. Disabled</option>
        </select>

        <select v-model.number="perPage" @change="page=1; load()" class="text-sm border-none bg-slate-50 rounded px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none">
          <option :value="10">10 / page</option>
          <option :value="20">20 / page</option>
          <option :value="50">50 / page</option>
        </select>
      </div>
    </div>

    <div v-if="notice.show" :class="notice.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'" class="mb-4 p-4 rounded-lg border text-sm font-medium flex items-center gap-2">
       <span v-if="notice.type==='success'">✓</span><span v-else>⚠️</span>
       {{ notice.message }}
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <th class="p-4">Applicant</th>
              <th class="p-4">Contact</th>
              <th class="p-4">Housing Status</th>
              <th class="p-4">Housing Actions</th>
              <th class="p-4">Payment Extension</th>
              <th class="p-4 text-right">Medical</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-sm">
            <tr v-if="loading"><td colspan="6" class="p-8 text-center text-slate-400">Loading data...</td></tr>
            <tr v-else-if="items.length === 0"><td colspan="6" class="p-8 text-center text-slate-400">No applications found.</td></tr>
            
            <tr v-else v-for="item in items" :key="item.id" class="hover:bg-slate-50 transition-colors">
              <td class="p-4">
                <div class="font-medium text-slate-900">{{ item.name || item.full_name || 'Unknown' }}</div>
                <div class="text-xs text-slate-400">ID: {{ item.applicant_id }}</div>
              </td>
              <td class="p-4 text-slate-500">
                <div>{{ item.email }}</div>
                <div class="text-xs">{{ item.phone }}</div>
              </td>
              <td class="p-4">
                <span class="px-2.5 py-1 rounded-full text-xs font-bold border" :class="statusClass(item.status)">
                  {{ item.status ? item.status.toUpperCase() : 'PENDING' }}
                </span>
              </td>

              <td class="p-4">
                <button @click="openDetail(item.id)" class="group flex items-end gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md shadow-sm hover:border-indigo-300 transition-colors">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                  Manage
                </button>
              </td>

              <td class="p-4">
                 <div class="flex items-center gap-2">
                    <div v-if="isExtensionEnabled(item)" class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span class="text-xs font-bold text-emerald-700">Active</span>
                        <button @click="openExtensionModal(item)" class="text-xs text-blue-600 hover:underline px-3 py-1.5 border bottom-1 border-cyan-500 rounded-md shadow-sm">Manage</button>
                        <button @click="toggleExtension(item.applicant_id, 0)" class="text-xs text-indigo-600 hover:underline px-3 py-1.5">Disable</button>
                    </div>
                    <div v-else class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-slate-300"></span>
                        <span class="text-xs text-slate-400">Inactive</span>
                        <button @click="toggleExtension(item.applicant_id, 1)" class="text-xs text-indigo-600 hover:underline px-3 py-1.5">Enable</button>
                    </div>
                 </div>
              </td>
                
              <td class="p-4 text-right">
                 <button @click="openMedicalDetail(item.id)" class="group flex items-end gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 transition-colors bg-white border border-slate-200 hover:border-indigo-300 ml-auto px-3 py-1.5 rounded-md shadow-sm">
                    <svg class="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    View Record
                 </button>
              </td>
             
            </tr>
          </tbody>
        </table>
      </div>
      
      <div v-if="total > perPage" class="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50">
         <button :disabled="page===1" @click="page--; load()" class="px-3 py-1 bg-white border rounded disabled:opacity-50 text-xs">Previous</button>
         <span class="text-xs text-slate-500">Page {{ page }}</span>
         <button :disabled="page * perPage >= total" @click="page++; load()" class="px-3 py-1 bg-white border rounded disabled:opacity-50 text-xs">Next</button>
      </div>
    </div>

    <div v-if="modalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" @click.self="modalOpen=false">
      <div class="bg-white w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 class="text-lg font-bold text-slate-800">Application Details</h3>
          <button @click="modalOpen=false" class="text-slate-400 hover:text-slate-600"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>
        <div class="p-6 overflow-y-auto space-y-6">
          <div v-if="modalLoading" class="text-center py-10 text-slate-400">Loading details...</div>
          <div v-else-if="modalItem">
             <div class="bg-blue-50/50 p-4 rounded-lg border border-blue-100 grid grid-cols-2 gap-4 text-sm">
                <div><label class="text-xs text-slate-400 uppercase font-bold">Applicant</label><div class="font-semibold text-slate-800">{{ modalItem.name }}</div></div>
                <div><label class="text-xs text-slate-400 uppercase font-bold">Email</label><div class="text-slate-700">{{ modalItem.email }}</div></div>
                <div><label class="text-xs text-slate-400 uppercase font-bold">Housing Need</label><div class="text-slate-700">{{ modalItem.need_housing }}</div></div>
                <div><label class="text-xs text-slate-400 uppercase font-bold">Status</label><div><span class="px-2 py-0.5 rounded-full text-xs font-bold border" :class="statusClass(modalItem.status)">{{ modalItem.status }}</span></div></div>
             </div>
             <div v-if="modalItem.rejection_reason" class="bg-red-50 p-3 rounded border border-red-100 text-sm text-red-800"><strong>Reason:</strong> {{ modalItem.rejection_reason }}</div>
             
             <div v-if="modalItem.for_rental" class="space-y-2">
                <h4 class="text-sm font-bold text-slate-800 border-b pb-1">Rental Data</h4>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                   <div v-for="(val, key) in modalItem.for_rental" :key="key"><span class="text-slate-400 text-xs block">{{ pretty(key) }}</span><span class="text-slate-700">{{ val || '-' }}</span></div>
                </div>
             </div>

             <div v-if="modalItem.for_verification" class="space-y-2 pt-4">
                <h4 class="text-sm font-bold text-slate-800 border-b pb-1">Verification Data</h4>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                   <div v-for="(val, key) in modalItem.for_verification" :key="key"><span class="text-slate-400 text-xs block">{{ pretty(key) }}</span><span class="text-slate-700">{{ val || '-' }}</span></div>
                </div>
             </div>

             <div class="border-t pt-4 mt-6">
                <label class="block text-sm font-medium text-slate-700 mb-2">Rejection Reason</label>
                <textarea v-model="modalRejection" rows="2" class="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"></textarea>
                <div class="flex justify-end gap-3 mt-4">
                   <button @click="updateHousingStatus('approved')" :disabled="modalLoading" class="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-semibold hover:bg-emerald-700">Approve</button>
                   <button @click="updateHousingStatus('rejected')" :disabled="modalLoading" class="px-4 py-2 bg-white border border-red-200 text-red-600 rounded text-sm font-semibold hover:bg-red-50">Reject</button>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="medicalModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" @click.self="medicalModalOpen=false">
      <div class="bg-white w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 class="text-lg font-bold text-slate-800">Medical Record</h3>
          <button @click="medicalModalOpen=false" class="text-slate-400 hover:text-slate-600"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>
        <div v-if="modalLoading" class="p-10 text-center text-slate-400">Loading...</div>
        <div v-else-if="!medicalItem" class="p-10 text-center"><div class="bg-amber-50 text-amber-700 p-4 rounded inline-block">No medical record.</div></div>
        <div v-else class="flex flex-col h-full overflow-hidden">
           <div class="flex border-b border-slate-200 bg-white px-6">
              <button @click="activeTab='history'" :class="activeTab==='history' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500'" class="px-4 py-3 text-sm font-bold border-b-2 transition-colors">History</button>
              <button @click="activeTab='clearance'" :class="activeTab==='clearance' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500'" class="px-4 py-3 text-sm font-bold border-b-2 transition-colors">Clearance</button>
           </div>
           <div class="p-6 overflow-y-auto bg-slate-50/50 flex-1">
              
              <div v-if="activeTab==='history'">
                <div class="space-y-6">
                    
                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-slate-200 bg-slate-50">
                            <h4 class="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                                <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                Personal Information
                            </h4>
                        </div>
                        
                        <div v-if="medicalItem.details && medicalItem.details.medical_history" class="p-6">
                            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <template v-for="(ans, question, index) in medicalItem.details.medical_history">
                                    <div v-if="index < 7" :key="question">
                                        <label class="block text-xs font-bold text-slate-400 uppercase mb-1">{{ pretty(question) }}</label>
                                        <div class="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-1">
                                            {{ ans || '-' }}
                                        </div>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                            <h4 class="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                                <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                                Medical Conditions
                            </h4>
                        </div>

                        <div v-if="medicalItem.details && medicalItem.details.medical_history" class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead class="bg-slate-50 text-slate-500 font-bold text-xs uppercase tracking-wider border-b border-slate-200">
                                    <tr>
                                        <th class="px-6 py-3 w-2/3">Condition</th>
                                        <th class="px-6 py-3 w-1/3">Response</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                    <template v-for="(ans, question, index) in medicalItem.details.medical_history">
                                        <tr v-if="index >= 7" :key="question" 
                                            class="transition-colors"
                                            :class="(ans === 'Yes' || ans === true) ? 'bg-red-50 hover:bg-red-100/50' : 'hover:bg-slate-50'">
                                            
                                            <td class="px-6 py-3 font-medium text-slate-700">
                                                {{ pretty(question) }}
                                            </td>
                                            
                                            <td class="px-6 py-3 font-bold">
                                                <span v-if="ans === 'Yes' || ans === true" class="inline-flex items-center gap-1.5 text-red-700 bg-white border border-red-200 px-2.5 py-1 rounded text-xs shadow-sm">
                                                    <svg class="w-3 h-3 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                                                    YES
                                                </span>
                                                <span v-else class="text-slate-400 text-xs uppercase">
                                                    {{ ans || 'No' }}
                                                </span>
                                            </td>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                        </div>
                        <div v-else class="text-center py-12 text-slate-400 italic">
                            No medical data available.
                        </div>
                    </div>
                </div>
            </div>

              <div v-if="activeTab==='clearance'">
                 <div class="bg-white p-6 rounded-xl border border-slate-100 shadow-sm mb-6 flex justify-between">
                    <div><div class="text-xs text-slate-400 font-bold uppercase">Conditions?</div><div class="text-lg font-bold" :class="medicalItem.has_conditions==='yes'?'text-red-600':'text-emerald-600'">{{ medicalItem.has_conditions.toUpperCase() }}</div></div>
                    <div class="text-right"><div class="text-xs text-slate-400 font-bold uppercase">Status</div><span class="px-3 py-1 rounded-full text-sm font-bold border mt-1 inline-block" :class="statusClass(medicalItem.medical_clearance_status)">{{ medicalItem.medical_clearance_status.toUpperCase() }}</span></div>
                 </div>
                 <div v-if="medicalItem.has_conditions === 'yes'" class="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
                    <h4 class="text-sm font-bold text-slate-800 mb-4">Clearance Certificate</h4>
                    <div v-if="medicalItem.medical_clearance_file" class="flex items-center gap-4 p-4 bg-blue-50 rounded-lg border border-blue-100 mb-6">
                       <div class="text-blue-500"><svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" /></svg></div>
                       <a :href="medicalItem.medical_clearance_file" target="_blank" class="text-sm text-blue-600 hover:underline font-bold">View / Download PDF</a>
                    </div>
                    <div class="flex gap-3 justify-end pt-4 border-t">
                        <button @click="updateMedicalStatus('rejected')" :disabled="modalLoading" class="px-4 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50">Reject</button>
                        <button @click="updateMedicalStatus('approved')" :disabled="modalLoading" class="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">Approve</button>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>

    <div v-if="extensionModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" @click.self="extensionModalOpen=false">
      <div class="bg-white w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 class="text-lg font-bold text-slate-800">Manage Payment Extension</h3>
          <button @click="extensionModalOpen=false" class="text-slate-400 hover:text-slate-600"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>

        <div class="p-6 overflow-y-auto">
           <div v-if="extensionModalLoading" class="text-center text-slate-400 py-8">Processing...</div>
           <div v-else class="space-y-6">
              
              <div class="flex items-center justify-between p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
                 <div>
                    <h4 class="font-bold text-indigo-900">Extension Agreement</h4>
                    <p class="text-xs text-indigo-600">Toggle the user's ability to see and sign the extension form.</p>
                 </div>
                 <div class="flex items-center gap-2">
                    <button v-if="extensionForm.enabled" @click="toggleExtension(modalItem.applicant_id, 0)" class="px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-bold rounded shadow-sm hover:bg-red-50">REVOKE</button>
                    <button v-else @click="toggleExtension(modalItem.applicant_id, 1)" class="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded shadow-sm hover:bg-indigo-700">ENABLE</button>
                 </div>
              </div>

              <div>
                 <h4 class="text-sm font-bold text-slate-700 mb-3 border-b pb-1">Agreement Details</h4>
                 <div class="grid grid-cols-2 gap-4 text-sm">
                    <div><label class="block text-xs font-bold text-slate-500 mb-1">First Name</label><input v-model="extensionForm.tenant_first_name" class="w-full border rounded p-2 focus:ring-2 focus:ring-indigo-200 outline-none" /></div>
                    <div><label class="block text-xs font-bold text-slate-500 mb-1">Last Name</label><input v-model="extensionForm.tenant_last_name" class="w-full border rounded p-2 focus:ring-2 focus:ring-indigo-200 outline-none" /></div>
                    
                    <div class="col-span-2"><label class="block text-xs font-bold text-slate-500 mb-1">Rental Address</label><input v-model="extensionForm.rental_address" class="w-full border rounded p-2 focus:ring-2 focus:ring-indigo-200 outline-none" /></div>
                    
                    <div><label class="block text-xs font-bold text-slate-500 mb-1">Phone</label><input v-model="extensionForm.tenant_phone" class="w-full border rounded p-2 focus:ring-2 focus:ring-indigo-200 outline-none" /></div>
                    <div><label class="block text-xs font-bold text-slate-500 mb-1">Email</label><input v-model="extensionForm.tenant_email" class="w-full border rounded p-2 focus:ring-2 focus:ring-indigo-200 outline-none" /></div>
                    
                    <div><label class="block text-xs font-bold text-slate-500 mb-1">Original Due Date</label><input type="date" v-model="extensionForm.due_on" class="w-full border rounded p-2 focus:ring-2 focus:ring-indigo-200 outline-none" /></div>
                    <div><label class="block text-xs font-bold text-slate-500 mb-1">Extended Until</label><input type="date" :min="nextDay()" v-model="extensionForm.extended_until" class="w-full border rounded p-2 focus:ring-2 focus:ring-indigo-200 outline-none" /></div>
                 </div>
                 
                 <div class="mt-4">
                    <label class="block text-xs font-bold text-slate-500 mb-1">Notes / Internal Comments</label>
                    <textarea v-model="extensionForm.note" rows="2" class="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-200 outline-none"></textarea>
                 </div>
              </div>
           </div>
        </div>

        <div class="p-5 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
           <div class="flex gap-2">
              <button @click="extensionUpdateStatus(modalItem.id, 'approved')" :disabled="extensionModalLoading" class="px-3 py-1.5 border border-emerald-300 text-emerald-700 bg-emerald-50 rounded text-xs font-bold hover:bg-emerald-100">Approve</button>
              <button @click="extensionUpdateStatus(modalItem.id, 'rejected')" :disabled="extensionModalLoading" class="px-3 py-1.5 border border-red-300 text-red-700 bg-red-50 rounded text-xs font-bold hover:bg-red-100">Reject</button>
           </div>
           <div class="flex gap-3">
              <button @click="extensionModalOpen=false" class="px-4 py-2 border border-slate-300 rounded text-sm font-medium hover:bg-white text-slate-600">Close</button>
              <button @click="saveExtensionForApplicant(modalItem.applicant_id)" :disabled="extensionModalLoading" class="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 shadow">Save & Send Agreement</button>
           </div>
        </div>

      </div>
    </div>

  </div>
  `,
};
