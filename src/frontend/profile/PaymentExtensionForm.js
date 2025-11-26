/* PaymentExtensionForm.js — Cleaned, event-listener auto-capture, inline badge, submitted state notice */
import {
  ref,
  reactive,
  onMounted,
  nextTick,
  watch,
  computed,
  onUnmounted,
} from "vue";
import { VueSignaturePad } from "@selemondev/vue3-signature-pad";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

export default {
  name: "PaymentExtensionForm",
  components: { VueSignaturePad },
  props: {
    applicantId: { type: Number, required: false, default: 0 },
    pdfUrl: {
      type: String,
      required: false,
      default:
        "/wp-content/plugins/jamrock/assets/pdf/payment_extension_agreement.pdf",
    },
  },
  setup(props) {
    // CORE
    const scale = 1.5;
    const canvasRef = ref(null);
    const status = ref("idle");
    const currentPage = ref(1);
    const totalPages = ref(0);
    let pagesData = [];
    const activePageStyle = reactive({ width: "0px", height: "0px" });
    const fields = ref([]);
    const formData = reactive({});
    let rawPdfBytes = null;

    // item + UI state
    const item = reactive({});
    const saving = ref(false);
    const error = ref("");
    const message = ref("");
    const showPanel = ref(true); // controls main panel visibility (used for resubmit UX)

    // SIGNATURE
    const showSigModal = ref(false);
    const sigPadRef = ref(null);
    const signatureMode = ref("draw"); // 'draw'|'type'
    const typedSignature = ref("");
    const signatureDataUrl = ref(null);
    const activeSignatureField = ref(null);
    const signatureViewRect = ref(null);
    const sigOptions = reactive({
      penColor: "#000000",
      maxWidth: 2.5,
      minWidth: 1,
      backgroundColor: "rgba(255,255,255,0)",
    });

    // modal
    const modal = reactive({
      show: false,
      type: "info",
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

    // Prefill helpers
    const prefillSource = reactive({});
    const fieldMapKeys = {
      tenant_first_name: "tenant_first_name",
      tenant_last_name: "tenant_last_name",
      tenant_name: "tenant_name",
      phone: "tenant_phone",
      email: "tenant_email",
      rental_address: "property_address",
      address: "property_address",
      due_on: "original_due_date",
      date: "signed_date",
    };

    // Fetch API data — NOTE: does NOT mutate showPanel now
    const fetchPrefillFromApi = async () => {
      try {
        let applicant =
          props.applicantId ||
          (typeof JRJ_USER !== "undefined" && JRJ_USER?.id) ||
          0;
        if (!applicant) return;
        if (typeof JRJ_ADMIN === "undefined" || !JRJ_ADMIN?.root) return;
        const url = `${
          JRJ_ADMIN.root
        }payment-extensions/find?applicant_id=${encodeURIComponent(applicant)}`;
        const res = await fetch(url, {
          credentials: "same-origin",
          headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
        });
        if (!res.ok) return;
        const j = await res.json().catch(() => ({ ok: false }));
        if (!j.ok || !j.item) return;
        Object.assign(item, j.item || {});
        // parse db fields
        let dbFields = {};
        if (item.payment_extension) {
          try {
            const p =
              typeof item.payment_extension === "string"
                ? JSON.parse(item.payment_extension)
                : item.payment_extension;
            if (p && p.fields_json)
              dbFields =
                typeof p.fields_json === "string"
                  ? JSON.parse(p.fields_json || "{}")
                  : p.fields_json || {};
          } catch (e) {}
        }
        if (Object.keys(dbFields).length === 0 && item.fields_json) {
          try {
            dbFields =
              typeof item.fields_json === "string"
                ? JSON.parse(item.fields_json)
                : item.fields_json;
          } catch (e) {}
        }
        Object.assign(prefillSource, dbFields || {});
        if (item.tenant_name) prefillSource.tenant_name = item.tenant_name;
        if (item.tenant_phone) prefillSource.tenant_phone = item.tenant_phone;
        if (item.tenant_email) prefillSource.tenant_email = item.tenant_email;
        if (item.property_address)
          prefillSource.property_address = item.property_address;
        if (!prefillSource.signed_date)
          prefillSource.signed_date = new Date().toISOString().slice(0, 10);

        // IMPORTANT: DO NOT toggle showPanel here — leave UI decision to caller (onMounted / resubmit / submit)
      } catch (err) {
        // noop in UI — keep silent
      }
    };

    // PDF loading & parsing
    const loadPdfFromUrl = async (url) => {
      try {
        status.value = "loading";
        const fetchOpts = { credentials: "same-origin" };
        if (typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN?.nonce)
          fetchOpts.headers = { "X-WP-Nonce": JRJ_ADMIN.nonce };
        const response = await fetch(url, fetchOpts);
        const blob = await response.blob();
        await processPdfFile(blob);
      } catch (err) {
        showModal("error", "Load Error", err.message || String(err));
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
        const first4 = new Uint8Array(buffer.slice(0, 4));
        const firstStr = String.fromCharCode(...first4);
        if (firstStr !== "%PDF")
          throw new Error("Loaded resource isn't a PDF.");
        const mainBytes = new Uint8Array(buffer);
        rawPdfBytes = mainBytes.slice();
        const pdfJsBuffer = mainBytes.slice();
        const loadingTask = pdfjsLib.getDocument({ data: pdfJsBuffer });
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
        applyPrefillToFields();
        status.value = "success";
        await nextTick();
        renderActivePage();
      } catch (err) {
        showModal("error", "PDF Error", err.message || String(err));
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
        const x1 = rect[0],
          y1 = rect[1],
          x2 = rect[2],
          y2 = rect[3];
        const pdfRect = {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1),
        };
        const viewRectArray = viewport.convertToViewportRectangle(rect);
        const vx = Math.min(viewRectArray[0], viewRectArray[2]);
        const vy = Math.min(viewRectArray[1], viewRectArray[3]);
        const vw = Math.abs(viewRectArray[0] - viewRectArray[2]);
        const vh = Math.abs(viewRectArray[1] - viewRectArray[3]);
        const nameLower = (fieldName || "").toLowerCase();
        let type = "text";
        if (nameLower.includes("sign") || nameLower.includes("signature"))
          type = "signature";
        else if (
          checkBox ||
          (fieldType === "Btn" && !radioButton && !buttonValue)
        )
          type = "checkbox";
        else if (radioButton || (fieldType === "Btn" && buttonValue))
          type = "radio";
        else type = vh > 25 ? "textarea" : "text";
        if (formData[fieldName] === undefined && type !== "signature") {
          if (type === "checkbox") formData[fieldName] = false;
          else formData[fieldName] = "";
        }
        fields.value.push({
          id: `f-${Math.random().toString(36).substr(2, 9)}`,
          name: fieldName,
          type,
          pageIndex,
          viewRect: { x: vx, y: vy, w: vw, h: vh },
          pdfRect,
          value: buttonValue,
        });
      });
    };

    const applyPrefillToFields = () => {
      for (const f of fields.value) {
        if (f.type === "signature") continue;
        const fname = (f.name || "").toLowerCase();
        if (
          prefillSource[f.name] !== undefined &&
          prefillSource[f.name] !== null &&
          prefillSource[f.name] !== ""
        ) {
          formData[f.name] = prefillSource[f.name];
          continue;
        }
        for (const frag in fieldMapKeys) {
          if (fname.includes(frag)) {
            const srcKey = fieldMapKeys[frag];
            const v = prefillSource[srcKey];
            if (v !== undefined && v !== null && v !== "") {
              if (
                srcKey === "tenant_first_name" &&
                prefillSource.tenant_last_name
              ) {
                formData[f.name] = `${prefillSource.tenant_first_name || ""} ${
                  prefillSource.tenant_last_name || ""
                }`.trim();
              } else {
                formData[f.name] = v;
              }
              break;
            }
          }
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      const signedKeys = ["signed_date", "date", "Date"];
      for (const k of signedKeys) {
        if (!formData[k]) formData[k] = prefillSource[k] || today;
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

    // signature generation (draw/type)
    const generateSignatureImage = async () => {
      if (signatureMode.value === "draw") {
        const pad = sigPadRef.value;
        if (!pad) return null;
        try {
          if (typeof pad.saveSignature === "function") {
            const maybe = pad.saveSignature("image/png");
            const result = maybe instanceof Promise ? await maybe : maybe;
            if (!result) return null;
            if (typeof result === "string") return result;
            if (result.isEmpty) return null;
            if (result.data) return result.data;
          }
          if (typeof pad.toDataURL === "function") {
            if (typeof pad.isEmpty === "function" && pad.isEmpty()) return null;
            return pad.toDataURL("image/png");
          }
        } catch (e) {
          return null;
        }
      }
      if (signatureMode.value === "type") {
        const txt = (typedSignature.value || "").trim();
        if (!txt) return null;
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 150;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = "60px 'Pacifico', cursive";
        ctx.fillStyle = "#000";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(txt, canvas.width / 2, canvas.height / 2);
        return canvas.toDataURL("image/png");
      }
      return null;
    };

    const saveSignature = async () => {
      const img = await generateSignatureImage();
      if (!img) {
        showModal(
          "error",
          "Signature required",
          "Please draw or type your signature."
        );
        return;
      }
      signatureDataUrl.value = img;
      if (!signatureViewRect.value) {
        const sf = fields.value.find((f) => f.type === "signature");
        if (sf) {
          const vp = pagesData[sf.pageIndex]?.viewport;
          signatureViewRect.value = {
            ...sf.viewRect,
            pageIndex: sf.pageIndex,
            viewportScale: vp?.scale || scale,
          };
          activeSignatureField.value = sf;
        }
      }
      if (activeSignatureField.value)
        formData[activeSignatureField.value.name] = "__signed__";
      showSigModal.value = false;
    };

    // event-listener based auto-capture (preferred) with fallback to small polling
    let padCanvasEl = null;
    let pollHandle = null;

    const attachCanvasListeners = () => {
      padCanvasEl = null;
      try {
        const pad = sigPadRef.value;
        if (!pad) return;
        const rootEl = pad.$el || pad.el || pad;
        if (rootEl && typeof rootEl.querySelector === "function") {
          padCanvasEl = rootEl.querySelector("canvas");
        } else if (pad.$el && pad.$el.querySelector) {
          padCanvasEl = pad.$el.querySelector("canvas");
        }
      } catch (e) {
        padCanvasEl = null;
      }

      if (padCanvasEl) {
        padCanvasEl.addEventListener("pointerup", onPadPointerUp);
        padCanvasEl.addEventListener("pointercancel", onPadPointerUp);
      } else {
        if (pollHandle) clearInterval(pollHandle);
        pollHandle = setInterval(async () => {
          if (!sigPadRef.value) return;
          const d = await generateSignatureImage().catch(() => null);
          if (d) {
            signatureDataUrl.value = d;
            if (!activeSignatureField.value)
              activeSignatureField.value =
                fields.value.find((f) => f.type === "signature") || null;
            clearInterval(pollHandle);
            pollHandle = null;
          }
        }, 400);
      }
    };

    const detachCanvasListeners = () => {
      if (padCanvasEl) {
        padCanvasEl.removeEventListener("pointerup", onPadPointerUp);
        padCanvasEl.removeEventListener("pointercancel", onPadPointerUp);
        padCanvasEl = null;
      }
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    };

    const onPadPointerUp = async () => {
      const img = await generateSignatureImage().catch(() => null);
      if (img) {
        signatureDataUrl.value = img;
        if (!activeSignatureField.value)
          activeSignatureField.value =
            fields.value.find((f) => f.type === "signature") || null;
      }
    };

    // auto-type: watch typedSignature and create image
    watch(typedSignature, async (val) => {
      if (signatureMode.value !== "type") return;
      if (!val || !val.trim()) return;
      const img = await generateSignatureImage().catch(() => null);
      if (img) {
        signatureDataUrl.value = img;
        if (!activeSignatureField.value)
          activeSignatureField.value =
            fields.value.find((f) => f.type === "signature") || null;
      }
    });

    // when signature modal opened/closed attach/detach listeners
    watch(showSigModal, (open) => {
      if (open) {
        nextTick(() => attachCanvasListeners());
      } else {
        detachCanvasListeners();
      }
    });

    onUnmounted(() => {
      detachCanvasListeners();
    });

    // computed flag for signed state
    const isSigned = computed(() => {
      if (signatureDataUrl.value) return true;
      if (
        signatureMode.value === "type" &&
        typedSignature.value &&
        typedSignature.value.trim()
      )
        return true;
      return false;
    });

    // PDF generation core
    const generatePdfBytes = async () => {
      if (!rawPdfBytes) throw new Error("No PDF loaded");
      const u8 = rawPdfBytes;
      const header = String.fromCharCode(...u8.subarray(0, 4));
      if (!header.startsWith("%PDF")) throw new Error("Not a PDF");
      const pdfDoc = await PDFDocument.load(u8);
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const form = pdfDoc.getForm ? pdfDoc.getForm() : null;
      const pdfPages = pdfDoc.getPages();

      let signatureImage = null;
      if (signatureDataUrl.value) {
        try {
          signatureImage = await pdfDoc.embedPng(signatureDataUrl.value);
        } catch (e) {
          signatureImage = null;
        }
      }

      for (const field of fields.value) {
        const val = formData[field.name];
        const page = pdfPages[field.pageIndex || 0];
        const { pdfRect, viewRect } = field;

        if (field.type === "signature" && signatureImage) {
          let target = null;
          if (
            signatureViewRect.value &&
            signatureViewRect.value.pageIndex === field.pageIndex
          ) {
            const vpScale =
              signatureViewRect.value.viewportScale ||
              pagesData[field.pageIndex]?.viewport?.scale ||
              scale;
            const pageHeight = page.getHeight();
            const vx = signatureViewRect.value.x,
              vy = signatureViewRect.value.y,
              vw = signatureViewRect.value.w,
              vh = signatureViewRect.value.h;
            const pdfX = vx / vpScale;
            const pdfY_bottom = pageHeight - (vy + vh) / vpScale;
            target = {
              x: pdfX,
              y: pdfY_bottom,
              w: vw / vpScale,
              h: vh / vpScale,
            };
          }
          if (!target && viewRect) {
            const vp = pagesData[field.pageIndex]?.viewport;
            const vpScale = vp?.scale || scale;
            const pageHeight = page.getHeight();
            const pdfX = viewRect.x / vpScale;
            const pdfY_bottom =
              pageHeight - (viewRect.y + viewRect.h) / vpScale;
            target = {
              x: pdfX,
              y: pdfY_bottom,
              w: viewRect.w / vpScale,
              h: viewRect.h / vpScale,
            };
          }
          if (!target && pdfRect) {
            const pageHeight = page.getHeight();
            const pdfX = pdfRect.x;
            const pdfY_bottom = pdfRect.y;
            target = { x: pdfX, y: pdfY_bottom, w: pdfRect.w, h: pdfRect.h };
          }
          if (target && target.w > 0 && target.h > 0) {
            const dims = signatureImage.scaleToFit(target.w, target.h);
            const drawX = target.x + (target.w - dims.width) / 2;
            const drawY = target.y + (target.h - dims.height) / 2;
            page.drawImage(signatureImage, {
              x: drawX,
              y: drawY,
              width: dims.width,
              height: dims.height,
            });
          }
          continue;
        }

        if (!val) continue;

        if (field.type === "text" || field.type === "textarea") {
          try {
            if (form && typeof form.getTextField === "function") {
              const textField = form.getTextField(field.name);
              if (textField) textField.setText(String(val));
              else throw new Error("text field missing");
            } else throw new Error("No AcroForm");
          } catch (e) {
            const pageHeight = page.getHeight();
            const drawY =
              pageHeight - (viewRect ? viewRect.y + 12 : pdfRect.y + 12);
            page.drawText(String(val), {
              x: viewRect
                ? viewRect.x /
                  (pagesData[field.pageIndex].viewport.scale || scale)
                : pdfRect.x + 2,
              y: drawY,
              size: 10,
              font: helvetica,
            });
          }
        } else if (field.type === "checkbox" || field.type === "radio") {
          const isMatch = val === field.value || val === true;
          if (isMatch) {
            const x =
              (viewRect ? viewRect.x : pdfRect.x) /
              (pagesData[field.pageIndex].viewport.scale || scale);
            const y =
              (viewRect ? viewRect.y : pdfRect.y) /
              (pagesData[field.pageIndex].viewport.scale || scale);
            const w =
              (viewRect ? viewRect.w : pdfRect.w) /
              (pagesData[field.pageIndex].viewport.scale || scale);
            const h =
              (viewRect ? viewRect.h : pdfRect.h) /
              (pagesData[field.pageIndex].viewport.scale || scale);
            const x1 = x + w * 0.2,
              y1 = y + h * 0.5;
            const x2 = x + w * 0.45,
              y2 = y + h * 0.2;
            const x3 = x + w * 0.8,
              y3 = y + h * 0.8;
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

      try {
        if (form && typeof form.flatten === "function") form.flatten();
      } catch (e) {}
      const pdfBytes = await pdfDoc.save();
      return pdfBytes;
    };

    // download/export
    const generateAndDownload = async () => {
      try {
        const pdfBytes = await generatePdfBytes();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `agreement_${props.applicantId || "0"}_signed.pdf`;
        link.click();
      } catch (err) {
        showModal("error", "Export Error", err.message || String(err));
      }
    };

    // validate wrapper for download (require signature if signature fields exist)
    const validateAndDownload = async () => {
      try {
        const sigFields = fields.value.filter((f) => f.type === "signature");
        if (sigFields.length > 0) {
          if (!signatureDataUrl.value) {
            const img = await generateSignatureImage();
            if (img) signatureDataUrl.value = img;
          }
          if (!signatureDataUrl.value) {
            showModal(
              "error",
              "Signature required",
              "Please sign or type your name before downloading."
            );
            return;
          }
        }
        await generateAndDownload();
      } catch (err) {
        showModal("error", "Error", err.message || String(err));
      }
    };

    const exportPdfBlob = async () => {
      const pdfBytes = await generatePdfBytes();
      return new Blob([pdfBytes], { type: "application/pdf" });
    };

    // submit
    const getSignatureDataUrl = async () => {
      if (signatureDataUrl.value) return signatureDataUrl.value;
      const img = await generateSignatureImage();
      return img;
    };

    const submitFilledPdf = async () => {
      error.value = "";
      message.value = "";
      if (!item || !item.id) {
        showModal("error", "Error", "Agreement not found.");
        return;
      }
      if (signatureMode.value === "type" && !typedSignature.value.trim()) {
        showModal(
          "error",
          "Signature Required",
          "Please type your full name to sign."
        );
        return;
      }
      if (signatureMode.value === "draw") {
        const pad = sigPadRef.value;
        if (pad && typeof pad.isEmpty === "function" && pad.isEmpty()) {
          showModal(
            "error",
            "Signature Required",
            "Please draw your signature in the box."
          );
          return;
        }
      }
      saving.value = true;
      try {
        const today = new Date().toISOString().slice(0, 10);
        const signedKeys = ["signed_date", "date", "Date"];
        for (const k of signedKeys) if (!formData[k]) formData[k] = today;
        const sigDataUrl = await getSignatureDataUrl();
        const filledBlob = await exportPdfBlob();
        if (!filledBlob) throw new Error("Failed to generate signed PDF.");
        const fd = new FormData();
        fd.append("filled_pdf", filledBlob, "payment_extension_signed.pdf");
        fd.append("signed_date", formData.signed_date || today);
        if (sigDataUrl) {
          const sigBlob = await (await fetch(sigDataUrl)).blob();
          fd.append("signature", sigBlob, "signature.png");
        }
        const res = await fetch(
          `${JRJ_ADMIN.root}payment-extensions/${item.id}/submit`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
            body: fd,
          }
        );
        const j = await res.json().catch(() => ({ ok: false }));
        if (!res.ok || !j.ok)
          throw new Error(j.error || j.message || "Submission failed.");
        message.value = "Agreement signed and submitted successfully!";
        if (j.signed_pdf_url) item.signed_pdf_url = j.signed_pdf_url;

        // update client-side status immediately (so notice shows instantly)
        item.payment_extension = item.payment_extension || {};
        item.payment_extension.status = "submitted";
        showPanel.value = false;

        showModal(
          "success",
          "Success",
          "Agreement signed and submitted successfully!",
          "Close",
          () => {}
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e) {
        error.value = e.message || "An error occurred.";
        showModal("error", "Submission Error", error.value);
      } finally {
        saving.value = false;
      }
    };

    // UI actions
    const openSignaturePad = (field) => {
      activeSignatureField.value = field;
      const pageIndex = field.pageIndex;
      const vp = pagesData[pageIndex]?.viewport;
      const vpScale = vp?.scale || scale;
      signatureViewRect.value = {
        ...field.viewRect,
        pageIndex,
        viewportScale: vpScale,
      };
      signatureMode.value = "draw";
      typedSignature.value = "";
      showSigModal.value = true;
      nextTick(() => {
        try {
          if (
            sigPadRef.value &&
            typeof sigPadRef.value.resizeCanvas === "function"
          )
            sigPadRef.value.resizeCanvas();
        } catch (e) {}
      });
    };

    const clearSignature = () => {
      if (
        sigPadRef.value &&
        typeof sigPadRef.value.clearSignature === "function"
      )
        sigPadRef.value.clearSignature();
      else if (
        sigPadRef.value &&
        typeof sigPadRef.value.clearCanvas === "function"
      )
        sigPadRef.value.clearCanvas();
      signatureDataUrl.value = null;
    };

    const changePage = async (offset) => {
      const newPage = currentPage.value + offset;
      if (newPage >= 1 && newPage <= totalPages.value) {
        currentPage.value = newPage;
        await nextTick();
        renderActivePage();
      }
    };

    // resubmit: reopen panel for editing/submission
    const handleResubmitClick = async () => {
      showPanel.value = true;

      // Optionally clear previous signature if you want a fresh start:
      // signatureDataUrl.value = null;

      // Re-fetch item/prefill (fresh) and reload PDF preview
      await fetchPrefillFromApi();
      if (props.pdfUrl) {
        // small delay ensures showPanel reflow before heavy work
        await nextTick();
        await loadPdfFromUrl(props.pdfUrl);
      }
    };

    // init
    onMounted(async () => {
      await fetchPrefillFromApi();

      // Decide UI for submitted status here (not inside fetchPrefillFromApi)
      if (
        item.payment_extension &&
        item.payment_extension.status === "submitted"
      ) {
        showPanel.value = false;
      } else {
        showPanel.value = true;
      }

      if (props.pdfUrl) await loadPdfFromUrl(props.pdfUrl);
    });

    onUnmounted(() => {
      detachCanvasListeners();
    });

    // expose
    return {
      // core
      canvasRef,
      status,
      currentPage,
      totalPages,
      changePage,
      activePageStyle,
      fields,
      formData,
      // actions
      validateAndDownload,
      generateAndDownload,
      exportPdfBlob,
      submitFilledPdf,
      // UI
      modal,
      closeModal,
      handleModalConfirm,
      // signature UI
      showSigModal,
      sigPadRef,
      sigOptions,
      openSignaturePad,
      saveSignature,
      clearSignature,
      signatureDataUrl,
      signatureMode,
      typedSignature,
      // item + submit
      item,
      saving,
      error,
      message,
      isSigned,
      // panel / resubmit
      showPanel,
      handleResubmitClick,
    };
  },

  template: `
  <div class="payment-extension-panel">
    <!-- Submitted notice -->
    <div v-if="item.payment_extension && item.payment_extension.status === 'submitted' && !showPanel" class="max-w-5xl mx-auto p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold">PDF submitted for review</div>
          <div class="text-sm text-emerald-700 mt-1">Your signed agreement has been submitted and is pending review.</div>
        </div>
        <div>
          <button @click="handleResubmitClick" class="px-3 py-2 bg-white border rounded text-sm">Resubmit / Edit</button>
        </div>
      </div>
    </div>

    <!-- Main panel: hide when showPanel === false (submitted) -->
    <div v-if="showPanel" class="bg-white rounded-2xl overflow-hidden">
      <div class="flex items-center justify-between gap-6 px-6 py-5 border-b">
        <div class="flex items-start gap-4">
          <div class="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-[#E8A674] to-[#D9733A] text-white rounded-lg text-xl font-bold shadow-md">PE</div>
          <div>
            <h1 class="text-2xl font-semibold text-slate-900">Payment Extension Agreement</h1>
            <p class="text-sm text-slate-500 mt-0.5">Review the pre-filled details and sign to complete the agreement.</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          
          <div class="relative inline-flex items-center">
            <button
              @click="validateAndDownload"
              :disabled="status !== 'success' || !isSigned"
              :title="!isSigned ? 'Please sign the document before downloading' : 'Download signed PDF'"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-md bg-gradient-to-r from-[#3b82f6] to-[#06b6d4] hover:from-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed">
              <i class="fa-solid fa-download"></i> Download
            </button>
          </div>

          <div class="relative inline-flex items-center">
            <button @click="submitFilledPdf" :disabled="saving || !isSigned"
                    :title="!isSigned ? 'Please sign before submitting' : (saving ? 'Submitting...' : 'Submit signed agreement')"
                    class="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-md bg-gradient-to-r from-green-500 to-emerald-400 hover:from-green-600 disabled:opacity-50">
              <i v-if="!saving" class="fa-solid fa-upload"></i>
              <i v-else class="fa-solid fa-circle-notch fa-spin"></i>
              <span>{{ saving ? 'Submitting...' : 'Submit' }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="pt-6 grid grid-cols-1 md:grid-cols-12 gap-6">
        <section class="md:col-span-9">
          <div class="rounded-lg border border-slate-100 bg-gradient-to-b from-white to-gray-50 p-4">
            <div v-if="status === 'loading'" class="h-80 flex items-center justify-center">
              <div class="text-slate-400 flex flex-col items-center gap-3"><i class="fa-solid fa-circle-notch fa-spin text-3xl"></i><div>Loading PDF…</div></div>
            </div>

            <div v-if="status === 'success'" class="relative overflow-auto">
              <div class="mx-auto" :style="activePageStyle">
                <canvas ref="canvasRef" class="rounded-md block"></canvas>
                <div class="absolute inset-0">
                  <template v-for="field in fields" :key="field.id">
                    <template v-if="field.pageIndex === (currentPage - 1)">
                      <div v-if="field.type==='signature'"
                           @click="openSignaturePad(field)"
                           :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                           class="absolute flex items-center justify-center border-2 border-dashed rounded-lg bg-white/40 hover:bg-white/60 cursor-pointer transition">
                        <template v-if="signatureDataUrl"><img :src="signatureDataUrl" class="max-w-full max-h-full object-contain rounded-md" /></template>
                        <template v-else><div class="text-xs text-slate-700 font-semibold uppercase tracking-wide">Sign</div></template>
                      </div>

                      <input v-else-if="field.type==='checkbox'" type="checkbox" :disabled="true" v-model="formData[field.name]"
                             :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                             class="absolute scale-110 opacity-80 cursor-not-allowed" />

                      <input v-else-if="field.type==='radio'" type="radio" :name="field.name" :value="field.value" :disabled="true" v-model="formData[field.name]"
                             :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                             class="absolute opacity-80 cursor-not-allowed" />

                      <textarea v-else-if="field.type==='textarea'" :disabled="true" v-model="formData[field.name]"
                                :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                                class="absolute !bg-transparent !border-none !shadow-none text-sm p-1 resize-none text-slate-900"></textarea>

                      <input v-else type="text" :disabled="true" v-model="formData[field.name]"
                             :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                             class="absolute !bg-transparent !border-none !shadow-none text-sm p-1 text-slate-900" />
                    </template>
                  </template>
                </div>
              </div>
            </div>

            <div v-if="status === 'error'" class="p-6 text-center text-sm text-red-600">Failed to load PDF. Check console for details.</div>
          </div>
        </section>

        <aside class="md:col-span-3">
          <div class="sticky top-8 space-y-4">
            <div class="bg-white rounded-lg border shadow-sm p-4">
              <h3 class="text-sm font-semibold text-slate-700 mb-2">Tenant Details</h3>
              <div class="text-sm text-slate-600 space-y-2">
                <div><span class="font-medium text-slate-800">Tenant:</span> <span class="ml-2">{{ formData['tenant_first_name'] || formData['tenant_name'] }} {{ formData['tenant_last_name'] || '' }}</span></div>
                <div><span class="font-medium text-slate-800">Address:</span> <span class="ml-2">{{ formData['rental_address'] || formData['Address'] || '' }}</span></div>
                <div><span class="font-medium text-slate-800">Phone:</span> <span class="ml-2">{{ formData['phone'] || formData['tenant_phone'] || '' }}</span></div>
                <div><span class="font-medium text-slate-800">Email:</span> <span class="ml-2">{{ formData['email'] || formData['tenant_email'] || '' }}</span></div>
                <div><span class="font-medium text-slate-800">Signed Date:</span> <span class="ml-2">{{ formData['signed_date'] || formData['date'] || '' }}</span></div>
              </div>
            </div>

            <div class="bg-white rounded-lg border shadow-sm p-4">
              <h3 class="text-sm font-semibold text-slate-700 mb-2">Signature</h3>
              <p class="text-xs text-slate-500 mb-3">Only the candidate may sign. Click the area on the document to open the signature pad.</p>

              <div class="flex items-center gap-3">
                <div class="w-16 h-10 bg-gray-50 rounded border flex items-center justify-center overflow-hidden">
                  <template v-if="signatureDataUrl"><img :src="signatureDataUrl" class="object-cover w-full h-full" /></template>
                  <template v-else><i class="fa-regular fa-pen-to-square text-slate-400"></i></template>
                </div>
                <div class="flex-1">
                  <button @click="showSigModal = true" class="w-full px-3 py-2 bg-white border rounded text-sm hover:shadow">Open Signature Pad</button>
                  
                </div>
              </div>
            </div>
            <span v-if="!isSigned" class="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">Signature required</span>
            

            <div class="bg-white rounded-lg border shadow-sm p-4">
              <h3 class="text-sm font-semibold text-slate-700 mb-2">Help</h3>
              <p class="text-xs text-slate-500">Click the signature box on the PDF preview, draw or type your signature, then Download or Submit.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <!-- signature modal -->
    <div v-if="showSigModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 pb-0 border-b">
          <h3 class="text-lg font-semibold">Sign Document</h3>
          <button @click="showSigModal=false" class="text-slate-500"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="md:col-span-2">
            <div class="bg-gray-50 rounded-lg border p-4">
              <div class="mb-3 flex gap-2">
                <button @click="signatureMode='draw'" :class="signatureMode==='draw' ? 'bg-white shadow-sm' : 'text-slate-500'" class="px-3 py-2 rounded">Draw</button>
                <button @click="signatureMode='type'" :class="signatureMode==='type' ? 'bg-white shadow-sm' : 'text-slate-500'" class="px-3 py-2 rounded">Type</button>
              </div>

              <div v-show="signatureMode==='draw'">
                <div class="bg-white border rounded-lg p-3">
                  <VueSignaturePad ref="sigPadRef" width="100%" height="180px" :options="sigOptions" />
                </div>
                <div class="flex justify-between mt-3">
                  <button @click="clearSignature" class="text-sm text-red-600">Clear</button>
                  <div class="text-sm text-slate-400">Draw your signature above (auto-capture enabled)</div>
                </div>
              </div>

              <div v-show="signatureMode==='type'">
                <input v-model="typedSignature" type="text" class="w-full border rounded px-3 py-2" placeholder="Type your name" />
                <div class="mt-3 p-6 border rounded text-center bg-white">
                  <div style="font-family: 'Pacifico', cursive; font-size: 34px;">{{ typedSignature || 'Signature' }}</div>
                </div>
              </div>
            </div>
          </div>

          <aside class="md:col-span-1 flex flex-col gap-3">
            <div class="bg-white border rounded-lg p-3 text-sm text-slate-600">
              <div class="font-medium text-slate-800 mb-1">Preview</div>
              <div class="w-full h-20 bg-gray-50 rounded flex items-center justify-center overflow-hidden">
                <template v-if="signatureDataUrl"><img :src="signatureDataUrl" class="object-contain w-full h-full" /></template>
                <template v-else><i class="fa-regular fa-pen-to-square text-slate-300"></i></template>
              </div>
            </div>

            <div class="flex gap-2">
              <button @click="showSigModal=false" class="flex-1 px-3 py-2 rounded border text-sm">Cancel</button>
              <button @click="saveSignature" class="flex-1 px-3 py-2 rounded bg-gradient-to-r from-[#06b6d4] to-[#3b82f6] text-white">Apply</button>
            </div>
          </aside>
        </div>
      </div>
    </div>

    <!-- generic modal -->
    <div v-if="modal.show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="relative max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div class="p-6">
          <h3 class="text-lg font-semibold text-slate-900 mb-2">{{ modal.title }}</h3>
          <p class="text-sm text-slate-600">{{ modal.message }}</p>
        </div>
        <div class="flex justify-end gap-3 p-4 border-t bg-slate-50">
          <button @click="closeModal" class="px-4 py-2 rounded bg-white border text-sm">Cancel</button>
          <button v-if="modal.onConfirm" @click="handleModalConfirm" class="px-4 py-2 rounded bg-indigo-600 text-white">OK</button>
        </div>
      </div>
    </div>
  </div>
  `,
};
