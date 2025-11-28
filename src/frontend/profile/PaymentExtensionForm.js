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
    const activePageStyle = reactive({
      width: "0px",
      height: "0px",
      position: "relative",
    });
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
  <div class="payment-extension-panel font-sans text-slate-600">

      <div v-if="item.payment_extension && item.payment_extension.status === 'submitted' && !showPanel" 
         class="max-w-2xl mx-auto mt-8 bg-white rounded-2xl shadow-xl shadow-emerald-900/5 border border-slate-100 overflow-hidden">
      
      <div class="bg-emerald-50/50 p-8 text-center border-b border-emerald-50">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white text-emerald-500 mb-6 shadow-sm ring-8 ring-emerald-50">
          <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h2 class="text-2xl font-bold text-slate-800 mb-2">Agreement Submitted</h2>
        <p class="text-slate-500 max-w-md mx-auto">Your Payment Extension Agreement has been securely received.</p>
      </div>

      <div class="p-8">
        <div class="flex gap-4 p-4 rounded-xl bg-blue-50/50 border border-blue-100 mb-8 items-start">
           <div class="flex-shrink-0 mt-0.5 text-blue-500">
             <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
           </div>
           <div class="text-sm text-slate-600">
             <strong class="text-slate-800 block mb-1">What happens next?</strong>
             Our finance team is currently reviewing your request. You will receive an email notification once the status changes.
           </div>
        </div>

        <div class="flex justify-center">
           <button @click="handleResubmitClick" class="group inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:border-indigo-200 hover:bg-slate-50 transition-all">
              <svg class="w-4 h-4 text-slate-400 group-hover:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
              View Document Details
           </button>
        </div>
      </div>
    </div>

    <div v-if="showPanel" class="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100 ring-1 ring-slate-900/5">
      
      <div class="px-6 py-5 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6 bg-slate-50/50">
        <div class="flex items-center gap-4 w-full md:w-auto">
          <div class="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl shadow-lg shadow-indigo-500/20">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          </div>
          <div>
            <h1 class="text-xl font-bold text-slate-900">Payment Extension Agreement</h1>
            <p class="text-sm text-slate-500">Review document details and sign below.</p>
          </div>
        </div>

        <div class="flex items-center gap-3 w-full md:w-auto justify-end">
          
          <button
            @click="validateAndDownload"
            :disabled="status !== 'success' || !isSigned"
            :class="[
              'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all focus:ring-2 focus:ring-offset-1 focus:ring-blue-500',
              !isSigned || status !== 'success' 
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-blue-600'
            ]"
            :title="!isSigned ? 'Sign first' : 'Download PDF'">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            <span>Download</span>
          </button>

          <button @click="submitFilledPdf" 
                  :disabled="saving || !isSigned"
                  :class="[
                    'flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition-all focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500',
                    saving || !isSigned
                      ? 'bg-slate-300 cursor-not-allowed shadow-none'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 transform hover:-translate-y-0.5'
                  ]">
            <svg v-if="saving" class="animate-spin -ml-1 mr-1 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            <span>{{ saving ? 'Submitting...' : 'Submit Agreement' }}</span>
          </button>
        </div>
      </div>

      <div class="pt-6 pb-8 px-6 grid grid-cols-1 md:grid-cols-12 gap-8">
        
        <section class="md:col-span-9">
          <div class="relative rounded-xl border border-slate-200 bg-slate-50 min-h-[500px] flex justify-center p-6 shadow-inner">
            
            <div v-if="status === 'loading'" class="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-white/80 z-10 backdrop-blur-sm">
              <svg class="animate-spin h-10 w-10 text-indigo-500 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
              <div class="text-sm font-medium">Generating Document...</div>
            </div>

            <div v-if="status === 'error'" class="absolute inset-0 flex flex-col items-center justify-center text-red-500">
               <svg class="w-12 h-12 mb-2 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
               <p>Unable to load PDF. Please refresh.</p>
            </div>

            <div v-if="status === 'success'" class="relative shadow-xl shadow-slate-200/50 transition-transform">
              <div class="mx-auto bg-white" :style="activePageStyle">
                <canvas ref="canvasRef" class="block"></canvas>
                
                <div class="absolute inset-0">
                  <template v-for="field in fields" :key="field.id">
                    <template v-if="field.pageIndex === (currentPage - 1)">
                      
                      <div v-if="field.type==='signature'"
                           @click="openSignaturePad(field)"
                           :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                           class="group absolute flex items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200"
                           :class="signatureDataUrl ? 'border-transparent bg-transparent' : 'border-indigo-400 bg-indigo-50/50 hover:bg-indigo-100/50 hover:border-indigo-500'">
                        
                        <template v-if="signatureDataUrl">
                            <img :src="signatureDataUrl" class="max-w-full max-h-full object-contain" />
                        </template>
                        <template v-else>
                            <div class="flex flex-col items-center animate-pulse group-hover:animate-none">
                                <span class="text-[10px] uppercase font-bold text-indigo-600 tracking-wider">Click to Sign</span>
                            </div>
                        </template>
                      </div>

                      <input v-else-if="field.type==='checkbox'" type="checkbox" disabled v-model="formData[field.name]"
                             :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                             class="absolute scale-110 accent-indigo-600 cursor-default" />

                      <input v-else-if="field.type==='radio'" type="radio" :name="field.name" :value="field.value" disabled v-model="formData[field.name]"
                             :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                             class="absolute accent-indigo-600 cursor-default" />

                      <textarea v-else-if="field.type==='textarea'" disabled v-model="formData[field.name]"
                                :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                                class="absolute bg-transparent border-none p-1 text-xs text-slate-800 resize-none font-medium"></textarea>

                      <input v-else type="text" disabled v-model="formData[field.name]"
                             :style="{ left: field.viewRect.x + 'px', top: field.viewRect.y + 'px', width: field.viewRect.w + 'px', height: field.viewRect.h + 'px' }"
                             class="absolute bg-transparent border-none p-1 text-xs text-slate-800 font-medium" />
                    </template>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside class="md:col-span-3">
          <div class="sticky top-6 space-y-6">
            
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">Agreement Details</h3>
              <div class="space-y-4">
                <div class="group">
                    <label class="block text-xs text-slate-500 mb-1">Tenant Name</label>
                    <div class="text-sm font-semibold text-slate-800 truncate">{{ formData['tenant_first_name'] || formData['tenant_name'] }} {{ formData['tenant_last_name'] }}</div>
                </div>
                <div>
                    <label class="block text-xs text-slate-500 mb-1">Property Address</label>
                    <div class="text-sm font-medium text-slate-800 leading-snug">{{ formData['rental_address'] || formData['Address'] || 'N/A' }}</div>
                </div>
                 <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block text-xs text-slate-500 mb-1">Phone</label>
                        <div class="text-xs font-medium text-slate-800 truncate">{{ formData['phone'] || formData['tenant_phone'] || '-' }}</div>
                    </div>
                    <div>
                        <label class="block text-xs text-slate-500 mb-1">Date</label>
                        <div class="text-xs font-medium text-slate-800">{{ formData['signed_date'] || formData['date'] || '-' }}</div>
                    </div>
                 </div>
              </div>
            </div>

            <div class="bg-white rounded-xl border shadow-sm p-5 transition-colors" 
                 :class="isSigned ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/30'">
              <div class="flex justify-between items-start mb-2">
                 <h3 class="text-sm font-bold text-slate-800">Signature Status</h3>
                 <span v-if="!isSigned" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 uppercase tracking-wide">Required</span>
                 <span v-else class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-wide">Signed</span>
              </div>
              
              <div class="mt-3 mb-4">
                 <div class="h-16 w-full bg-white rounded-lg border border-slate-200 border-dashed flex items-center justify-center overflow-hidden">
                    <img v-if="signatureDataUrl" :src="signatureDataUrl" class="h-full object-contain p-2" />
                    <span v-else class="text-xs text-slate-400 italic">Waiting for signature...</span>
                 </div>
              </div>

              <button @click="showSigModal = true" 
                      class="w-full py-2 px-4 rounded-lg text-sm font-medium border bg-white hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2"
                      :class="isSigned ? 'text-slate-600 border-slate-200' : 'text-indigo-600 border-indigo-200 ring-2 ring-indigo-50'">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                  {{ isSigned ? 'Change Signature' : 'Sign Document' }}
              </button>
            </div>

            <div class="flex gap-3 p-3 bg-blue-50 rounded-lg text-blue-700 text-xs">
               <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
               <p>Click the dashed box on the document or the button above to sign. You can draw or type your signature.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <div v-if="showSigModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" @click="showSigModal=false"></div>
      
      <div class="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden transform transition-all scale-100">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 class="text-lg font-bold text-slate-800">Add Signature</h3>
          <button @click="showSigModal=false" class="text-slate-400 hover:text-slate-600 transition-colors">
             <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div class="p-6">
          <div class="flex p-1 bg-slate-100 rounded-lg mb-6">
            <button @click="signatureMode='draw'" 
                    :class="signatureMode==='draw' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                    class="flex-1 py-2 text-sm font-semibold rounded-md transition-all">Draw</button>
            <button @click="signatureMode='type'" 
                    :class="signatureMode==='type' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
                    class="flex-1 py-2 text-sm font-semibold rounded-md transition-all">Type</button>
          </div>

          <div v-show="signatureMode==='draw'">
            <div class="relative border-2 border-slate-200 rounded-xl overflow-hidden bg-white hover:border-indigo-300 transition-colors">
               <VueSignaturePad ref="sigPadRef" width="100%" height="200px" :options="sigOptions" class="cursor-crosshair" />
               <div class="absolute bottom-2 right-2 text-[10px] text-slate-300 pointer-events-none">Sign Here</div>
            </div>
            <div class="flex justify-between mt-2">
               <button @click="clearSignature" class="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  Clear
               </button>
               <span class="text-xs text-slate-400">Use your mouse or finger</span>
            </div>
          </div>

          <div v-show="signatureMode==='type'">
             <div class="space-y-4">
                <div>
                   <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">Enter your full name</label>
                   <input v-model="typedSignature" type="text" class="w-full border-slate-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-slate-800 placeholder:text-slate-300" placeholder="e.g. John Doe" />
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">Preview</label>
                    <div class="h-24 flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50 text-indigo-600 overflow-hidden px-4">
                       <div style="font-family: 'Pacifico', cursive; font-size: 32px; white-space: nowrap;">{{ typedSignature || 'Your Signature' }}</div>
                    </div>
                </div>
             </div>
          </div>
        </div>

        <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button @click="showSigModal=false" class="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-white transition-colors">Cancel</button>
          <button @click="saveSignature" class="px-6 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all">Apply Signature</button>
        </div>
      </div>
    </div>

    <div v-if="modal.show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"></div>
      <div class="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 text-center transform transition-all scale-100">
        
        <div class="mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4"
             :class="{
               'bg-emerald-100': modal.type === 'success',
               'bg-red-100': modal.type === 'error',
               'bg-blue-100': modal.type === 'info'
             }">
            <svg v-if="modal.type === 'success'" class="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            <svg v-else-if="modal.type === 'error'" class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <svg v-else class="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        </div>

        <h3 class="text-lg font-bold text-slate-900 mb-2">{{ modal.title }}</h3>
        <p class="text-sm text-slate-500 mb-6">{{ modal.message }}</p>
        
        <div class="flex gap-3 justify-center">
          <button @click="closeModal" class="flex-1 px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50">Close</button>
          <button v-if="modal.onConfirm" @click="handleModalConfirm" class="flex-1 px-4 py-2 bg-indigo-600 rounded-lg text-white font-medium hover:bg-indigo-700">{{ modal.confirmText || 'Confirm' }}</button>
        </div>
      </div>
    </div>
  </div>
  `,
};
