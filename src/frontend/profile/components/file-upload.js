import {
  ref,
  onUnmounted,
} from "vue/dist/vue.esm-browser.js";

const style = `
.upload-field {
  margin: 0 auto 20px;
  color: #1f2937;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

.upload-field .label {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
}

.upload-field .hint {
  margin: 0 0 12px;
  color: #4b5563;
  line-height: 1.4;
  font-size: 14px;
}

.dropzone {
  border: 2px dashed #cbd5e1;
  background: #f8fafc;
  min-height: 130px;
  border-radius: 10px;
  padding: 20px;
  cursor: pointer;

  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;

  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.dropzone.dragging {
  border-color: #64748b;
  background: #f1f5f9;
  box-shadow: 0 4px 15px rgba(0,0,0,0.05);
}

.upload-field .selected {
  margin-top: 10px;
  font-size: 14px;
  color: #374151;
}

.upload-field button {
  margin-left: 10px;
  border: none;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 13px;
  text-decoration: underline;
}
`;

if (!document.getElementById("file-upload-style")) {
  const tag = document.createElement("style");
  tag.id = "file-upload-style";
  tag.textContent = style;
  document.head.appendChild(tag);
}

export default {
  name: "FileUpload",
  setup(props, { emit }) {
    const fileInput = ref(null);
    const fileName = ref("");
    const isDragging = ref(false);
    const previewUrl = ref(null);

    function triggerInput() {
      fileInput.value?.click();
    }

    function handleFiles(files) {
      if (!files || files.length === 0) return;
      const f = files[0];
      fileName.value = f.name;
      emit("file-selected", f);

      // console.log(fileName.value);

      // optional small image preview url
      if (f.type && f.type.startsWith("image/")) {
        if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = URL.createObjectURL(f);
      } else {
        if (previewUrl.value) {
          URL.revokeObjectURL(previewUrl.value);
          previewUrl.value = null;
        }
      }
    }

    // Handlers (no template modifiers used)
    function onFileChange(e) {
      handleFiles(e.target.files);
      // reset input so selecting same file again will trigger change
      e.target.value = "";
    }

    function onDragOver(e) {
      // explicitly prevent default to allow drop
      e.preventDefault();
    }

    function onDragEnter(e) {
      e.preventDefault();
      isDragging.value = true;
    }

    function onDragLeave(e) {
      // Some browsers fire dragleave frequently; ensure it relates to the dropzone
      // We won't inspect target here for simplicity, just clear the flag
      isDragging.value = false;
    }

    function onDrop(e) {
      e.preventDefault();
      isDragging.value = false;
      const dt = e.dataTransfer;
      if (dt && dt.files) handleFiles(dt.files);
    }

    function onKeydown(e) {
      // emulate @keydown.enter.prevent
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        triggerInput();
      }
    }

    function clear() {
      fileName.value = "";
      emit("file-selected", null);
      if (previewUrl.value) {
        URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = null;
      }
    }

    onUnmounted(() => {
      if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    });

    return {
      fileInput,
      fileName,
      isDragging,
      triggerInput,
      onFileChange,
      onDragOver,
      onDragEnter,
      onDragLeave,
      onDrop,
      onKeydown,
      clear,
    };
  },
  template: `
    <div class="upload-field">
      <div
        class="dropzone"
        :class="{ dragging: isDragging }"
        @click="triggerInput"
        @dragover="onDragOver"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @drop="onDrop"
        role="button"
        tabindex="0"
        @keydown="onKeydown"
      >
        <div>
          <div style="font-weight:600;font-size:18px">Browse Files</div>
          <div style="font-size:13px;color:#6b7280">Drag and drop files here</div>
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/*,application/pdf"
        @change="onFileChange"
        style="display:none"
      />

      {{ fileName }}
      <div v-if="fileName" style="margin-top:8px;font-size:13px;color:#374151">
        <span>Selected: </span>
        <span>{{ fileName }}</span>
        <button @click="clear"
                style="margin-left:10px;border:none;background:transparent;color:#2563eb;cursor:pointer;">
          Remove
        </button>
      </div>
    </div>
  `,
};
