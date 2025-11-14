/* global JRJ_ADMIN */
import {
  ref,
  reactive,
  onMounted,
  computed,
} from "vue/dist/vue.esm-bundler.js";

export default {
  name: "HousingList",
  setup() {
    const items = ref([]);
    const total = ref(0);
    const page = ref(1);
    const perPage = ref(10);
    const loading = ref(false);
    const error = ref("");

    const filter = reactive({
      q: "",
      visibility: "",
      category: "",
    });

    const modalOpen = ref(false);
    const editing = ref(null); // null => create; {id,...} => update
    const form = reactive({
      title: "",
      url: "",
      category: "",
      visibility: "public",
      sort_order: 0,
      notes: "",
    });
    const saving = ref(false);

    const getJSON = async (path) => {
      const res = await fetch(JRJ_ADMIN.root + path, {
        headers: { "X-WP-Nonce": JRJ_ADMIN.nonce, "Cache-Control": "no-store" },
      });
      if (!res.ok)
        throw new Error((await res.json()).message || "Request failed");
      return res.json();
    };
    const postJSON = async (path, body) => {
      const res = await fetch(JRJ_ADMIN.root + path, {
        method: "POST",
        headers: {
          "X-WP-Nonce": JRJ_ADMIN.nonce,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok)
        throw new Error((await res.json()).message || "Request failed");
      return res.json();
    };
    const delJSON = async (path) => {
      const res = await fetch(JRJ_ADMIN.root + path, {
        method: "DELETE",
        headers: { "X-WP-Nonce": JRJ_ADMIN.nonce },
      });
      if (!res.ok)
        throw new Error((await res.json()).message || "Request failed");
      return res.json();
    };

    const load = async () => {
      loading.value = true;
      error.value = "";
      try {
        const q = new URLSearchParams({
          page: page.value,
          per_page: perPage.value,
          q: filter.q || "",
          visibility: filter.visibility || "",
          category: filter.category || "",
        });
        const data = await getJSON("housing?" + q.toString());
        items.value = data.items || [];
        total.value = data.total || 0;
      } catch (e) {
        error.value = e.message || "Failed to load";
      } finally {
        loading.value = false;
      }
    };

    const openCreate = () => {
      editing.value = null;
      Object.assign(form, {
        title: "",
        url: "",
        category: "",
        visibility: "public",
        sort_order: 0,
        notes: "",
      });
      modalOpen.value = true;
    };
    const openEdit = (row) => {
      editing.value = row;
      Object.assign(form, {
        title: row.title || "",
        url: row.url || "",
        category: row.category || "",
        visibility: row.visibility_status || "public",
        sort_order: row.sort_order || 0,
        notes: row.notes || "",
      });
      modalOpen.value = true;
    };

    const save = async () => {
      saving.value = true;
      try {
        if (editing.value) {
          await postJSON(`housing/${editing.value.id}`, form);
        } else {
          await postJSON("housing", form);
        }
        modalOpen.value = false;
        await load();
      } catch (e) {
        alert(e.message || "Save failed");
      } finally {
        saving.value = false;
      }
    };

    const toggle = async (row) => {
      try {
        const resp = await postJSON(`housing/${row.id}/toggle`);
        row.visibility_status = resp.visibility;
      } catch (e) {
        alert(e.message || "Toggle failed");
      }
    };

    const checkUrl = async (row) => {
      try {
        const resp = await postJSON(`housing/${row.id}/check`);
        // reflect http_status in UI without full reload
        row.http_status = resp.http_status || null;
        await load(); // or just leave optimistic
      } catch (e) {
        alert(e.message || "Check failed");
      }
    };

    const remove = async (row) => {
      if (!confirm("Delete this item?")) return;
      try {
        await delJSON(`housing/${row.id}`);
        await load();
      } catch (e) {
        alert(e.message || "Delete failed");
      }
    };

    onMounted(load);

    const pageCount = computed(() => Math.ceil(total.value / perPage.value));

    return {
      items,
      total,
      page,
      perPage,
      loading,
      error,
      filter,
      modalOpen,
      form,
      editing,
      saving,
      load,
      openCreate,
      openEdit,
      save,
      toggle,
      checkUrl,
      remove,
      pageCount,
    };
  },

  template: `
  <div class="jrj-card">
    <h2>Housing Links</h2>

    <div class="jrj-toolbar">
      <input type="search" placeholder="Search title or URL…" v-model="filter.q" @keyup.enter="page=1; load()" />
      <label>Visibility
        <select v-model="filter.visibility" @change="page=1; load()">
          <option value="">All</option>
          <option value="public">public</option>
          <option value="private">private</option>
          <option value="hidden">hidden</option>
        </select>
      </label>
      <input type="text" placeholder="Category" v-model="filter.category" @keyup.enter="page=1; load()" />
      <button class="button" @click="page=1; load()">Filter</button>
      <span style="flex:1"></span>
      <button class="button button-primary" @click="openCreate">Add Link</button>
    </div>

    <div v-if="error" class="notice notice-error" style="margin:8px 0;">{{ error }}</div>

    <table class="jrj-table">
      <thead>
        <tr>
          <th>#</th><th>Title</th><th>URL</th><th>Category</th><th>Vis</th>
          <th>HTTP</th><th>Checked</th><th>Updated</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading"><td colspan="9">Loading…</td></tr>
        <tr v-for="r in items" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.title }}</td>
          <td><a :href="r.url" target="_blank" rel="noopener">{{ r.url }}</a></td>
          <td>{{ r.category || '—' }}</td>
          <td>{{ r.visibility_status }}</td>
          <td>{{ r.http_status || '—' }}</td>
          <td>{{ r.last_checked || '—' }}</td>
          <td>{{ r.updated_at }}</td>
          <td class="actions">
            <button class="button" @click="toggle(r)">Toggle</button>
            <button class="button" @click="checkUrl(r)">Check</button>
            <button class="button" @click="openEdit(r)">Edit</button>
            <button class="button" @click="remove(r)">Delete</button>
          </td>
        </tr>
        <tr v-if="!loading && items.length===0"><td colspan="9">No items</td></tr>
      </tbody>
    </table>

    <div class="jrj-pagination" v-if="pageCount > 1">
      <button class="button" :disabled="page===1" @click="page--; load()">«</button>
      <span>Page {{ page }} / {{ pageCount }}</span>
      <button class="button" :disabled="page>=pageCount" @click="page++; load()">»</button>
    </div>

    <div v-if="modalOpen" class="jrj-modal">
      <div class="jrj-modal-body">
        <button class="jrj-modal-close" @click="modalOpen=false">×</button>
        <h3>{{ editing ? 'Edit Link' : 'Add Link' }}</h3>
        <table class="form-table"><tbody>
          <tr><th><label>Title</label></th><td><input type="text" v-model="form.title" /></td></tr>
          <tr><th><label>URL</label></th><td><input type="url" v-model="form.url" placeholder="https://..." /></td></tr>
          <tr><th><label>Category</label></th><td><input type="text" v-model="form.category" /></td></tr>
          <tr><th><label>Visibility</label></th>
              <td>
                <select v-model="form.visibility">
                  <option value="public">public</option>
                  <option value="private">private</option>
                  <option value="hidden">hidden</option>
                </select>
              </td>
          </tr>
          <tr><th><label>Sort Order</label></th><td><input type="number" v-model.number="form.sort_order" /></td></tr>
          <tr><th><label>Notes</label></th><td><textarea v-model="form.notes" rows="3"></textarea></td></tr>
        </tbody></table>

        <div class="row" style="margin-top:12px;">
          <button class="button button-primary" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <button class="button" @click="modalOpen=false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
  `,
};
