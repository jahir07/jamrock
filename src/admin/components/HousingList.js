import { ref, onMounted } from 'vue/dist/vue.esm-bundler.js';

export default {
	name: 'HousingList',
	setup() {
		const items = ref( [] ),
			loading = ref( false );

		const load = async () => {
			loading.value = true;
			try {
				const data = await fetch(JRJ_ADMIN.root + "housing");
				items.value = data.items || [];
			} finally {
				loading.value = false;
			}
		};

		onMounted( load );
		return { items, loading };
	},
	template: `
  <div class="jrj-card">
    <h2>Housing Links</h2>
    <table class="jrj-table">
      <thead><tr><th>#</th><th>Title</th><th>URL</th><th>Visibility</th><th>Updated</th></tr></thead>
      <tbody>
        <tr v-if="loading"><td colspan="5">Loading…</td></tr>
        <tr v-for="r in items" :key="r.id">
          <td>{{ r.id }}</td>
          <td>{{ r.title }}</td>
          <td><a :href="r.url" target="_blank" rel="noopener">{{ r.url }}</a></td>
          <td>{{ r.visibility_status }}</td>
          <td>{{ r.updated_at }}</td>
        </tr>
        <tr v-if="!loading && items.length===0"><td colspan="5">No items</td></tr>
      </tbody>
    </table>
  </div>
  `,
};
