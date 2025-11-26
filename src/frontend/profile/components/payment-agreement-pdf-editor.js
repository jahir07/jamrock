// pdf-editor.js
import { ref, onMounted, watch, nextTick } from "vue/dist/vue.esm-bundler.js";
import { PDFDocument } from "pdf-lib";

/**
 * Props:
 *  - src: URL string to template PDF (must be fetchable from browser)
 *  - prefill: object with keys corresponding to your fieldMap values (eg { tenant_first_name: 'Sed', ... })
 *  - fieldMap: object mapping pdf field name -> prefill key (optional; if omitted uses identity)
 *  - signaturePlacement: { page: 0, x: 90, y: 120, width: 160 } in PDF points (tune)
 *
 * Exposes:
 *  - exportPdf(signatureDataUrl, options) => Promise<Blob>
 *
 * Also auto-renders preview when prefill changes (fills PDF in browser and sets iframe to blob URL)
 */

export default {
  name: "PDFEditor",
  props: {
    src: { type: String, required: true },
    prefill: { type: Object, default: () => ({}) },
    fieldMap: { type: Object, default: () => ({}) },
    signaturePlacement: {
      type: Object,
      default: () => ({ page: 0, x: 90, y: 120, width: 160 }),
    },
  },
  setup(props, { expose }) {
    const previewUrl = ref("");
    const loading = ref(false);

    // Helper: fill PDF with current prefill + optional signature, return Uint8Array
    async function buildPdfBytes(signatureDataUrl = null, opts = {}) {
      loading.value = true;
      try {
        const res = await fetch(props.src, { credentials: "same-origin" });
        if (!res.ok)
          throw new Error("Failed to fetch template PDF: " + res.status);
        const ab = await res.arrayBuffer();
        const pdfDoc = await PDFDocument.load(ab);

        // Fill AcroForm fields if present
        try {
          const form = pdfDoc.getForm();
          const fields = form.getFields();
          for (const f of fields) {
            const pdfName = f.getName();
            const key =
              props.fieldMap && props.fieldMap[pdfName]
                ? props.fieldMap[pdfName]
                : pdfName;
            const val = props.prefill[key] ?? "";
            try {
              // prefer text field setText
              if (typeof f.setText === "function") {
                f.setText(String(val || ""));
              } else {
                // try generic approaches
                try {
                  form.getTextField(pdfName).setText(String(val || ""));
                } catch (e) {}
              }
            } catch (e) {
              // ignore field-setting errors
              // console.warn("Could not set field", pdfName, e && e.message);
            }
          }
        } catch (e) {
          // no AcroForm — ignore
        }

        // embed signature if provided
        if (signatureDataUrl) {
          const base64 = signatureDataUrl.split(",")[1];
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const pngImage = await pdfDoc.embedPng(bytes);
          const pages = pdfDoc.getPages();
          const placement = opts.signaturePlacement ||
            props.signaturePlacement || { page: 0, x: 90, y: 120, width: 160 };
          const p = pages[placement.page || 0];
          const { width: pW, height: pH } = p.getSize();

          // signature width in points
          const sigW = placement.width || 160;
          const sigH = (pngImage.height / pngImage.width) * sigW;

          // PDF coordinate origin is bottom-left
          const x = placement.x || 40;
          const y = placement.y || 120;

          p.drawImage(pngImage, { x, y, width: sigW, height: sigH });
        }

        // flatten form if possible
        try {
          const form = pdfDoc.getForm ? pdfDoc.getForm() : null;
          if (form && typeof form.flatten === "function") form.flatten();
        } catch (e) {
          // ignore
        }

        const pdfBytes = await pdfDoc.save();
        return pdfBytes;
      } finally {
        loading.value = false;
      }
    }

    // render preview: fill using current prefill (no signature) and set iframe src to blob URL
    async function renderPreview() {
      try {
        const bytes = await buildPdfBytes(null, {
          signaturePlacement: props.signaturePlacement,
        });
        const blob = new Blob([bytes], { type: "application/pdf" });
        if (previewUrl.value) {
          try {
            URL.revokeObjectURL(previewUrl.value);
          } catch (e) {}
        }
        previewUrl.value = URL.createObjectURL(blob);
      } catch (e) {
        console.error("Preview render failed", e && e.message);
        previewUrl.value = props.src; // fallback: original src
      }
    }

    // exportPdf for parent
    async function exportPdf(signatureDataUrl = null, options = {}) {
      const bytes = await buildPdfBytes(
        signatureDataUrl,
        Object.assign(
          {},
          { signaturePlacement: props.signaturePlacement },
          options
        )
      );
      return new Blob([bytes], { type: "application/pdf" });
    }

    // log
    async function debugFields() {
      const url =
        "/wp-content/plugins/jamrock/assets/pdf/medical-history-acro-form.pdf";
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const pdfDoc = await PDFDocument.load(buf);

      try {
        const form = pdfDoc.getForm();
        const fields = form.getFields();
        fields.forEach((f) => console.log("Field:", f.getName()));
      } catch (e) {
        console.log("Form error:", e.message);
      }
    }

    // debugFields();

    // watch prefill -> rerender preview (debounced via nextTick)
    watch(
      () => props.prefill,
      async () => {
        await nextTick();
        await renderPreview();
      },
      { deep: true }
    );

    onMounted(async () => {
      await renderPreview();
    });

    expose({ exportPdf });

    return { previewUrl, loading };
  },
  template: `
    <div class="jrj-pdf-editor">
      <div v-if="loading">Rendering PDF…</div>
      <iframe v-if="previewUrl" :src="previewUrl" style="width:100%;height:720px;border:0"></iframe>
    </div>
  `,
};
