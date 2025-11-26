import { ref, reactive, computed, onMounted, watch, nextTick } from "vue";
import * as pdfjsLib from "pdfjs-dist";
import {
  PDFDocument,
  rgb,
  StandardFonts,
} from "pdf-lib";

// --- WORKER CONFIGURATION ---
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
  },
  setup(props) {
    // --- STATE ---
    const scale = 1.5;
    const fileInputRef = ref(null);
    const canvasRef = ref(null);
    const status = ref("idle");

    const currentPage = ref(1);
    const totalPages = ref(0);
    let pagesData = [];

    const activePageStyle = reactive({ width: "0px", height: "0px" });
    const fields = ref([]);

    // Load from LocalStorage
    const storageKey = `pdf_data_${props.applicantId}`;
    const savedData = localStorage.getItem(storageKey);
    const formData = reactive(savedData ? JSON.parse(savedData) : {});

    let rawPdfBytes = null;

    // --- MODAL STATE ---
    const modal = reactive({
      show: false,
      type: "info", // 'confirm' or 'error'
      title: "",
      message: "",
      confirmText: "OK",
      onConfirm: null,
    });

    // --- WATCHER ---
    watch(
      formData,
      (newVal) => {
        localStorage.setItem(storageKey, JSON.stringify(newVal));
      },
      { deep: true }
    );

    // --- LIFECYCLE ---
    onMounted(() => {
      if (props.pdfUrl) loadPdfFromUrl(props.pdfUrl);
    });

    // --- METHODS ---

    const showModal = (type, title, message, confirmText, callback = null) => {
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

    const performClear = () => {
      Object.keys(formData).forEach((key) => delete formData[key]);
      localStorage.removeItem(storageKey);
      fields.value.forEach((f) => {
        if (f.type === "checkbox") formData[f.name] = false;
        else formData[f.name] = "";
      });
    };

    const requestClearForm = () => {
      showModal(
        "confirm",
        "Clear Entire Form?",
        "Are you sure you want to clear all fields? This action cannot be undone.",
        "Yes, Clear Form",
        performClear
      );
    };

    // --- VALIDATION LOGIC ---
    const validateAndDownload = () => {
      // 1. Get all unique field names from the PDF
      const allFieldNames = [...new Set(fields.value.map((f) => f.name))];
      const missingFields = [];

      allFieldNames.forEach((name) => {
        const val = formData[name];

        // Check if field is empty or undefined
        // For checkboxes (boolean), false is considered "filled" (unchecked),
        // so we primarily check for empty strings (text/radio) or null/undefined.
        // If you require specific checkboxes to be checked, you'd need extra logic.
        if (val === undefined || val === "" || val === null) {
          missingFields.push(name);
        }
      });

      if (missingFields.length > 0) {
        showModal(
          "error",
          "Missing Information",
          `Please fill in all required fields. You have missed ${missingFields.length} field(s).`,
          "OK"
        );
        return; // Stop download
      }

      // If validation passes, proceed to download
      generateAndDownload();
    };

    const changePage = async (offset) => {
      const newPage = currentPage.value + offset;
      if (newPage >= 1 && newPage <= totalPages.value) {
        currentPage.value = newPage;
        await nextTick();
        renderActivePage();
      }
    };

    const renderActivePage = async () => {
      if (!pagesData.length) return;
      const pageData = pagesData[currentPage.value - 1];
      const canvas = canvasRef.value;

      if (canvas && pageData) {
        const ctx = canvas.getContext("2d");
        activePageStyle.width = `${pageData.width}px`;
        activePageStyle.height = `${pageData.height}px`;
        canvas.width = pageData.width;
        canvas.height = pageData.height;

        await pageData.pageObj.render({
          canvasContext: ctx,
          viewport: pageData.viewport,
        }).promise;
      }
    };

    const loadPdfFromUrl = async (url) => {
      try {
        status.value = "loading";
        const response = await fetch(url);
        const blob = await response.blob();
        await processPdfFile(blob);
      } catch (err) {
        console.error(err);
        status.value = "error";
      }
    };

    const processPdfFile = async (fileOrBlob) => {
      try {
        status.value = "loading";
        fields.value = [];
        pagesData = [];
        currentPage.value = 1;

        const buffer = await fileOrBlob.arrayBuffer();
        rawPdfBytes = buffer;
        const pdfJsBuffer = buffer.slice(0);

        const loadingTask = pdfjsLib.getDocument(pdfJsBuffer);
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
          mapAnnotationsToFields(annotations, i - 1, viewport);
        }

        status.value = "success";
        await nextTick();
        renderActivePage();
      } catch (err) {
        console.error(err);
        status.value = "error";
      }
    };

    const mapAnnotationsToFields = (annotations, pageIndex, viewport) => {
      const widgets = annotations.filter((a) => a.subtype === "Widget");

      widgets.forEach((anno) => {
        const {
          fieldName,
          fieldType,
          rect,
          buttonValue,
          checkBox,
          radioButton,
        } = anno;
        if (!rect || !fieldName) return;

        const pdfRect = {
          x: rect[0],
          y: rect[1],
          w: rect[2] - rect[0],
          h: rect[3] - rect[1],
        };

        // Viewport calc for HTML overlay
        const viewRect = viewport.convertToViewportRectangle(rect);
        const x = Math.min(viewRect[0], viewRect[2]);
        const y = Math.min(viewRect[1], viewRect[3]);
        const w = Math.abs(viewRect[0] - viewRect[2]);
        const h = Math.abs(viewRect[1] - viewRect[3]);

        let type = "text";
        if (checkBox || (fieldType === "Btn" && !radioButton && !buttonValue))
          type = "checkbox";
        else if (radioButton || (fieldType === "Btn" && buttonValue))
          type = "radio";
        else type = h > 25 ? "textarea" : "text";

        // Init Data if missing
        if (formData[fieldName] === undefined) {
          if (type === "checkbox") formData[fieldName] = false;
          else formData[fieldName] = "";
        }

        fields.value.push({
          id: `f-${Math.random().toString(36).substr(2, 9)}`,
          name: fieldName,
          type,
          pageIndex,
          x,
          y,
          w,
          h,
          pdfRect,
          value: buttonValue,
        });
      });
    };

    // --- GENERATE PDF (DRAWING METHOD) ---
    const generateAndDownload = async () => {
      if (!rawPdfBytes) return;

      try {
        const pdfDoc = await PDFDocument.load(rawPdfBytes.slice(0));
        const helvetica = await pdfDoc.embedFont("Helvetica");
        const form = pdfDoc.getForm();

        for (const field of fields.value) {
          const val = formData[field.name];
          const page = pdfDoc.getPages()[field.pageIndex];
          const { x, y, w, h } = field.pdfRect;

          if (!val) continue;

          // Text
          if (field.type === "text" || field.type === "textarea") {
            try {
              const textField = form.getTextField(field.name);
              textField.setText(val);
            } catch (e) {
              page.drawText(val, {
                x: x + 2,
                y: y + 2,
                size: 10,
                font: helvetica,
              });
            }
          }
          // Check/Radio Drawing
          else if (field.type === "radio" || field.type === "checkbox") {
            const isMatch = val === field.value || val === true;
            if (isMatch) {
              const x1 = x + w * 0.2;
              const y1 = y + h * 0.5;

              const x2 = x + w * 0.45;
              const y2 = y + h * 0.2;

              const x3 = x + w * 0.8;
              const y3 = y + h * 0.8;

              // left
              page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
                thickness: 1.5,
                color: rgb(0, 0, 0),
              });

              // right
              page.drawLine({
                start: { x: x2, y: y2 },
                end: { x: x3, y: y3 },
                thickness: 1.5,
                color: rgb(0, 0, 0),
              });
            }
          }
        }

        try {
          form.flatten();
        } catch (e) {}

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `applicant_${props.applicantId}_filled.pdf`;
        link.click();
      } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
      }
    };

    return {
      canvasRef,
      status,
      currentPage,
      totalPages,
      changePage,
      activePageStyle,
      fields,
      formData,
      validateAndDownload, // Used in template
      requestClearForm,
      modal,
      closeModal,
      handleModalConfirm,
    };
  },

  template: `
  <div class="medical-affidavit-panel flex flex-col h-full font-sans text-slate-800 bg-white relative">
    
    <div v-if="modal.show" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity">
        <div class="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100">
            
            <div class="px-6 py-4 border-b border-gray-100 flex items-center gap-3" 
                 :class="modal.type === 'confirm' ? 'bg-red-50' : 'bg-blue-50'">
                <div class="w-10 h-10 rounded-full flex items-center justify-center"
                     :class="modal.type === 'confirm' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'">
                    <i class="fa-solid" :class="modal.type === 'confirm' ? 'fa-triangle-exclamation' : 'fa-circle-info'"></i>
                </div>
                <h3 class="text-lg font-bold" :class="modal.type === 'confirm' ? 'text-red-700' : 'text-blue-700'">
                    {{ modal.title }}
                </h3>
            </div>

            <div class="p-6 text-gray-600 text-sm leading-relaxed">
                {{ modal.message }}
            </div>

            <div class="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                <button @click="closeModal" 
                        class="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-100 transition">
                    Cancel
                </button>
                
                <button v-if="modal.type === 'confirm'" 
                        @click="handleModalConfirm"
                        class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition shadow-sm">
                    {{ modal.confirmText }}
                </button>
                <button v-else 
                        @click="closeModal"
                        class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition shadow-sm">
                    OK
                </button>
            </div>
        </div>
    </div>

    <header class="sticky top-0 z-50 bg-white border-b border-gray-200 flex justify-between items-center">
      <div>
        <div class="flex flex-col">
             <h2 class="text-2xl font-bold text-gray-800">Medical History Affidavit</h2>
             <p class="text-gray-500 text-sm mt-1">Fill out and download your medical history form.</p>
        </div>
      </div>
      
      <div class="flex items-center gap-3">
        <div v-if="status === 'loading'" class="mr-4 text-sm text-blue-600 flex items-center gap-2">
          <i class="fa-solid fa-spinner fa-spin"></i> Loading...
        </div>

        <div class="h-8 w-px bg-gray-200 mx-2"></div>

        <button @click="requestClearForm" 
                  class="px-4 py-2 bg-white text-red-600 border border-red-200 hover:bg-red-50 rounded-lg text-sm font-medium transition shadow-sm">
            Clear Form
          </button>
        
        <button @click="validateAndDownload" 
                :disabled="status !== 'success'" 
                class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md">
          Download Filled
        </button>
      </div>
    </header>

    <main class="flex-1 relative overflow-auto bg-gray-50 flex flex-col items-center w-full">
      
      <div class="py-8 px-4 w-full flex justify-center">
        <div v-show="status === 'success'" class="relative shadow-xl bg-white transition-all" :style="activePageStyle">
          
          <canvas ref="canvasRef" class="block rounded-sm"></canvas>

          <div class="absolute inset-0">
            <template v-for="field in fields" :key="field.id">
              <template v-if="field.pageIndex === (currentPage - 1)">
                
                <input v-if="field.type === 'checkbox'" type="checkbox" v-model="formData[field.name]" 
                       class="absolute cursor-pointer accent-blue-600 bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20" 
                       :style="{ left: field.x + 'px', top: field.y + 'px', width: field.w + 'px', height: field.h + 'px' }" />
                
                <input v-else-if="field.type === 'radio'" type="radio" 
                       :name="field.name" :value="field.value" v-model="formData[field.name]" 
                       class="absolute cursor-pointer accent-blue-600" 
                       :style="{ left: field.x + 'px', top: field.y + 'px', width: field.w + 'px', height: field.h + 'px' }" />
                
                <textarea v-else-if="field.type === 'textarea'" v-model="formData[field.name]" 
                          class="absolute bg-blue-600/10 border border-blue-600/20 text-xs p-1 resize-none focus:bg-white focus:border-blue-600 outline-none rounded-sm text-gray-800 font-medium" 
                          :style="{ left: field.x + 'px', top: field.y + 'px', width: field.w + 'px', height: field.h + 'px' }"></textarea>
                
                <input v-else type="text" v-model="formData[field.name]" 
                       class="absolute bg-blue-600/10 border-blue-600/20 text-xs p-1 focus:bg-white focus:border-blue-600 outline-none rounded-sm text-gray-800 font-medium" 
                       :style="{ left: field.x + 'px', top: field.y + 'px', width: field.w + 'px', height: field.h + 'px' }" />
              
              </template>
            </template>
          </div>
        </div>
      </div>
    </main>

    <footer v-if="status === 'success'" class="sticky bottom-0 z-50 bg-white border-t border-gray-200 h-16 flex items-center justify-between px-8 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button @click="changePage(-1)" :disabled="currentPage <= 1" class="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50 transition flex items-center shadow-sm">
          <i class="fa-solid fa-chevron-left mr-2"></i> Previous
        </button>
        
        <span class="font-medium text-gray-600 bg-gray-100 px-4 py-1.5 rounded-full text-xs border border-gray-200">
          Page {{ currentPage }} of {{ totalPages }}
        </span>
        
        <button @click="changePage(1)" :disabled="currentPage >= totalPages" class="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50 transition flex items-center shadow-sm">
          Next <i class="fa-solid fa-chevron-right ml-2"></i>
        </button>
    </footer>
  </div>
  `,
};