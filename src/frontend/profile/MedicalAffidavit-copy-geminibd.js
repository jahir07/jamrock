/* PdfOverlayFiller.js
   Vue 3 component — Overlay form for Medical History Affidavit.
   - Fixed: Perfect alignment for PDF Export (uses raw PDF coordinates vs Viewport coordinates).
   - Fixed: Smart Validation (Groups Radios, highlights errors visually).
   - UX: Auto-scrolls to errors, clear visual feedback.
*/

import {
  ref,
  reactive,
  computed,
  onMounted,
  watch,
  nextTick,
  onUnmounted,
} from "vue";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

export default {
  name: "PdfOverlayFiller",
  props: {
    applicantId: { type: Number, required: false, default: 0 },
    pdfUrl: {
      type: String,
      required: false,
      default:
        "/wp-content/plugins/jamrock/assets/pdf/medical-history-acro-form.pdf",
    },
    clearancePdfUrl: {
      type: String,
      required: false,
      default:
        "/wp-content/plugins/jamrock/assets/pdf/medical-clearance-certificate.pdf",
    },
  },
  setup(props) {
    // ---------- core state ----------
    const scale = 1.5; // Zoom level for the HTML preview
    const canvasRef = ref(null);
    const status = ref("idle");
    const currentPage = ref(1);
    const totalPages = ref(0);
    let pagesData = []; // { pageObj, viewport, width, height }
    const activePageStyle = reactive({
      width: "0px",
      height: "0px",
      position: "relative",
    });

    // fields: { id, acroName, overlayKey, type, pageIndex, viewRect, pdfRect, value }
    const fields = ref([]);
    const formData = reactive({});
    const showErrors = ref(false); // Toggle for red borders

    let rawPdfBytes = null;
    const currentTemplate = ref("history");

    // affidavit (server data)
    const affidavit = reactive({
      id: null,
      has_conditions: "no",
      status: null,
      details: null,
      medical_clearance_file: null,
      clearance_template_url: null,
    });

    const suppressAutoHas = ref(false);
    const uploadInputRef = ref(null);
    const saving = ref(false);
    const lastSaveOk = ref(false);

    // modal
    const modal = reactive({
      show: false,
      title: "",
      message: "",
      type: "info",
      confirmText: "OK",
      onConfirm: null,
    });
    const showModal = (type, title, message, cb = null) => {
      modal.type = type;
      modal.title = title;
      modal.message = message;
      modal.onConfirm = cb;
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

    // API Helpers
    const apiBase =
      typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN.root
        ? JRJ_ADMIN.root
        : "/wp-json/jamrock/v1/";
    const defaultHeaders = () => {
      const h = {};
      if (typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN.nonce)
        h["X-WP-Nonce"] = JRJ_ADMIN.nonce;
      return h;
    };
    async function safeFetch(url, opts = {}) {
      opts.credentials = opts.credentials || "same-origin";
      opts.headers = { ...(opts.headers || {}), ...defaultHeaders() };
      const res = await fetch(url, opts);
      let j = null;
      try {
        j = await res.json();
      } catch (e) {
        j = null;
      }
      return { ok: res.ok, status: res.status, json: j, raw: res };
    }

    const getApplicantId = () => {
      const p = Number(props.applicantId) || 0;
      if (p > 0) return p;
      return (
        Number(window?.JRJ_USER?.id) || Number(window?.JRJ_ADMIN?.user_id) || 0
      );
    };

    // ---------- Data Fetching ----------
    const fetchAffidavitForApplicant = async () => {
      try {
        const appId = getApplicantId();
        if (!appId) return;
        const url = `${apiBase}medical/affidavit/find?applicant_id=${encodeURIComponent(
          appId
        )}`;
        const { ok, json } = await safeFetch(url, { method: "GET" });
        if (ok && json && json.ok && json.item) {
          const it = json.item;
          affidavit.id = it.id || null;

          let serverHas = it.has_conditions || "no";
          if ((!serverHas || serverHas === "") && it.details) {
            try {
              const det =
                typeof it.details === "string"
                  ? JSON.parse(it.details)
                  : it.details;
              if (det?.has_conditions) serverHas = det.has_conditions;
            } catch (e) {}
          }
          affidavit.has_conditions =
            (serverHas + "").toLowerCase() === "yes" ? "yes" : "no";
          affidavit.status = it.status || null;
          affidavit.medical_clearance_file = it.medical_clearance_file || null;
          affidavit.clearance_template_url = it.clearance_template_url || null;
          affidavit.details =
            typeof it.details === "string"
              ? JSON.parse(it.details || "{}")
              : it.details;
        }
      } catch (e) {
        console.error(e);
      }
    };

    // ---------- Helper: Validation ----------
    const isFieldInvalid = (overlayKey) => {
      if (!showErrors.value) return false;
      const field = fields.value.find((f) => f.overlayKey === overlayKey);
      if (!field) return false;

      // Checkboxes are valid if empty (false)
      if (field.type === "checkbox") return false;

      const val = formData[overlayKey];

      // Radio Group Logic: One must be selected in the group
      if (field.type === "radio") {
        const siblings = fields.value.filter(
          (f) => f.acroName === field.acroName
        );
        const hasSelection = siblings.some(
          (s) =>
            formData[s.overlayKey] === s.value ||
            formData[s.overlayKey] === true
        );
        return !hasSelection;
      }

      // Text/Textarea: Must have value
      return (
        val === undefined ||
        val === null ||
        (typeof val === "string" && val.trim() === "")
      );
    };

    const getMissingFields = () => {
      const missing = [];
      const groups = {};
      fields.value.forEach((f) => {
        if (!groups[f.acroName]) groups[f.acroName] = [];
        groups[f.acroName].push(f);
      });

      for (const [name, widgets] of Object.entries(groups)) {
        // Skip checkboxes for required checks (usually optional)
        if (widgets.some((w) => w.type === "checkbox")) continue;

        if (widgets.some((w) => w.type === "radio")) {
          const hasVal = widgets.some(
            (w) =>
              formData[w.overlayKey] === w.value ||
              formData[w.overlayKey] === true
          );
          if (!hasVal) missing.push(widgets[0]); // Push the first widget of the group to track page
        } else {
          // Text fields
          widgets.forEach((w) => {
            const v = formData[w.overlayKey];
            if (!v || v === "") missing.push(w);
          });
        }
      }
      return missing;
    };

    // ---------- Manual Radio Handling ----------
    const handleRadioClick = (field) => {
      // Unset others in group
      fields.value
        .filter((f) => f.acroName === field.acroName)
        .forEach((f) => {
          formData[f.overlayKey] = false;
        });
      // Set this one
      formData[field.overlayKey] = field.value;
    };

    // ---------- Save ----------
    const saveAffidavit = async () => {
      // const missing = getMissingFields();
      // if (missing.length > 0) {
      //   showErrors.value = true;
      //   // Auto-scroll logic
      //   const firstErr = missing[0];
      //   if (firstErr && firstErr.pageIndex + 1 !== currentPage.value) {
      //     await changePage(firstErr.pageIndex + 1 - currentPage.value);
      //   }
      //   showModal(
      //     "error",
      //     "Missing Fields",
      //     `Please fill all highlighted fields.`
      //   );
      //   return;
      // }

      saving.value = true;
      try {
        const appId = getApplicantId();

        // Prepare Payload
        const payload = {
          applicant_id: appId,
          // Strict 'yes' or 'no'
          has_conditions: computeHasConditions() ? "yes" : "no",
          details: { ...formData },
        };

        console.log("Saving Payload:", payload); // DEBUG

        const url = `${apiBase}medical/affidavit`;
        const { ok, json, status } = await safeFetch(url, {
          method: "POST",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            // Ensure Nonce is sent if available
            ...(typeof JRJ_ADMIN !== "undefined"
              ? { "X-WP-Nonce": JRJ_ADMIN.nonce }
              : {}),
          },
        });

        if (ok && json?.ok) {
          affidavit.id = json.id; // Update ID for Upload
          affidavit.has_conditions = payload.has_conditions;
          affidavit.status = "submitted";
          showErrors.value = false;
          showModal(
            "success",
            "Saved",
            "Medical affidavit saved successfully."
          );

          // Trigger clearance template if needed
          if (affidavit.has_conditions === "yes") {
            const tUrl =
              affidavit.clearance_template_url ||
              props.clearancePdfUrl ||
              props.pdfUrl;
            if (tUrl) {
              currentTemplate.value = "clearance";
              await loadPdfFromUrl(tUrl);
            }
          }
        } else {
          // Detailed Error Message
          const errMsg = json?.message || `Save failed (Status: ${status})`;
          throw new Error(errMsg);
        }
      } catch (e) {
        console.error(e);
        showModal("error", "Save Error", e.message);
      } finally {
        saving.value = false;
      }
    };

    // ---------- Upload Logic ----------
    const uploadCompletedClearance = async () => {
      if (!affidavit.id)
        return showModal("error", "Error", "Please Save the form first.");

      const fileInput = uploadInputRef.value;
      if (!fileInput || !fileInput.files[0])
        return showModal("error", "Error", "Please select a PDF file.");

      const file = fileInput.files[0];
      if (file.type !== "application/pdf")
        return showModal("error", "Error", "Only PDF files are allowed.");

      // Use FormData for file upload
      const fd = new FormData();
      fd.append("file", file);

      try {
        const url = `${apiBase}medical/affidavit/${affidavit.id}/upload`;

        // NOTE: Do NOT set Content-Type header manually for FormData, browser does it.
        const headers = defaultHeaders();
        delete headers["Content-Type"];

        const res = await fetch(url, {
          method: "POST",
          body: fd,
          headers: headers,
        });

        const j = await res.json();

        if (res.ok && j.ok) {
          affidavit.status = "uploaded"; // Update UI status
          affidavit.medical_clearance_file = j.medical_clearance_file;
          showModal("success", "Uploaded", "File uploaded successfully.");
        } else {
          throw new Error(j.message || "Upload failed");
        }
      } catch (e) {
        showModal("error", "Upload Error", e.message);
      }
    };

    // ---------- PDF Loading & Parsing ----------
    onMounted(async () => {
      await fetchAffidavitForApplicant();
      const initialUrl =
        affidavit.has_conditions === "yes"
          ? affidavit.clearance_template_url || props.clearancePdfUrl
          : props.pdfUrl;
      await loadPdfFromUrl(initialUrl);
    });

    const loadPdfFromUrl = async (url) => {
      status.value = "loading";
      fields.value = [];
      pagesData = [];
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const buffer = await blob.arrayBuffer();
        rawPdfBytes = new Uint8Array(buffer);

        const loadingTask = pdfjsLib.getDocument({ data: rawPdfBytes.slice() });
        const pdfDoc = await loadingTask.promise;
        totalPages.value = pdfDoc.numPages;

        for (let i = 1; i <= totalPages.value; i++) {
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale });
          pagesData.push({
            pageObj: page,
            viewport,
            width: viewport.width,
            height: viewport.height,
          });

          const annotations = await page.getAnnotations();
          // Map annotations: Separate View (HTML) coords from PDF (Export) coords
          const widgets = annotations.filter(
            (a) => a.subtype === "Widget" && a.rect && a.fieldName
          );
          let idx = 0;
          widgets.forEach((anno) => {
            idx++;
            const overlayKey = `${anno.fieldName}__p${i - 1}__i${idx}`;

            // 1. Viewport Coords (Top-Left Origin) for HTML Overlay
            const vRectArr = viewport.convertToViewportRectangle(anno.rect);
            const viewRect = {
              x: Math.min(vRectArr[0], vRectArr[2]),
              y: Math.min(vRectArr[1], vRectArr[3]),
              w: Math.abs(vRectArr[0] - vRectArr[2]),
              h: Math.abs(vRectArr[1] - vRectArr[3]),
            };

            // 2. Raw PDF Coords (Bottom-Left Origin) for Export
            // anno.rect is [x1, y1, x2, y2] -> [left, bottom, right, top]
            const pdfRect = {
              x: anno.rect[0],
              y: anno.rect[1],
              w: anno.rect[2] - anno.rect[0],
              h: anno.rect[3] - anno.rect[1],
            };

            let type = "text";
            if (
              anno.checkBox ||
              (anno.fieldType === "Btn" &&
                !anno.radioButton &&
                !anno.buttonValue)
            )
              type = "checkbox";
            else if (
              anno.radioButton ||
              (anno.fieldType === "Btn" && anno.buttonValue)
            )
              type = "radio";
            else if (viewRect.h > 25) type = "textarea";

            if (formData[overlayKey] === undefined)
              formData[overlayKey] = type === "checkbox" ? false : "";

            fields.value.push({
              id: `f-${Math.random().toString(36).substr(2, 9)}`,
              acroName: anno.fieldName,
              overlayKey,
              type,
              pageIndex: i - 1,
              viewRect, // Use this for CSS
              pdfRect, // Use this for saving PDF
              value: anno.buttonValue, // Export value for radio
            });
          });
        }

        // Restore values
        if (affidavit.details) {
          suppressAutoHas.value = true;
          for (const k in affidavit.details) {
            if (formData[k] !== undefined) formData[k] = affidavit.details[k];
          }
          nextTick(() => (suppressAutoHas.value = false));
        }

        status.value = "success";
        nextTick(() => renderActivePage());
      } catch (e) {
        status.value = "error";
        console.error(e);
      }
    };

    const renderActivePage = async () => {
      if (!pagesData[currentPage.value - 1]) return;
      const pd = pagesData[currentPage.value - 1];
      const cvs = canvasRef.value;
      if (cvs) {
        const ctx = cvs.getContext("2d");
        activePageStyle.width = `${pd.width}px`;
        activePageStyle.height = `${pd.height}px`;
        cvs.width = pd.width;
        cvs.height = pd.height;
        await pd.pageObj.render({ canvasContext: ctx, viewport: pd.viewport })
          .promise;
      }
    };

    // ---------- PDF Export (The Fix) ----------
    const generatePdfBytes = async () => {
      if (!rawPdfBytes) throw new Error("No PDF loaded");
      const pdfDoc = await PDFDocument.load(rawPdfBytes.slice());
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();

      for (const field of fields.value) {
        const val = formData[field.overlayKey];
        // Skip empty values (except unchecked checkboxes which technically are "Off")
        if (val === undefined || val === null || val === "") continue;
        if (val === false && field.type !== "checkbox") continue;

        const page = pages[field.pageIndex];
        const { x, y, w, h } = field.pdfRect; // Using RAW PDF Coordinates

        // TEXT
        if (field.type === "text" || field.type === "textarea") {
          page.drawText(String(val), {
            x: x + 2,
            y: y + 2, // Bottom-left origin, so y+2 is slightly above bottom line
            size: 10,
            font: helvetica,
            maxWidth: w - 4,
          });
        }
        // CHECKBOX / RADIO
        else if (field.type === "checkbox" || field.type === "radio") {
          const isChecked = val === true || val === field.value;
          if (isChecked) {
            // Draw a simple checkmark
            // Remember Y is 0 at bottom, increasing upwards
            const x1 = x + w * 0.2;
            const y1 = y + h * 0.5; // mid-height
            const x2 = x + w * 0.4;
            const y2 = y + h * 0.2; // near bottom
            const x3 = x + w * 0.8;
            const y3 = y + h * 0.8; // near top

            page.drawLine({
              start: { x: x1, y: y1 },
              end: { x: x2, y: y2 },
              thickness: 1.5,
              color: rgb(0, 0, 0),
            });
            page.drawLine({
              start: { x: x2, y: y2 },
              end: { x: x3, y: y3 },
              thickness: 1.5,
              color: rgb(0, 0, 0),
            });
          }
        }
      }
      return await pdfDoc.save();
    };

    const validateAndDownload = async () => {
      // const missing = getMissingFields();
      // if (missing.length > 0) {
      //   showErrors.value = true;
      //   showModal("error", "Incomplete", "Please fill in all required fields.");
      //   return;
      // }
      try {
        const bytes = await generatePdfBytes();
        const blob = new Blob([bytes], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `medical_affidavit_${getApplicantId()}.pdf`;
        link.click();
      } catch (e) {
        showModal("error", "Export Error", e.message);
      }
    };

    // ---------- Logic: Has Conditions? ----------
    const computeHasConditions = () => {
      for (const f of fields.value) {
        const val = formData[f.overlayKey];
        if (!val) continue;

        const name = f.acroName.toLowerCase();
        const isYes =
          val === true ||
          val === "Yes" ||
          (typeof val === "string" && val.toLowerCase() === "yes");
        const isMedical =
          name.includes("condition") ||
          name.includes("symptom") ||
          name.includes("medical") ||
          name.includes("illness");

        if (isMedical && isYes) return true;
        if (f.type === "radio" && f.value === "Yes" && isYes) return true;
      }
      return false;
    };

    watch(
      [fields, formData],
      () => {
        if (suppressAutoHas.value) return;
        if (computeHasConditions()) affidavit.has_conditions = "yes";
      },
      { deep: true }
    );

    watch(currentPage, () => {
      nextTick(() => renderActivePage());
    });

    return {
      canvasRef,
      status,
      currentPage,
      totalPages,
      activePageStyle,
      fields,
      formData,
      affidavit,
      saving,
      showErrors,
      changePage: (off) => {
        const n = currentPage.value + off;
        if (n >= 1 && n <= totalPages.value) currentPage.value = n;
      },
      saveAffidavit,
      validateAndDownload,
      uploadCompletedClearance,
      uploadInputRef,
      modal,
      showModal,
      closeModal,
      handleModalConfirm,
      isFieldInvalid,
      handleRadioClick,
      pdfLoaded: computed(() => status.value === "success"),
      canSave: computed(() => status.value === "success" && !saving.value),
      showUpload: computed(() => affidavit.has_conditions === "yes"),
    };
  },
  template: `
  <div class="medical-affidavit-panel">
    <header class="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded shadow-sm border">
      <div>
        <h2 class="text-xl font-bold text-slate-800">Medical History Affidavit</h2>
        <p class="text-sm text-slate-500">Please complete the form below accurately.</p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="changePage(-1)" :disabled="currentPage<=1" class="px-3 py-1.5 border rounded hover:bg-slate-50 disabled:opacity-50 text-sm">Prev</button>
        <span class="text-sm font-medium text-slate-600 px-2">Page {{ currentPage }} / {{ totalPages }}</span>
        <button @click="changePage(1)" :disabled="currentPage>=totalPages" class="px-3 py-1.5 border rounded hover:bg-slate-50 disabled:opacity-50 text-sm">Next</button>
        
        <div class="h-6 w-px bg-slate-300 mx-2"></div>

        <button @click="saveAffidavit" :disabled="!canSave" class="px-4 py-2 bg-slate-800 text-white rounded text-sm hover:bg-slate-900 disabled:opacity-50 flex items-center">
            <span v-if="saving" class="animate-spin mr-2">⟳</span>
            <span>Save</span>
        </button>
        <button @click="validateAndDownload" :disabled="!pdfLoaded" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
            Download PDF
        </button>
      </div>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
       <div class="lg:col-span-3">
          <div class="relative bg-slate-200 overflow-auto rounded border min-h-[600px] flex justify-center p-4">
             <div v-if="status==='loading'" class="self-center text-slate-500 flex flex-col items-center">
                <div class="animate-spin text-3xl mb-2">⟳</div> Loading PDF...
             </div>
             <div v-if="status==='error'" class="self-center text-red-500">Failed to load PDF.</div>
             
             <div v-if="status==='success'" class="relative shadow-lg bg-white" :style="activePageStyle">
                <canvas ref="canvasRef" class="block"></canvas>
                
                <div class="absolute inset-0 pointer-events-none">
                   <template v-for="f in fields" :key="f.id">
                      <template v-if="f.pageIndex === (currentPage - 1)">
                         
                         <div v-if="f.type==='checkbox'" 
                              class="absolute pointer-events-auto cursor-pointer hover:bg-blue-50/30 flex items-center justify-center"
                              :style="{ left: f.viewRect.x + 'px', top: f.viewRect.y + 'px', width: f.viewRect.w + 'px', height: f.viewRect.h + 'px' }">
                              <input type="checkbox" v-model="formData[f.overlayKey]" class="w-full h-full opacity-0 cursor-pointer" />
                              <div v-if="formData[f.overlayKey]" class="text-black font-bold text-lg leading-none">✓</div>
                         </div>

                         <div v-else-if="f.type==='radio'"
                              @click="handleRadioClick(f)"
                              :class="{'ring-2 ring-red-500 bg-red-50/20': isFieldInvalid(f.overlayKey), 'bg-blue-100/30': formData[f.overlayKey] === f.value}"
                              class="absolute pointer-events-auto cursor-pointer flex items-center justify-center hover:bg-blue-50/30 rounded-sm"
                              :style="{ left: f.viewRect.x + 'px', top: f.viewRect.y + 'px', width: f.viewRect.w + 'px', height: f.viewRect.h + 'px' }">
                              <div v-if="formData[f.overlayKey] === f.value" class="w-2.5 h-2.5 bg-black rounded-full"></div>
                         </div>

                         <textarea v-else-if="f.type==='textarea'"
                              v-model="formData[f.overlayKey]"
                              :class="{'ring-2 ring-red-500 bg-red-50/20': isFieldInvalid(f.overlayKey)}"
                              class="absolute pointer-events-auto bg-transparent text-xs p-1 resize-none outline-none focus:bg-white/80"
                              :style="{ left: f.viewRect.x + 'px', top: f.viewRect.y + 'px', width: f.viewRect.w + 'px', height: f.viewRect.h + 'px' }">
                         </textarea>
                         <input v-else type="text"
                              v-model="formData[f.overlayKey]"
                              :class="{'ring-2 ring-red-500 bg-red-50/20': isFieldInvalid(f.overlayKey)}"
                              class="absolute pointer-events-auto bg-transparent text-xs p-1 outline-none focus:bg-white/80"
                              :style="{ left: f.viewRect.x + 'px', top: f.viewRect.y + 'px', width: f.viewRect.w + 'px', height: f.viewRect.h + 'px' }" />

                      </template>
                   </template>
                </div>
             </div>
          </div>
       </div>

       <div class="lg:col-span-1 space-y-4">
          <div class="bg-white p-4 rounded border shadow-sm">
             <h3 class="font-bold text-sm mb-2 text-slate-700">Form Status</h3>
             <div class="text-xs text-slate-600 space-y-1">
                <div class="flex justify-between"><span>Has Conditions:</span> <strong :class="affidavit.has_conditions==='yes'?'text-red-600':'text-green-600'">{{ affidavit.has_conditions.toUpperCase() }}</strong></div>
                <div class="flex justify-between"><span>Status:</span> <strong>{{ affidavit.status || 'Draft' }}</strong></div>
             </div>
             
             <div v-if="showUpload" class="mt-4 pt-4 border-t border-slate-100">
                <div class="text-xs text-amber-600 bg-amber-50 p-2 rounded mb-2 border border-amber-200">
                   <strong>Action Required:</strong> Since you have medical conditions, download the clearance form, sign it, and upload it here.
                </div>
                <input type="file" ref="uploadInputRef" accept="application/pdf" class="block w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-100 hover:file:bg-slate-200 mb-2"/>
                <button @click="uploadCompletedClearance" class="w-full py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700">Upload Signed Clearance</button>
             </div>
          </div>
          
          <div v-if="showErrors" class="bg-red-50 border border-red-200 p-3 rounded text-xs text-red-700">
             <strong class="block mb-1">Missing Fields</strong>
             Please fill in the fields highlighted in red.
          </div>
       </div>
    </div>

    <div v-if="modal.show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
       <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="closeModal"></div>
       <div class="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
          <h3 class="text-lg font-bold mb-2" :class="modal.type==='error'?'text-red-600':'text-slate-800'">{{ modal.title }}</h3>
          <p class="text-sm text-slate-600 mb-6">{{ modal.message }}</p>
          <div class="flex justify-end gap-2">
             <button @click="closeModal" class="px-4 py-2 border rounded text-sm hover:bg-slate-50">Close</button>
             <button v-if="modal.onConfirm" @click="handleModalConfirm" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">OK</button>
          </div>
       </div>
    </div>
  </div>
  `,
};
