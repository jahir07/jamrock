/* global JRJ_ADMIN */
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import Chart from "chart.js/auto";

export default {
  name: "BarChartCard",
  props: {
    title: { type: String, default: "Chart" },
    subtitle: { type: String, default: "" },
    endpoint: { type: String, required: true }, // relative to JRJ_ADMIN.root (e.g. 'insights/active-users')
    days: { type: Number, default: 7 },
    horizontal: { type: Boolean, default: false },
    color: { type: String, default: "#2f6fa4" }, // default dataset color
    height: { type: Number, default: 240 }, // px height of card chart area
  },
  setup(props, { slots }) {
    const loading = ref(false);
    const error = ref("");
    const canvasEl = ref(null);
    const chartInst = ref(null);
    const items = ref([]);

    // Fetch from WP REST route
    async function fetchData() {
      loading.value = true;
      error.value = "";
      try {
        const root =
          typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN.root
            ? JRJ_ADMIN.root
            : "/wp-json/jamrock/v1/";
        const nonce =
          typeof JRJ_ADMIN !== "undefined" && JRJ_ADMIN.nonce
            ? JRJ_ADMIN.nonce
            : "";
        const url =
          root.replace(/\/$/, "") + "/" + props.endpoint.replace(/^\//, "");
        const q = new URL(url, location.origin);
        q.searchParams.set("days", String(props.days));
        const res = await fetch(q.toString(), {
          method: "GET",
          credentials: "same-origin",
          headers: {
            "X-WP-Nonce": nonce,
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error("HTTP " + res.status + (txt ? " - " + txt : ""));
        }
        const json = await res.json();
        items.value = Array.isArray(json.items)
          ? json.items
          : Array.isArray(json.results)
          ? json.results
          : Array.isArray(json)
          ? json
          : [];
        renderOrUpdateChart();
      } catch (e) {
        error.value = e.message || "Fetch failed";
        // keep items as-is
      } finally {
        loading.value = false;
      }
    }

    // Build chart payload — detect time_spent
    // replace existing buildChartData() with this
    function buildChartData() {
      const arr = items.value || [];
      if (!arr || arr.length === 0) {
        return { mode: "empty", labels: [], datasets: [] };
      }

      // 1) TIME-SPENT multi-series (spent/saved)
      if (arr[0].spent !== undefined && arr[0].saved !== undefined) {
        const labels = arr.map((i) => i.range || i.day || i.label || "");
        const spent = arr.map((i) => Number(i.spent || 0));
        const saved = arr.map((i) => Number(i.saved || 0));
        return {
          mode: "time_spent",
          unit: "min", // we'll display in minutes
          labels,
          datasets: [
            {
              label: "Spent (min)",
              data: spent.map((v) => Math.round(v / 60)),
              backgroundColor: "#111111",
              barThickness: 10,
            },
            {
              label: "Saved (min)",
              data: saved.map((v) => Math.round(v / 60)),
              backgroundColor: "#00a88b",
              barThickness: 10,
            },
          ],
        };
      }

      // 2) TIME-SPENT single-field 'seconds'
      if (arr[0].seconds !== undefined) {
        const labels = arr.map((i) => i.range || i.day || i.label || "");
        // convert seconds -> minutes (round)
        const mins = arr.map((i) => {
          const s = Number(i.seconds ?? i.seconds_str ?? 0);
          return Math.round((isNaN(s) ? 0 : s) / 60);
        });
        return {
          mode: "time_spent",
          unit: "min",
          labels,
          datasets: [
            {
              label: "Spent (min)",
              data: mins,
              backgroundColor: props.color || "#111111",
              barThickness: 10,
            },
          ],
        };
      }

      // 3) generic single-dataset (active-users / searches / counts)
      const labels = arr.map(
        (i) => i.day || i.range || i.query || i.label || ""
      );
      const values = arr.map((i) => {
        return (
          Number(
            i.unique_users ??
              i.cnt ??
              i.value ??
              i.count ??
              i.total ??
              i.seconds ??
              0
          ) || 0
        );
      });

      return {
        mode: "single",
        labels,
        datasets: [
          {
            label: props.title,
            data: values,
            backgroundColor: props.color,
            barThickness: 10,
          },
        ],
      };
    }

    // replace/update renderOrUpdateChart() to include formatting for time_spent
    function renderOrUpdateChart() {
      if (!canvasEl.value) return;
      const ctx = canvasEl.value.getContext("2d");
      const payload = buildChartData();

      // horizontal only for non-time_spent single datasets if prop set
      const indexAxis =
        props.horizontal && payload.mode !== "time_spent" ? "y" : "x";

      // y tick formatter - if time_spent (unit= min) show hr/min friendly labels
      const yTickCallback = function (value) {
        if (payload.mode === "time_spent") {
          // value is minutes (we converted earlier)
          if (value >= 60) {
            const h = value / 60;
            // show 1.5h as "1.5h" or integer hours as "1h"
            return Number.isInteger(h)
              ? String(h) + "h"
              : Math.round(h * 10) / 10 + "h";
          }
          return String(value) + "m";
        }
        return String(value);
      };

      const config = {
        type: "bar",
        data: {
          labels: payload.labels,
          datasets: payload.datasets.map((ds) => ({ ...ds, borderRadius: 6 })),
        },
        options: {
          indexAxis,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: payload.datasets.length > 1 },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const v =
                    context.parsed.y !== undefined
                      ? context.parsed.y
                      : context.parsed.x;
                  if (payload.mode === "time_spent") {
                    if (v >= 60) {
                      const h = v / 60;
                      return `${context.dataset.label || ""}: ${
                        Number.isInteger(h) ? h : Math.round(h * 10) / 10
                      } h`;
                    }
                    return `${context.dataset.label || ""}: ${v} min`;
                  }
                  return `${context.dataset.label || ""}: ${v}`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                maxRotation: 40,
                autoSkip: true,
                maxTicksLimit: 8,
              },
            },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(0,0,0,0.03)" },
              ticks: {
                callback: yTickCallback,
              },
            },
          },
          layout: { padding: { top: 6, right: 6, bottom: 6, left: 6 } },
        },
      };

      if (chartInst.value) {
        chartInst.value.options.indexAxis = config.options.indexAxis;
        chartInst.value.options.plugins = config.options.plugins;
        chartInst.value.data.labels = config.data.labels;
        chartInst.value.data.datasets = config.data.datasets;
        chartInst.value.options.scales = config.options.scales;
        chartInst.value.update();
      } else {
        chartInst.value = new Chart(ctx, config);
      }
    }

    onMounted(() => {
      // set canvas parent height to prop.height
      const wrap = canvasEl.value && canvasEl.value.parentElement;
      if (wrap) {
        wrap.style.height = props.height + "px";
      }
      fetchData();
    });

    onBeforeUnmount(() => {
      if (chartInst.value) {
        chartInst.value.destroy();
        chartInst.value = null;
      }
    });

    // watch days prop change
    watch(
      () => props.days,
      (nv, ov) => {
        if (nv !== ov) fetchData();
      }
    );

    return {
      loading,
      error,
      canvasEl,
      items,
      fetchData,
      slots,
    };
  },
  template: `
    <div class="jrj-card jrj-chart-card" style="display:flex;flex-direction:column;height:260px;">
      <div style="padding:16px 20px 8px;">
        <h3 style="margin:0;">{{ title }}</h3>
        <div style="color:#777;font-size:13px;margin-top:6px;">{{ subtitle }}</div>
      </div>

      <div class="jrj-chart-body" style="flex:1;display:flex;flex-direction:column;">
        <div class="jrj-chart-wrap" style="flex:1;min-height:120px;padding:0 18px;">
          <canvas ref="canvasEl"></canvas>
        </div>
      </div>

      <!-- optional extra slot (e.g. keywords list) -->
      <div v-if="$slots.extra" style="padding:8px 20px 16px;border-top:1px solid #fafafa;">
        <slot name="extra"></slot>
      </div>
    </div>
  `,
};
