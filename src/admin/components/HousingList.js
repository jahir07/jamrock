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

        const url = `${JRJ_ADMIN.root}housing/applicants?${q.toString()}`;
        const res = await fetch(url, {
          method: "GET",
          credentials: "same-origin",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });

        const json = await res.json();

        if (json.ok) {
          const rawItems = json.items || [];

          items.value = rawItems.map((item) => {
            item.payment_extension =
              safeParseJson(item.payment_extension) || {};
            item.for_rental = safeParseJson(item.for_rental) || {};
            return item;
          });

          total.value = json.total || 0;
        }
      } catch (e) {
        console.error("housing list load error", e);
        showNotice("error", "Failed to load housing list: " + (e.message || e));
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

    // Enable / Disable Extension
    async function toggleExtension(
      applicantId,
      enable = 1,
      show_candidate = 0
    ) {
      try {
        const body = new URLSearchParams();
        body.append("enable", enable ? "1" : "0");
        body.append("show_candidate", show_candidate);
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
        body.append("enable", 1); // main panel.
        body.append("show_candidate", 1); // candidate panel.
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
        body.append("id", id);
        body.append("status", status);
        // reusing housing status update logic but context is extension modal
        const res = await fetch(
          `${JRJ_ADMIN.root}payment-extensions/${id}/status`,
          {
            method: "POST",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
            body,
          }
        );
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

    const getDynamicUrl = (url) => {
      if (!url) return "";
      const currentProtocol = window.location.protocol;
      const urlWithoutProtocol = url.replace(/^https?:\/\//i, "");
      return `${currentProtocol}//${urlWithoutProtocol}`;
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
      getDynamicUrl,
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
                        <span v-if="item.payment_extension?.status === 'submitted'" class="text-xs font-bold text-emerald-700">Signed</span>
                        <span v-else class="text-xs text-emerald-600">Active</span>
                        <button @click="openExtensionModal(item)" class="text-xs text-blue-600 hover:underline px-3 py-1.5 border bottom-1 border-cyan-500 rounded-md shadow-sm">Manage</button>
                        <button @click="toggleExtension(item.applicant_id, 0, 0)" class="text-xs text-indigo-600 hover:underline px-3 py-1.5">Disable</button>
                    </div>
                    <div v-else class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-slate-300"></span>
                        <span class="text-xs text-slate-400">Inactive</span>
                        <button @click="toggleExtension(item.applicant_id, 1, 0)" class="text-xs text-indigo-600 hover:underline px-3 py-1.5">Enable</button>
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
      <div class="bg-white w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 class="text-lg font-bold text-slate-800">Application Details</h3>
          <button @click="modalOpen=false" class="text-slate-400 hover:text-slate-600"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>
        <div v-if="notice.show" :class="notice.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'" class="mb-4 p-4 rounded-lg border text-sm font-medium flex items-center gap-2">
          <span v-if="notice.type==='success'">✓</span><span v-else>⚠️</span>
          {{ notice.message }}
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
             
             <div v-if="modalItem.for_rental" class="space-y-2 mt-4">
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
        
        <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
          <div>
             <h3 class="text-lg font-bold text-slate-800">Medical Record Review</h3>
             <p class="text-xs text-slate-500">Review applicant history and clearance documents.</p>
          </div>
          <button @click="medicalModalOpen=false" class="text-slate-400 hover:text-slate-600 transition-colors">
             <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div v-if="modalLoading" class="flex-1 flex flex-col items-center justify-center p-10 text-slate-400">
            <svg class="animate-spin h-8 w-8 text-indigo-500 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            <span>Loading data...</span>
        </div>
        
        <div v-else-if="!medicalItem" class="flex-1 flex items-center justify-center p-10">
           <div class="bg-amber-50 text-amber-700 p-4 rounded-lg border border-amber-200 flex items-center gap-3">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              No medical affidavit found for this applicant.
           </div>
        </div>

        <div v-else class="flex flex-col h-full overflow-hidden bg-slate-50/50">
           
           <div v-if="medicalItem.medical_clearance_status === 'approved'" class="bg-emerald-50 border-b border-emerald-100 px-6 py-3 flex items-center justify-between">
              <div class="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                 <div class="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg></div>
                 Medical Clearance Approved
              </div>
              <div class="text-xs text-emerald-600">This applicant is cleared to proceed.</div>
           </div>

           <div v-else-if="medicalItem.medical_clearance_status === 'rejected'" class="bg-red-50 border-b border-red-100 px-6 py-3 flex items-center justify-between">
              <div class="flex items-center gap-2 text-red-700 font-bold text-sm">
                 <div class="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></div>
                 Medical Clearance Rejected
              </div>
              <div class="text-xs text-red-600">Applicant must resubmit documents.</div>
           </div>

           <div v-else-if="medicalItem.has_conditions === 'yes'" class="bg-blue-50 border-b border-blue-100 px-6 py-3 flex items-center justify-between">
              <div class="flex items-center gap-2 text-blue-700 font-bold text-sm">
                 <div class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>
                 Pending Review
              </div>
              <div class="text-xs text-blue-600">Please review the clearance certificate below.</div>
           </div>

           <div class="flex border-b border-slate-200 bg-white px-6 shadow-sm">
              <button @click="activeTab='history'" :class="activeTab==='history' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'" class="px-4 py-3 text-sm font-bold border-b-2 transition-colors">History</button>
              <button @click="activeTab='clearance'" :class="activeTab==='clearance' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'" class="px-4 py-3 text-sm font-bold border-b-2 transition-colors">Clearance Documents</button>
           </div>

           <div class="p-6 overflow-y-auto flex-1">
              
              <div v-if="activeTab==='history'" class="space-y-6">
                  
                  <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <div class="px-6 py-3 border-b border-slate-200 bg-slate-50">
                          <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide">Personal Information</h4>
                      </div>
                      <div v-if="medicalItem.details && medicalItem.details.medical_history" class="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                          <template v-for="(ans, question, index) in medicalItem.details.medical_history">
                              <div v-if="index < 7" :key="question">
                                  <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">{{ pretty(question) }}</label>
                                  <div class="text-sm font-medium text-slate-800">{{ ans || '-' }}</div>
                              </div>
                          </template>
                      </div>
                  </div>

                  <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <div class="px-6 py-3 border-b border-slate-200 bg-slate-50">
                          <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide">Medical Conditions</h4>
                      </div>
                      <div v-if="medicalItem.details && medicalItem.details.medical_history">
                          <table class="w-full text-left text-sm">
                              <tbody class="divide-y divide-slate-100">
                                  <template v-for="(ans, question, index) in medicalItem.details.medical_history">
                                      <tr v-if="index >= 7" :key="question" :class="(ans === 'Yes' || ans === true) ? 'bg-red-50' : ''">
                                          <td class="px-6 py-3 font-medium text-slate-600">{{ pretty(question) }}</td>
                                          <td class="px-6 py-3 text-right">
                                              <span v-if="ans === 'Yes' || ans === true" class="inline-flex items-center gap-1 text-red-700 font-bold text-xs uppercase"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>YES</span>
                                              <span v-else class="text-slate-400 text-xs uppercase font-medium">No</span>
                                          </td>
                                      </tr>
                                  </template>
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>

              <div v-if="activeTab==='clearance'">
                 <div v-if="medicalItem.has_conditions === 'yes'" class="bg-white p-6 rounded-xl border border-slate-100 shadow-sm">
                    <h4 class="text-sm font-bold text-slate-800 mb-4">Clearance Certificate</h4>
                    
                    <div v-if="medicalItem.medical_clearance_file" class="flex items-center gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200 mb-6 group hover:border-indigo-300 transition-colors">
                       <div class="bg-white p-3 rounded-lg text-red-500 shadow-sm group-hover:scale-110 transition-transform">
                           <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" /><path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>
                       </div>
                       <div class="flex-1">
                          <div class="text-sm font-bold text-slate-900">Signed Clearance PDF</div>
                          <div class="text-xs text-slate-500 mb-1">Uploaded by applicant</div>
                          <a :href="medicalItem.medical_clearance_file" target="_blank" class="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline">
                             View Document <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                          </a>
                       </div>
                    </div>
                    <div v-else class="p-6 text-center border-2 border-dashed border-slate-300 rounded-lg bg-slate-50">
                        <div class="text-slate-400 mb-2">No file uploaded yet</div>
                        <div class="text-xs text-slate-500">Applicant has declared medical conditions but hasn't uploaded the clearance form.</div>
                    </div>
                 </div>

                 <div v-else class="flex flex-col items-center justify-center p-12 text-center bg-white rounded-xl border border-slate-200 shadow-sm h-64">
                    <div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-400">
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <h4 class="text-lg font-bold text-slate-800">Clearance Not Required</h4>
                    <p class="text-sm text-slate-500 max-w-xs mt-2">This applicant has not reported any medical conditions that require a doctor's clearance.</p>
                 </div>
              </div>
           </div>

           <div class="flex border-t border-slate-200 bg-white px-6 py-4 justify-between items-center gap-3">
                <div class="text-xs text-slate-400">
                    Last updated: {{ medicalItem.updated_at || medicalItem.created_at || 'Never' }}
                </div>
                
                    <button 
                        @click="updateMedicalStatus('rejected')" 
                        :disabled="modalLoading || medicalItem.medical_clearance_status === 'rejected'"
                        class="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        Reject
                    </button>
                    <button 
                        @click="updateMedicalStatus('approved')" 
                        :disabled="modalLoading || medicalItem.medical_clearance_status === 'approved'"
                        class="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 shadow-md shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95">
                        Approve
                    </button>
           </div>
        </div>
      </div>
    </div>

    <div v-if="extensionModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" @click.self="extensionModalOpen=false">
      <div class="bg-white w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        <div class="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 class="text-lg font-bold text-slate-800">Manage Payment Extension</h3>
          <button @click="extensionModalOpen=false" class="text-slate-400 hover:text-slate-600"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        </div>

        <div v-if="notice.show" :class="notice.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'" class="mb-4 p-4 rounded-lg border text-sm font-medium flex items-center gap-2">
          <span v-if="notice.type==='success'">✓</span><span v-else>⚠️</span>
          {{ notice.message }}
        </div>

        <div class="p-6 overflow-y-auto">
           <div v-if="extensionModalLoading" class="text-center text-slate-400 py-8">Processing...</div>
           <div v-else class="space-y-6">
              <div class="flex items-center justify-between p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
                <div>
                    <h4 class="font-bold text-indigo-900">Payment Extension Agreement</h4>
                    <p class="text-xs text-indigo-600">If its enable it will visible in candidate panel to see <br /> and sign the payment agreement extension form.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button v-if="modalItem.payment_extension?.show_candidate === 1" @click="toggleExtension(modalItem.applicant_id, 1, 1)" class="px-3 py-1.5 bg-lime-500 text-white text-xs font-bold rounded shadow-sm hover:bg-lime-700">Enable</button>
                    <button v-else @click="toggleExtension(modalItem.applicant_id, 1, 0)" class="px-3 py-1.5 bg-rose-500 text-white text-xs font-bold rounded shadow-sm hover:bg-rose-700">Disable</button>
                </div>
              </div>

              <div v-if="modalItem.payment_extension?.status === 'submitted'">
                  <iframe :src="getDynamicUrl(modalItem.payment_extension?.final_signed_pdf)" class="w-full h-64 border rounded-lg shadow-sm"></iframe>
              </div>
              <div v-else>
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
