// Chart.js の描画(vendor/chart.umd.min.js をグローバル Chart として読み込む)

// 種類ごとの系列色。明暗どちらの背景でも区別しやすい色相を選ぶ
const PALETTE = ['#a0522d', '#e09f3e', '#2a9d8f', '#5b7db1', '#c45a7c', '#7a9a3a', '#8e6cc0', '#4d4d4d'];
const OTHER = '#9e9e9e';

const instances = new Map();
const yenFmt = new Intl.NumberFormat('ja-JP');
const yen = (n) => `¥${yenFmt.format(Math.round(n))}`;

export function isChartAvailable() {
  return typeof window !== 'undefined' && typeof window.Chart === 'function';
}

export function colorAt(i) {
  return i < 0 ? OTHER : PALETTE[i % PALETTE.length];
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function theme() {
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue('--text').trim() || '#222',
    muted: cs.getPropertyValue('--text-muted').trim() || '#666',
    grid: cs.getPropertyValue('--border').trim() || '#ddd',
    surface: cs.getPropertyValue('--surface').trim() || '#fff',
  };
}

function draw(canvas, config) {
  instances.get(canvas)?.destroy();
  const chart = new window.Chart(canvas, config);
  instances.set(canvas, chart);
  return chart;
}

export function destroyAll() {
  for (const c of instances.values()) c.destroy();
  instances.clear();
}

/** 棒の端に金額を描くプラグイン(色だけに頼らず数値を表示する) */
function valueLabels(mode, totals = [], highlight = -1) {
  return {
    id: `valueLabels-${mode}`,
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const t = theme();
      ctx.save();
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = t.text;
      if (mode === 'horizontal') {
        const meta = chart.getDatasetMeta(0);
        ctx.textBaseline = 'middle';
        meta.data.forEach((bar, i) => {
          const v = chart.data.datasets[0].data[i];
          const text = yen(v);
          const w = ctx.measureText(text).width;
          const room = chart.chartArea.right - bar.x;
          if (room >= w + 8) {
            ctx.textAlign = 'left';
            ctx.fillText(text, bar.x + 4, bar.y);
          } else {
            ctx.textAlign = 'right';
            ctx.fillStyle = '#fff';
            ctx.fillText(text, bar.x - 4, bar.y);
            ctx.fillStyle = t.text;
          }
        });
      } else if (mode === 'stackTotal') {
        const metas = chart.getSortedVisibleDatasetMetas();
        const n = chart.data.labels.length;
        const slot = n > 0 ? (chart.chartArea.right - chart.chartArea.left) / n : 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '600 10px system-ui, sans-serif';
        totals.forEach((v, i) => {
          let top = chart.scales.y.getPixelForValue(0);
          let x = chart.scales.x.getPixelForValue(i);
          for (const m of metas) {
            const el = m.data[i];
            if (el && Number.isFinite(el.y)) {
              top = Math.min(top, el.y);
              x = el.x;
            }
          }
          const text = v >= 100000 ? `${(v / 10000).toFixed(0)}万` : v >= 10000 ? `${(v / 10000).toFixed(1)}万` : yenFmt.format(v);
          // 幅が足りない場合は選択中の期間だけ表示する(重なり防止。全期間の数値は表で確認できる)
          if (i !== highlight && ctx.measureText(text).width > slot - 2) return;
          ctx.fillText(text, x, top - 2);
        });
      }
      ctx.restore();
    },
  };
}

/**
 * 種類別ドーナツ。
 * @param {{label:string,value:number,color:string}[]} items
 */
export function renderDonut(canvas, items) {
  const t = theme();
  return draw(canvas, {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.label),
      datasets: [{ data: items.map((i) => i.value), backgroundColor: items.map((i) => i.color), borderColor: t.surface, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: '58%',
      plugins: {
        legend: { position: 'bottom', labels: { color: t.text, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${yen(c.parsed)}` } },
      },
    },
  });
}

/**
 * 場所別の横棒(金額降順)。
 * @param {{label:string,value:number,clickable?:boolean}[]} items
 * @param {(index:number)=>void} onClick
 */
export function renderHorizontalBars(canvas, items, onClick) {
  const t = theme();
  canvas.parentElement.style.height = `${Math.max(120, items.length * 44 + 40)}px`;
  return draw(canvas, {
    type: 'bar',
    data: {
      labels: items.map((i) => (i.clickable ? `${i.label} ›` : i.label)),
      datasets: [
        {
          label: '金額',
          data: items.map((i) => i.value),
          backgroundColor: items.map((i) => (i.clickable ? PALETTE[0] : withAlpha(PALETTE[0], 0.6))),
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { right: 8 } },
      scales: {
        x: { beginAtZero: true, grace: '20%', ticks: { color: t.muted, callback: (v) => yen(v) }, grid: { color: t.grid } },
        y: { ticks: { color: t.text, font: { size: 13 } }, grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${yen(c.parsed.x)}` } },
      },
      onClick: (_ev, els) => {
        if (els.length && onClick) onClick(els[0].index);
      },
      onHover: (ev, els) => {
        const ok = els.length && items[els[0].index]?.clickable;
        ev.native.target.style.cursor = ok ? 'pointer' : 'default';
      },
    },
    plugins: [valueLabels('horizontal')],
  });
}

/**
 * 期間比較の積み上げ棒。選択中の期間(highlight)以外は薄く表示する。
 * @param {string[]} labels
 * @param {{label:string,data:number[],color:string}[]} series
 * @param {number[]} totals
 * @param {number} highlight
 */
export function renderStacked(canvas, labels, series, totals, highlight) {
  const t = theme();
  return draw(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        backgroundColor: s.data.map((_, i) => (i === highlight ? s.color : withAlpha(s.color, 0.35))),
        borderColor: s.data.map((_, i) => (i === highlight ? t.text : 'transparent')),
        borderWidth: s.data.map((_, i) => (i === highlight ? 1 : 0)),
        stack: 'total',
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: (c) => (c.index === highlight ? t.text : t.muted),
            font: (c) => ({ weight: c.index === highlight ? '700' : '400', size: 11 }),
            maxRotation: 0,
            autoSkip: true,
          },
          grid: { display: false },
        },
        y: { stacked: true, beginAtZero: true, grace: '12%', ticks: { color: t.muted, callback: (v) => yen(v) }, grid: { color: t.grid } },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: t.text,
            boxWidth: 12,
            padding: 10,
            // 凡例は薄くしていない本来の色で表示する
            generateLabels: (chart) =>
              series.map((s, i) => ({
                text: s.label,
                fillStyle: s.color,
                strokeStyle: s.color,
                fontColor: t.text,
                hidden: !chart.isDatasetVisible(i),
                datasetIndex: i,
              })),
          },
        },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${yen(c.parsed.y)}`,
            footer: (items) => (items.length ? `合計: ${yen(totals[items[0].dataIndex])}` : ''),
          },
        },
      },
    },
    plugins: [valueLabels('stackTotal', totals, highlight)],
  });
}
