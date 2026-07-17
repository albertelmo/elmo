const CAT_DEFS = [
    { key: 'mini', label: '미니', color: '#ed8936', field: 'mini_kg' },
    { key: 'rabi', label: '라비', color: '#2dd4bf', field: 'rabi_kg' }
];

function getCatDef(key) {
    return CAT_DEFS.find(cat => cat.key === key);
}

function getCatLabel(key) {
    const cat = getCatDef(key);
    return cat ? cat.label : key;
}

function formatWeightKg(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '-';
    }
    return `${Number(value).toFixed(2)}kg`;
}

function buildCatHistorySeries(records) {
    return (records || []).map(record => ({
        id: record.id,
        recordedAt: record.recorded_at,
        mini: record.mini_kg,
        rabi: record.rabi_kg,
        note: record.note || ''
    }));
}

function renderCatWeightChart(canvasId, historySeries, existingChart) {
    if (existingChart) {
        existingChart.destroy();
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas || !historySeries.length) {
        return null;
    }

    const labels = historySeries.map(item => item.recordedAt);
    const datasets = CAT_DEFS.map(cat => ({
        label: cat.label,
        data: historySeries.map(item => item[cat.key]),
        borderColor: cat.color,
        backgroundColor: 'transparent',
        spanGaps: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6
    }));

    return new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    ticks: {
                        callback(value) {
                            return `${Number(value).toFixed(1)}kg`;
                        }
                    }
                }
            },
            plugins: {
                datalabels: { display: false },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const value = context.parsed.y;
                            if (value === null || value === undefined) {
                                return `${context.dataset.label}: -`;
                            }
                            return `${context.dataset.label}: ${formatWeightKg(value)}`;
                        }
                    }
                }
            }
        }
    });
}
