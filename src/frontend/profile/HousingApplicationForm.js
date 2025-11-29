/* global JRJ_ADMIN */
import { ref, reactive, onMounted, computed } from "vue/dist/vue.esm-bundler.js";

import FileUpload from "./components/file-upload.js";

export default {
  name: "HousingApplicationForm",
  components: { FileUpload },
  props: {
    userId: { type: [String, Number], required: false, default: "" },
  },
  setup(props) {
    const loading = ref(true);
    const message = ref("");
    const error = ref("");

    const currentApp = ref(null);
    const needHousing = ref("yes");

    /**
     * Current status
     */
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
        // if application exists, set needHousing according to it
        if (currentApp.value) {
          needHousing.value =
            currentApp.value.need_housing === "no" ? "no" : "yes";
        }
      } catch (e) {
        // ignore or set error
        // console.warn('loadCurrent', e);
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => {
      loadCurrent();
    });

    const rental = reactive({
      applicant_id: props.userId || null,
      full_name: "",
      gender: "",
      date_of_birth: "",
      phone: "",
      email: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip: "",
      move_in_date: "",
      emergency_name: "",
      emergency_phone: "",
      notes: "",
      // NEW: TurboTenant question
      prior_turbotenant: "", // 'yes'|'no'
      id_file: null,
      id_photo_capture: null,
    });

    const verification = reactive({
      applicant_id: props.userId || null,
      proof_type: "utility_bill",
      provider_name: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip: "",
      proof_file: null,
      notes: "",
    });

    // computed filenames
    const rentalIdFileName = computed(() =>
      rental.id_file ? rental.id_file.name : ""
    );
    const rentalCaptureName = computed(() =>
      rental.id_photo_capture ? rental.id_photo_capture.name : ""
    );
    const verificationProofFileName = computed(() =>
      verification.proof_file ? verification.proof_file.name : ""
    );

    // file handlers
    function onRentalIdFile(ev) {
      rental.id_file =
        ev.target.files && ev.target.files[0] ? ev.target.files[0] : null;
    }
    function onRentalCapture(ev) {
      rental.id_photo_capture =
        ev.target.files && ev.target.files[0] ? ev.target.files[0] : null;
    }
    function onVerificationProofFile(file) {
      verification.proof_file = file || null;
    }

    // validations
    function validateRental() {
      if (!rental.full_name.trim()) return "Please enter full name.";
      if (!rental.phone.trim()) return "Please enter phone.";
      if (!rental.address_line1.trim()) return "Please enter address.";
      if (
        rental.prior_turbotenant !== "yes" &&
        rental.prior_turbotenant !== "no"
      )
        return "Please answer whether you have previously been an occupant managed by GREAT POND MANAGEMENT / TurboTenant.";
      // require at least one proof (id_file or camera capture)
      if (!rental.id_file)
        //not required this one as of now -- if needed will add later -- && !rental.id_photo_capture
        return "Please upload or take a photo of a government ID.";
      if (!rental.emergency_name.trim())
        return "Please enter emergency contact name.";
      if (!rental.emergency_phone.trim())
        return "Please enter emergency contact phone.";
      return "";
    }

    function validateVerification() {
      if (!verification.proof_file)
        return "Please upload proof of address (photo or PDF).";
      return "";
    }

    // submit rental application
    async function submitRental() {
      // error.value = "";
      // message.value = "";

      if (!rental.full_name || !rental.phone) {
        showModal(
          "error",
          "Missing Information",
          "Please fill in the required fields (Full Name, Phone)."
        );
        return;
      }

      if (!rental.id_file) {
        showModal(
          "error",
          "ID Required",
          "Please upload or take a photo of a government ID."
        );
        return;
      }

      // client-side validation first
      const v = validateRental();
      if (v) {
        error.value = v;
        return;
      }

      loading.value = true;
      try {
        const fd = new FormData();

        // include applicant id (use prop or reactive)
        fd.append(
          "applicant_id",
          String(props.userId || rental.applicant_id || "")
        );

        fd.append("need_housing", "yes");
        fd.append("full_name", rental.full_name || "");
        fd.append("gender", rental.gender || "");
        fd.append("date_of_birth", rental.date_of_birth || "");
        fd.append("address_line1", rental.address_line1 || "");
        fd.append("address_line2", rental.address_line2 || "");
        fd.append("city", rental.city || "");
        fd.append("state", rental.state || "");
        fd.append("zip", rental.zip || "");
        fd.append("phone", rental.phone || "");
        fd.append("move_in_date", rental.move_in_date || "");
        fd.append("emergency_name", rental.emergency_name || "");
        fd.append("emergency_phone", rental.emergency_phone || "");
        fd.append("notes", rental.notes || "");
        fd.append("prior_turbotenant", rental.prior_turbotenant || "");

        if (rental.id_file)
          fd.append("id_file", rental.id_file, rental.id_file.name);
        if (rental.id_photo_capture)
          fd.append(
            "id_photo_capture",
            rental.id_photo_capture,
            rental.id_photo_capture.name
          );

        const res = await fetch(JRJ_ADMIN.root + "housing/apply", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "X-WP-Nonce": JRJ_ADMIN.nonce || "",
            // DO NOT set 'Content-Type'
          },
          body: fd,
        });

        // try to parse JSON, but guard in case server returns non-json
        const json = await res
          .json()
          .catch(() => ({ ok: false, error: "invalid_json" }));

        if (!res.ok || !json.ok) {
          const msg =
            (json && (json.message || json.error)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        // success
        showModal(
          "success",
          "Success",
          "Rental application submitted successfully.",
          "Close"
        );
        loadCurrent();
      } catch (e) {
        showModal("error", "Submission Failed", e.message);
      } finally {
        loading.value = false;
      }
    }

    async function submitVerification() {
      error.value = "";
      message.value = "";

      if (!verification.provider_name || !verification.address_line1) {
        showModal(
          "error",
          "Missing Information",
          "Please fill in Provider Name and Address."
        );
        return;
      }

      if (!verification.proof_file) {
        showModal(
          "error",
          "Proof Required",
          "Please upload a proof of address document."
        );
        return;
      }

      const v = validateVerification();
      if (v) {
        error.value = v;
        return;
      }

      loading.value = true;
      try {
        const fd = new FormData();
        fd.append(
          "applicant_id",
          String(props.userId || verification.applicant_id || "")
        );
        fd.append("need_housing", "no");
        fd.append("proof_type", verification.proof_type || "");
        fd.append("provider_name", verification.provider_name || "");
        fd.append("provider_email", verification.provider_email || "");
        fd.append("provider_phone", verification.provider_phone || "");
        fd.append("address_line1", verification.address_line1 || "");
        fd.append("address_line2", verification.address_line2 || "");
        fd.append("city", verification.city || "");
        fd.append("state", verification.state || "");
        fd.append("zip", verification.zip || "");
        fd.append("notes", verification.notes || "");
        if (verification.proof_file)
          fd.append(
            "proof_file",
            verification.proof_file,
            verification.proof_file.name
          );

        const res = await fetch(JRJ_ADMIN.root + "housing/verify", {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce || "" },
          body: fd,
        });

        const json = await res
          .json()
          .catch(() => ({ ok: false, error: "invalid_json" }));
        if (!res.ok || !json.ok) {
          const msg =
            (json && (json.message || json.error)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        // message.value = "Verification submitted — a manager will review.";
        showModal(
          "success",
          "Success",
          "Verification details submitted successfully.",
          "Close"
        );

        loadCurrent();
        clearVerification();
      } catch (e) {
        showModal("error", "Submission Failed", e.message);
      } finally {
        loading.value = false;
      }
    }

    function clearRental() {
      rental.full_name = "";
      rental.gender = "";
      rental.date_of_birth = "";
      rental.phone = "";
      rental.email = "";
      rental.address_line1 = "";
      rental.address_line2 = "";
      rental.city = "";
      rental.state = "";
      rental.zip = "";
      rental.move_in_date = "";
      rental.emergency_name = "";
      rental.emergency_phone = "";
      rental.notes = "";
      rental.prior_turbotenant = "";
      rental.id_file = null;
      rental.id_photo_capture = null;
    }

    function clearVerification() {
      verification.proof_type = "utility_bill";
      verification.provider_name = "";
      verification.provider_email = "";
      verification.provider_phone = "";
      verification.address_line1 = "";
      verification.address_line2 = "";
      verification.city = "";
      verification.state = "";
      verification.zip = "";
      verification.notes = "";
      verification.proof_file = null;
    }

    // UI helpers
    const isPending = computed(
      () => currentApp.value && currentApp.value.status === "pending"
    );
    const isApproved = computed(
      () => currentApp.value && currentApp.value.status === "approved"
    );
    const isRejected = computed(
      () => currentApp.value && currentApp.value.status === "rejected"
    );

    // allow candidate to resubmit after reject: if rejected => show form (you can allow edits)
    function allowResubmitAfterReject() {
      if (isRejected.value) {
        currentApp.value = null;
        message.value = "";
        error.value = "";
      }
    }

    // optionally poll every 30s to pick up status changes by admin
    let pollTimer = null;
    // function startPolling() {
    //   if (pollTimer) return;
    //   pollTimer = setInterval(() => {
    //     loadCurrent();
    //   }, 30 * 1000);
    // }
    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
    function pretty(objOrStr) {
      try {
        const o =
          typeof objOrStr === "string" ? JSON.parse(objOrStr) : objOrStr;
        let h = '<table class="w-full text-sm text-left text-gray-600">';
        for (const k in o) {
          if (k.includes("file") || k.includes("capture")) continue;
          h += `<tr class="border-b border-gray-50"><td class="py-2 font-medium text-gray-800 capitalize">${k.replace(
            /_/g,
            " "
          )}</td><td class="py-2 text-gray-600">${o[k]}</td></tr>`;
        }
        h += "</table>";
        return h;
      } catch (e) {
        return String(objOrStr);
      }
    }

    // onMounted(startPolling);
    const modal = reactive({
      show: false,
      type: "info", // 'confirm', 'error', 'success'
      title: "",
      message: "",
      confirmText: "OK",
      onConfirm: null,
    });

    const showModal = (
      type,
      title,
      message,
      confirmText = "OK",
      callback = null
    ) => {
      modal.type = type;
      modal.title = title;
      modal.message = message;
      modal.confirmText = confirmText;
      modal.onConfirm = callback;
      modal.show = true;
    };

    const closeModal = () => {
      modal.show = false;
      modal.onConfirm = null;
    };

    const handleModalConfirm = () => {
      if (modal.onConfirm) modal.onConfirm();
      closeModal();
    };

    return {
      needHousing,
      rental,
      verification,
      rentalIdFileName,
      rentalCaptureName,
      verificationProofFileName,
      loading,
      message,
      error,
      onRentalIdFile,
      onRentalCapture,
      onVerificationProofFile,
      submitRental,
      submitVerification,
      currentApp,
      isPending,
      isApproved,
      isRejected,
      allowResubmitAfterReject,
      pretty,
      modal,
      closeModal,
      handleModalConfirm,
    };
  },

  template: `
  <div class="housing-application-panel font-sans text-slate-800">
    
    <div class="mb-6 border-b border-gray-100 pb-4">
        <h3 class="text-2xl font-bold text-gray-800">Housing Application</h3>
        <p class="text-gray-500 text-sm mt-1">Manage your housing arrangements and submit required documents.</p>
    </div>

    <div v-if="loading" class="flex flex-col items-center justify-center p-12 bg-white rounded-lg border border-gray-100">
      <i class="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500 mb-3"></i>
      <span class="text-gray-500 font-medium">Processing...</span>
    </div>

    <div v-else>
      
      <div v-if="currentApp" class="space-y-6">
        
        <div v-if="isPending" class="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
          <div class="text-blue-500 mt-0.5"><i class="fa-solid fa-clock"></i></div>
          <div>
            <h4 class="font-bold text-blue-800 text-sm">Application Under Review</h4>
            <p class="text-sm text-blue-700 mt-1">We have received your documents. You will be notified once a decision is made.</p>
          </div>
        </div>

        <div v-if="isApproved" class="bg-emerald-50 border border-emerald-100 rounded-lg p-4 flex items-start gap-3">
          <div class="text-emerald-500 mt-0.5"><i class="fa-solid fa-circle-check"></i></div>
          <div>
            <h4 class="font-bold text-emerald-800 text-sm">Approved</h4>
            <p class="text-sm text-emerald-700 mt-1">Congratulations! Your housing application has been approved. We will contact you with next steps.</p>
          </div>
        </div>

        <div v-if="isRejected" class="bg-red-50 border border-red-100 rounded-lg p-4 flex items-start gap-3">
          <div class="text-red-500 mt-0.5"><i class="fa-solid fa-circle-xmark"></i></div>
          <div class="flex-1">
            <h4 class="font-bold text-red-800 text-sm">Application Rejected</h4>
            <p class="text-sm text-red-700 mt-1">Unfortunately, your application was not approved.</p>
            
            <div v-if="currentApp.rejection_reason" class="mt-3 bg-white/60 p-3 rounded border border-red-100 text-sm text-red-800">
                <strong>Reason:</strong> {{ currentApp.rejection_reason }}
            </div>

            <button @click="allowResubmitAfterReject" class="mt-3 px-4 py-2 bg-white border border-red-200 text-red-600 text-xs font-bold uppercase tracking-wide rounded hover:bg-red-50 transition shadow-sm">
              Resubmit Application
            </button>
          </div>
        </div>

        <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div class="bg-gray-50 px-6 py-3 border-b border-gray-200 flex justify-between items-center">
                <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Application Details</span>
                <span class="px-2 py-1 rounded text-xs font-bold uppercase" 
                      :class="{
                        'bg-blue-100 text-blue-700': currentApp.status === 'in_progress' || currentApp.status === 'pending',
                        'bg-emerald-100 text-emerald-700': currentApp.status === 'approved',
                        'bg-red-100 text-red-700': currentApp.status === 'rejected'
                      }">
                    {{ currentApp.status === 'in_progress' ? "In Progress" : currentApp.status }}
                </span>
            </div>
            
            <div class="p-6 space-y-6">
                <div class="text-sm text-gray-500 mb-4">
                    Submitted on <span class="font-medium text-gray-800">{{ currentApp.created_at }}</span>
                </div>

                <div v-if="currentApp.for_rental">
                    <div class="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
                        <i class="fa-solid fa-house-user text-gray-400"></i>
                        <h4 class="font-bold text-gray-800">Rental Application Data</h4>
                    </div>
                    
                    <div class="bg-gray-50 rounded-lg p-4 border border-gray-100 mb-4">
                        <div class="flex flex-col gap-2 text-sm">
                            <div v-if="currentApp.id_file_url" class="flex justify-between">
                                <span class="text-gray-500">ID Document:</span>
                                <a :href="currentApp.id_file_url" target="_blank" class="text-blue-600 hover:underline font-medium">View Document</a>
                            </div>
                            <div v-if="currentApp.id_photo_capture_url" class="flex justify-between">
                                <span class="text-gray-500">Photo Capture:</span>
                                <a :href="currentApp.id_photo_capture_url" target="_blank" class="text-blue-600 hover:underline font-medium">View Photo</a>
                            </div>
                        </div>
                    </div>

                    <div v-html="pretty(currentApp.for_rental)"></div>
                </div>

                <div v-if="currentApp.for_verification">
                    <div class="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
                        <i class="fa-solid fa-file-contract text-gray-400"></i>
                        <h4 class="font-bold text-gray-800">Verification Details</h4>
                    </div>

                    <div class="bg-gray-50 rounded-lg p-4 border border-gray-100 mb-4">
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-500">Proof Document:</span>
                            <a v-if="currentApp.verification_proof_url" :href="currentApp.verification_proof_url" target="_blank" class="text-blue-600 hover:underline font-medium">View Proof</a>
                            <span v-else class="text-gray-400 italic">Not uploaded</span>
                        </div>
                    </div>

                    <div v-html="pretty(currentApp.for_verification)"></div>
                </div>
            </div>
        </div>

      </div>

      <div v-else class="space-y-8 animate-fade-in">
        
        <div class="bg-gray-50 p-1 rounded-lg inline-flex w-full border border-gray-200">
          <label class="flex-1 cursor-pointer">
            <input type="radio" v-model="needHousing" value="yes" class="peer sr-only" />
            <div class="px-4 py-3 text-center text-sm font-medium text-gray-500 rounded-md transition-all peer-checked:bg-white peer-checked:text-blue-600 peer-checked:shadow-sm flex items-center justify-center gap-2">
                <i class="fa-solid fa-building"></i> Need Company Housing
            </div>
          </label>
          <label class="flex-1 cursor-pointer">
            <input type="radio" v-model="needHousing" value="no" class="peer sr-only" />
            <div class="px-4 py-3 text-center text-sm font-medium text-gray-500 rounded-md transition-all peer-checked:bg-white peer-checked:text-emerald-600 peer-checked:shadow-sm flex items-center justify-center gap-2">
                <i class="fa-solid fa-house-circle-check"></i> I Have My Own Housing
            </div>
          </label>
        </div>

        <div v-if="message" class="bg-green-50 text-green-700 p-4 rounded-lg border border-green-200 text-sm flex items-center gap-2">
            <i class="fa-solid fa-circle-check"></i> {{ message }}
        </div>
        <div v-if="error" class="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 text-sm flex items-center gap-2">
            <i class="fa-solid fa-circle-exclamation"></i> {{ error }}
        </div>

        <div v-show="needHousing==='yes'" class="space-y-6">
          
          <div class="bg-blue-50 border border-blue-100 p-4 rounded-lg text-sm text-blue-800">
            <p class="leading-relaxed">Rental applications are reviewed based on payment history, cleanliness, organization, and ability to share spaces. Submitting does not guarantee approval.</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Full Name</label>
              <input v-model="rental.full_name" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" placeholder="e.g. John Doe" />
            </div>

            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Gender</label>
              <select v-model="rental.gender" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition">
                <option value="">Select Gender</option>
                <option>Female</option>
                <option>Male</option>
              </select>
            </div>

            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Date of Birth</label>
              <input type="date" v-model="rental.date_of_birth" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
            </div>

            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Phone</label>
              <input type="tel" v-model="rental.phone" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" placeholder="(000) 000-0000" />
            </div>

            <div class="space-y-1 md:col-span-2">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Email</label>
              <input type="email" v-model="rental.email" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" placeholder="you@example.com" />
            </div>

            <div class="md:col-span-2 space-y-4 p-5 bg-gray-50 rounded-xl border border-gray-200">
                <h4 class="font-bold text-gray-700 text-sm border-b border-gray-200 pb-2">Current Address</h4>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="md:col-span-2">
                        <input v-model="rental.address_line1" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Street Address" />
                    </div>
                    <div class="md:col-span-2">
                        <input v-model="rental.address_line2" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Apartment, suite, etc. (optional)" />
                    </div>
                    <div>
                        <input v-model="rental.city" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="City" />
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <input v-model="rental.state" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="State" />
                        <input type="number" v-model="rental.zip" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="ZIP" />
                    </div>
                </div>
            </div>

            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Desired Move-in Date</label>
              <input type="date" v-model="rental.move_in_date" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition" />
            </div>

            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Emergency Contact</label>
              <input v-model="rental.emergency_name" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition mb-2" placeholder="Contact Name" />
              <input type="tel" v-model="rental.emergency_phone" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition" placeholder="Contact Phone" />
            </div>

            <div class="md:col-span-2 space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Notes (Optional)</label>
              <textarea v-model="rental.notes" rows="3" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition resize-none" placeholder="Any additional information..."></textarea>
            </div>

            <div class="md:col-span-2 p-5 border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-50 transition text-center">
              <i class="fa-solid fa-cloud-arrow-up text-3xl text-gray-300 mb-2"></i>
              <label class="block text-sm font-medium text-gray-700 mb-1">Upload Government ID</label>
              <p class="text-xs text-gray-400 mb-4">Photo or PDF format</p>
              
              <input type="file" @change="onRentalIdFile" accept="image/*,application/pdf" class="block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-full file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100
              "/>
              <div v-if="rentalIdFileName" class="mt-2 text-sm text-emerald-600 font-medium flex items-center justify-center gap-1">
                 <i class="fa-solid fa-check"></i> Selected: {{ rentalIdFileName }}
              </div>
            </div>

            <div class="md:col-span-2 bg-amber-50 p-4 rounded-lg border border-amber-100">
              <label class="block text-sm font-medium text-amber-900 mb-3 leading-snug">
                Have you ever been an occupant at any property managed by GREAT POND MANAGEMENT and the TurboTenant platform in the past?
              </label>
              <div class="flex gap-6">
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" v-model="rental.prior_turbotenant" value="yes" class="w-4 h-4 text-blue-600 focus:ring-blue-500" /> 
                    <span class="text-sm text-gray-700">Yes</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" v-model="rental.prior_turbotenant" value="no" class="w-4 h-4 text-blue-600 focus:ring-blue-500" /> 
                    <span class="text-sm text-gray-700">No</span>
                </label>
              </div>
            </div>

          </div>

          <div class="pt-6 border-t border-gray-100 flex justify-end">
            <button class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md font-medium transition transform active:scale-95 disabled:opacity-50 disabled:transform-none" 
                    :disabled="loading" @click="submitRental">
              {{ loading ? 'Submitting Application...' : 'Submit Rental Application' }}
            </button>
          </div>
        </div>

        <div v-show="needHousing==='no'" class="space-y-6">
          
          <div class="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
             <h4 class="font-bold text-gray-800 mb-2">Housing Verification Policy</h4>
             <p class="text-sm text-gray-600 leading-relaxed">
               If you are making your own arrangements, you must provide proof of address (Lease, Utility Bill, or Government ID) 
               along with a confirmation letter from the resident owner.
             </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
            
            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Provider Name</label>
              <input v-model="verification.provider_name" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Name on document" />
            </div>

            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Provider Email</label>
              <input type="email" v-model="verification.provider_email" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="email@example.com" />
            </div>

            <div class="space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Provider Phone</label>
              <input type="tel" v-model="verification.provider_phone" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="(000) 000-0000" />
            </div>

            <div class="md:col-span-3 p-5 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
                <h4 class="font-bold text-gray-700 text-sm border-b border-gray-200 pb-2">Housing Address (as on proof)</h4>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="md:col-span-2">
                        <input v-model="verification.address_line1" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Street Address" />
                    </div>
                    <div class="md:col-span-2">
                        <input v-model="verification.address_line2" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Apartment (Optional)" />
                    </div>
                    <div>
                        <input v-model="verification.city" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="City" />
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <input v-model="verification.state" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="State" />
                        <input type="number" v-model="verification.zip" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="ZIP" />
                    </div>
                </div>
            </div>

            <div class="md:col-span-1 space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Proof Type</label>
              <div class="relative">
                  <select v-model="verification.proof_type" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none appearance-none">
                    <option value="utility_bill">Utility Bill</option>
                    <option value="lease">Lease Agreement</option>
                    <option value="government_id">Government ID</option>
                    <option value="other">Other Document</option>
                  </select>
                  <div class="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-gray-500">
                    <i class="fa-solid fa-chevron-down text-xs"></i>
                  </div>
              </div>
            </div>

            <div class="md:col-span-2 space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Upload Proof Document</label>
              <div class="bg-white border border-gray-300 rounded-lg p-1">
                  <FileUpload @file-selected="onVerificationProofFile" />
              </div>
              <div v-if="verificationProofName" class="text-xs text-emerald-600 mt-1 font-medium">
                 <i class="fa-solid fa-check"></i> Ready: {{ verificationProofName }}
              </div>
            </div>

            <div class="md:col-span-3 space-y-1">
              <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Additional Notes</label>
              <textarea v-model="verification.notes" rows="3" class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none resize-none" placeholder="Any extra details..."></textarea>
            </div>
          </div>

          <div class="pt-6 border-t border-gray-100 flex justify-end">
            <button class="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-md font-medium transition transform active:scale-95 disabled:opacity-50 disabled:transform-none" 
                    :disabled="loading" @click="submitVerification">
              {{ loading ? 'Uploading...' : 'Submit Verification' }}
            </button>
          </div>
        </div>

      </div>
    </div>
  </div>
  `,
};
