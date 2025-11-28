/* global JRJ_ADMIN */
import { ref, reactive, onMounted } from "vue/dist/vue.esm-bundler.js";

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

    // notice state + timeout handle
    const notice = reactive({
      show: false,
      type: "success",
      message: "",
    });
    let noticeTimer = null;
    function showNotice(type, msg, ms = 4000) {
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      notice.type = type;
      notice.message = msg;
      notice.show = true;
      noticeTimer = setTimeout(() => {
        notice.show = false;
        noticeTimer = null;
      }, ms);
    }

    // filters
    const filter = reactive({ status: "", extension_status: "" });

    // main modal
    const modalOpen = ref(false);
    const modalItem = ref(null);
    const modalLoading = ref(false);
    const modalRejection = ref(""); // rejection reason input

    // extension modal (separate)
    const extensionModalOpen = ref(false);
    const extensionModalLoading = ref(false);

    // Prefill inputs for acro fields and extension meta
    const extensionForm = reactive({
      // acro fields mapping (these keys correspond to your AcroForm mapping)
      tenant_first_name: "",
      tenant_last_name: "",
      rental_address: "",
      tenant_phone: "",
      tenant_email: "",
      due_on: "",
      signed_date: "",
      // extension meta
      extended_until: "",
      note: "",
      enabled: 0,
    });

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
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `HTTP ${res.status}`);
        }

        const json = await res.json();
        items.value = json.items || json.data || [];

        const totalHeader = res.headers.get("X-WP-Total");
        total.value = totalHeader
          ? parseInt(totalHeader, 10)
          : json.total || json.count || 0;
      } catch (e) {
        console.error("housing list load error", e);
        showNotice("error", "Failed to load housing list: " + (e.message || e));
      } finally {
        loading.value = false;
      }
    };

    async function openDetail(id) {
      modalOpen.value = true;
      modalItem.value = null;
      modalRejection.value = "";
      modalLoading.value = true;
      try {
        const res = await fetch(`${JRJ_ADMIN.root}housing/applicants/${id}`, {
          method: "GET",
          credentials: "same-origin",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "no item");

        const it = json.item || {};

        // parse JSON fields if they are stored as strings
        it.for_rental = safeParseJson(it.for_rental) || it.for_rental || null;
        it.for_verification =
          safeParseJson(it.for_verification) || it.for_verification || null;
        it.payment_extension =
          safeParseJson(it.payment_extension) || it.payment_extension || null;
        it.fields_json =
          safeParseJson(it.fields_json) || it.fields_json || null;

        modalItem.value = it;
      } catch (e) {
        showNotice("error", "Failed to fetch detail: " + e.message);
        modalOpen.value = false;
      } finally {
        modalLoading.value = false;
      }
    }

    // medical detail
    async function openMedicalDetail(id) {
      modalOpen.value = true;
      modalItem.value = null;
      modalRejection.value = "";
      modalLoading.value = true;
      try {
        const res = await fetch(`${JRJ_ADMIN.root}housing/medical/${id}`, {
          method: "GET",
          credentials: "same-origin",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "no item");
        const it = json.item || {};
        modalItem.value = it;
      } catch (e) {
        showNotice("error", "Failed to fetch medical detail: " + e.message);
        modalOpen.value = false;
      } finally {
        modalLoading.value = false;
      }
    }

    // safe accessor for extension enabled
    function isExtensionEnabled(item) {
      const p = item.extension_enabled;
      if (!p) return false;
      try {
        return Number(p === "1") ? true : false;
      } catch (e) {
        return false;
      }
    }

    // Toggle / enable payment extension for an applicant
    async function toggleExtension(applicantId, enable = 1) {
      try {
        const body = new URLSearchParams();
        body.append("enable", enable ? "1" : "0");

        const res = await fetch(
          `${JRJ_ADMIN.root}housing/applicants/${applicantId}/extension`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
            body,
          }
        );

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) {
          throw new Error(j.error || "Failed");
        }

        await load();

        showNotice(
          "success",
          enable ? "Payment extension enabled." : "Payment extension revoked."
        );
      } catch (e) {
        showNotice("error", e.message || "Toggle failed");
      }
    }

    // open extension modal for edit/create
    function openExtensionModal(item) {
      if (!item) return;
      modalItem.value = item; // also show as context
      // Clear extensionForm
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

      // Source priority: payment_extension.fields_json (if saved) -> item.fields_json -> for_rental -> for_verification -> fallback to item fields
      const ext =
        safeParseJson(item.payment_extension) || item.payment_extension || {};
      const fieldsFromPaymentExt = safeParseJson(ext.fields_json) || {};
      const globalFields = safeParseJson(item.fields_json) || {};
      const forRental = safeParseJson(item.for_rental) || {};
      const forVerification = safeParseJson(item.for_verification) || {};

      // Fill mapping — these keys match your AcroForm names
      extensionForm.tenant_first_name =
        fieldsFromPaymentExt.tenant_first_name ||
        globalFields.tenant_first_name ||
        forRental.tenant_first_name ||
        forVerification.tenant_first_name ||
        item.full_name?.split?.(" ")?.[0] ||
        "";
      extensionForm.tenant_last_name =
        fieldsFromPaymentExt.tenant_last_name ||
        globalFields.tenant_last_name ||
        forRental.tenant_last_name ||
        forVerification.tenant_last_name ||
        item.full_name?.split?.(" ")?.slice(1).join(" ") ||
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

      // extension meta
      extensionForm.extended_until =
        ext.extended_until || ext.extended_until || "";
      extensionForm.note = ext.notes || ext.note || "";
      extensionForm.enabled = ext.enabled ? 1 : 0;

      extensionModalOpen.value = true;
    }

    // Save extension for applicant: will send fields_json (the acro map) + extension meta
    async function saveExtensionForApplicant(applicantId) {
      try {
        extensionModalLoading.value = true;

        // build fields_json object for acroform
        const fields_json_obj = {
          tenant_first_name: extensionForm.tenant_first_name || "",
          tenant_last_name: extensionForm.tenant_last_name || "",
          rental_address: extensionForm.rental_address || "",
          phone: extensionForm.tenant_phone || "",
          email: extensionForm.tenant_email || "",
          due_on: extensionForm.due_on || "",
          date: extensionForm.signed_date || "",
        };

        const ext_meta = {
          enabled: 1,
          extended_until: extensionForm.extended_until || "",
          notes: extensionForm.note || "",
          fields_json: fields_json_obj,
        };

        const body = new URLSearchParams();
        body.append("agreement_enable", 1);
        body.append("extended_until", ext_meta.extended_until || "");
        body.append("note", ext_meta.notes || "");
        // send fields json as a string as well (backend should accept it)
        body.append("fields_json", JSON.stringify(fields_json_obj));

        const res = await fetch(
          `${JRJ_ADMIN.root}housing/applicants/${applicantId}/extension`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
            body,
          }
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok)
          throw new Error(
            (j && (j.error || j.message)) || `HTTP ${res.status}`
          );

        showNotice("success", "Payment extension saved.");
        extensionModalOpen.value = false;
        await load();
      } catch (e) {
        showNotice("error", "Save failed: " + (e.message || e));
      } finally {
        extensionModalLoading.value = false;
      }
    }

    // confirm status update (approve/reject/in_progress)
    async function confirmUpdate(id, status) {
      if (!modalItem.value) {
        showNotice("error", "No item loaded.");
        return;
      }
      if (status === "rejected" && !modalRejection.value.trim()) {
        showNotice("warning", "Please provide a rejection reason.");
        return;
      }

      modalLoading.value = true;
      try {
        const body = new URLSearchParams();
        body.append("status", status);
        if (status === "rejected")
          body.append("rejection_reason", modalRejection.value);

        const res = await fetch(`${JRJ_ADMIN.root}housing/applicants/${id}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          body,
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) {
          const msg = (j && (j.message || j.error)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        showNotice("success", "Status updated successfully.");
        modalOpen.value = false;
        modalItem.value = null;
        modalRejection.value = "";
        await load();
      } catch (e) {
        showNotice("error", "Update failed: " + (e.message || e));
      } finally {
        modalLoading.value = false;
      }
    }

    // Extentions update (approve/reject/in_progress).
    async function extentionUpdate(id, status) {
      if (!modalItem.value) {
        showNotice("error", "No item loaded.");
        return;
      }
      if (status === "rejected" && !extensionForm.note.trim()) {
        showNotice("warning", "Please provide a rejection reason.");
        return;
      }

      extensionModalLoading.value = true;
      try {
        const body = new URLSearchParams();
        body.append("status", status);
        if (status === "rejected")
          body.append("rejection_reason", extensionForm.note);

        const res = await fetch(`${JRJ_ADMIN.root}housing/applicants/${id}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
          body,
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) {
          const msg = (j && (j.message || j.error)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        showNotice("success", "Extension status updated successfully.");
        extensionModalOpen.value = false;
        extensionForm.extended_until = "";
        extensionForm.note = "";
        await load();
      } catch (e) {
        showNotice("error", "Update failed: " + (e.message || e));
      } finally {
        extensionModalLoading.value = false;
      }
    }

    function pretty(k) {
      return String(k)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());
    }

    function closeModal() {
      modalOpen.value = false;
      modalItem.value = null;
      modalRejection.value = "";
      modalLoading.value = false;
    }
    function closeExtensionModal() {
      extensionModalOpen.value = false;
      extensionForm.extended_until = "";
      extensionForm.note = "";
      extensionModalLoading.value = false;
    }

    function nextDay() {
      const d = new Date();
      d.setDate(d.getDate() + 1); // next day
      return d.toISOString().split("T")[0];
    }

    onMounted(load);

    return {
      items,
      total,
      page,
      perPage,
      loading,
      filter,
      load,
      modalOpen,
      modalItem,
      modalLoading,
      modalRejection,
      openDetail,
      confirmUpdate,
      pretty,
      notice,
      showNotice,
      closeModal,
      nextDay,
      // extension stuff
      toggleExtension,
      openExtensionModal,
      extensionModalOpen,
      extensionForm,
      saveExtensionForApplicant,
      extensionModalLoading,
      closeExtensionModal,
      isExtensionEnabled,
      extentionUpdate,
    };
  },

  template: `
  <div class="jrj-card">
    <h2>Housing/Rental Applications Panel</h2>

    <div v-if="notice.show"
        :class="['jrj-notice', 'jrj-' + notice.type]"
        style="margin-bottom:12px;padding:10px;border-radius:6px;">
      {{ notice.message }}
    </div>

    <div class="jrj-toolbar" style="display:flex;gap:12px;align-items:center;margin-bottom:12px;">
      <label>Status
        <select v-model="filter.status" @change="page=1; load()" style="margin-left:8px;">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="in_progress">In progress</option>
        </select>
      </label>

      <label style="margin-left:12px;">Extension
        <select v-model="filter.extension_status" @change="page=1; load()" style="margin-left:8px;">
          <option value="">Any</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </label>

      <label style="margin-left:auto;">Per page
        <select v-model.number="perPage" @change="page=1; load()" style="margin-left:8px;">
          <option :value="10">10</option>
          <option :value="20">20</option>
          <option :value="50">50</option>
        </select>
      </label>
    </div>

    <table class="jrj-table" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th>#</th>
          <th>Housing Need</th>
          <th>Name</th>
          <th>Email</th>
          <th>Status</th>
          <th>Rental Detail</th>
          <th>Medical Detail</th>
          <th>Payment Extension</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading"><td colspan="8">Loading…</td></tr>

        <tr v-for="r in items" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.need_housing }}</td>
          <td>{{ r.name || r.full_name || '—' }}</td>
          <td>{{ r.email || '—' }}</td>
          <td>{{ r.status }}</td>
          <td>
            <button class="button" @click="openDetail(r.id)">Details</button>
          </td>

          <td>
            <button class="button" @click="openMedicalDetail(r.id)">Details</button>
          </td>

          <td>
            <button v-if="isExtensionEnabled(r)" class="button" style="margin-left:6px"
              @click="toggleExtension(r.applicant_id, 0)">
              Revoke
            </button>
            <button v-else class="button" style="margin-left:6px"
              @click="toggleExtension(r.applicant_id, 1)">
              Enable
            </button>
            <button v-if="isExtensionEnabled(r)" class="button" style="margin-left:6px" @click="openExtensionModal(r)">Detail</button>
          </td>
        </tr>

        <tr v-if="!loading && items.length===0"><td colspan="8">No items</td></tr>
      </tbody>
    </table>

    <div class="jrj-pagination" v-if="total > perPage" style="margin-top:12px;">
      <button class="button" :disabled="page===1" @click="page--; load()">«</button>
      <span style="margin:0 12px;">Page {{ page }}</span>
      <button class="button" :disabled="page * perPage >= total" @click="page++; load()">»</button>
    </div>

    <!-- main modal for detail -->
    <div v-if="modalOpen" class="jrj-modal" style="display:block;">
      <div class="jrj-modal-body">
        <button class="jrj-modal-close" @click="closeModal()">×</button>
        <h3>Housing/Rental Application detail</h3>

        <div v-if="modalLoading">Loading…</div>
        <div v-else-if="!modalItem">No data</div>
        <div v-else>
          <p><strong>ID:</strong> {{ modalItem.id }} — <strong>User:</strong> {{ modalItem.applicant_id }} / {{ modalItem.name }} ({{ modalItem.email }})</p>
          <p><strong>Need housing:</strong> {{ modalItem.need_housing }}</p>
          <p><strong>Status:</strong> {{ modalItem.status }}</p>
          <p v-if="modalItem.rejection_reason"><strong>Rejection reason:</strong> {{ modalItem.rejection_reason }}</p>

          <div v-if="modalItem && modalItem.for_rental">
            <h4>Rental Data</h4>
            <div class="pretty-section">
              <div class="pretty-row" v-for="(value, key) in modalItem.for_rental" :key="key">
                <div class="pretty-key">{{ pretty(key) }}</div>
                <div class="pretty-value">{{ value || '—' }}</div>
              </div>
            </div>
          </div>

          <div v-if="modalItem && modalItem.for_verification" style="margin-top:12px;">
            <h4>Verification Data</h4>
            <div class="pretty-section">
              <div class="pretty-row" v-for="(value, key) in modalItem.for_verification" :key="key">
                <div class="pretty-key">{{ pretty(key) }}</div>
                <div class="pretty-value">{{ value || '—' }}</div>
              </div>
            </div>
          </div>

        </div>

        <div style="margin-top:12px;">
          <label>Rejection reason (if rejecting):</label>
          <textarea v-model="modalRejection" rows="3" style="width:100%"></textarea>
        </div>

        <div style="margin-top:12px;text-align:right;">
          <button class="button" @click="confirmUpdate(modalItem.id, 'approved')" :disabled="modalLoading">Approve</button>
          <button class="button" @click="confirmUpdate(modalItem.id, 'rejected')" :disabled="modalLoading" style="margin-left:8px">Reject</button>
          <button class="button" @click="confirmUpdate(modalItem.id, 'in_progress')" :disabled="modalLoading" style="margin-left:8px">Mark In Progress</button>
        </div>
      </div>
    </div>

    <!-- extension editor modal -->
    <div v-if="extensionModalOpen" class="jrj-modal" style="display:block;">
      <div class="jrj-modal-body">
        <button class="jrj-modal-close" @click="closeExtensionModal()">×</button>
        <h3>Edit Payment Agreement Extension</h3>

        <div v-if="extensionModalLoading">Saving…</div>

        <div style="margin-top:12px;">
          <div class="pretty-section">
            <div>Status</div><div>{{ extensionForm.extension_enabled === 1 ? "Enable" : 'Disable' }}</div>
            <div class="pretty-row"><div class="pretty-key">Expires At</div><div class="pretty-value">{{ extensionForm.extended_until || '—' }}</div></div>
            <div class="pretty-row"><div class="pretty-key">Note</div><div class="pretty-value">{{ extensionForm.note || '—' }}</div></div>
          </div>
        </div>
   
        <h3>Applican Housing/Rental Info</h3>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div>
            <label>Tenant first name</label>
            <input v-model="extensionForm.tenant_first_name" class="widefat" />
          </div>
          <div>
            <label>Tenant last name</label>
            <input v-model="extensionForm.tenant_last_name" class="widefat" />
          </div>

          <div>
            <label>Phone</label>
            <input v-model="extensionForm.tenant_phone" class="widefat" />
          </div>
          <div>
            <label>Email</label>
            <input v-model="extensionForm.tenant_email" class="widefat" />
          </div>

          <div style="grid-column:1 / -1;">
            <label>Rental address</label>
            <input v-model="extensionForm.rental_address" class="widefat" />
          </div>

          <div>
            <label>Original due date</label>
            <input type="date" v-model="extensionForm.due_on" class="widefat" />
          </div>
          
            
          <div>
            <label>Extended until</label>
            <input :min="nextDay()" type="date" v-model="extensionForm.extended_until" class="widefat" />
          </div>

        </div>
        
        <div style="margin-top:8px;">
          <label>Note or Rejection Reason</label>
          <textarea v-model="extensionForm.note" rows="3" style="width:100%"></textarea>
        </div>

        <div style="margin-top:12px;text-align:right;">
          <button class="button" @click="extentionUpdate(modalItem.id, 'approved')" :disabled="extensionModalLoading">Approve</button>
          <button class="button" @click="extentionUpdate(modalItem.id, 'rejected')" :disabled="extensionModalLoading" style="margin-left:8px">Reject</button>
          <button class="button" @click="extentionUpdate(modalItem.id, 'in_progress')" :disabled="extensionModalLoading" style="margin-left:8px">Mark In Progress</button>
          <button class="button" @click="saveExtensionForApplicant(modalItem.applicant_id)" :disabled="extensionModalLoading" style="margin-left:8px">Send Payment Agreement Extension Paper for sign</button>
          <button class="button" style="margin-left:8px" @click="closeExtensionModal()">Close</button>
        </div>
      </div>
    </div>

  </div>
  `,
};
