const ASSET_OWNERS = [
    { key: 'jaesik', label: '김재식' },
    { key: 'jieun', label: '임지은' }
];

const ASSET_TYPE_DEFS = [
    { key: 'domestic', label: '국내투자', hasReturnRate: true, isForeign: false },
    { key: 'foreign', label: '국외투자', hasReturnRate: true, isForeign: true },
    { key: 'coin', label: '코인투자', hasReturnRate: true, isForeign: false },
    { key: 'deposit', label: '예금', hasReturnRate: false, isForeign: false }
];

const ASSET_TYPE_COLORS = {
    domestic: '#667eea',
    foreign: '#48bb78',
    coin: '#ed8936',
    deposit: '#4299e1'
};

const OWNER_COLORS = {
    jaesik: '#667eea',
    jieun: '#ed64a6'
};

if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

function getAssetTypeDef(key) {
    return ASSET_TYPE_DEFS.find(type => type.key === key);
}

function getOwnerLabel(key) {
    const owner = ASSET_OWNERS.find(item => item.key === key);
    return owner ? owner.label : key;
}

function formatKrw(amount) {
    const value = Math.round(Number(amount) || 0);
    return `${value.toLocaleString('ko-KR')}원`;
}

function formatManwon(amount) {
    const value = Math.round((Number(amount) || 0) / 10000);
    return `${value.toLocaleString('ko-KR')}만원`;
}

function sanitizeNumberInput(value) {
    let cleaned = String(value || '').replace(/[^\d.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot !== -1) {
        cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    return cleaned;
}

function formatNumberWithCommas(rawValue) {
    const cleaned = sanitizeNumberInput(rawValue);
    if (!cleaned) {
        return '';
    }
    const [intPart, decPart] = cleaned.split('.');
    const formattedInt = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
}

function getNumericInputValue(input) {
    if (!input) {
        return 0;
    }
    const cleaned = sanitizeNumberInput(input.value);
    return cleaned === '' || cleaned === '.' ? 0 : Number(cleaned);
}

function setNumberInputValue(input, value) {
    if (!input) {
        return;
    }
    input.value = formatNumberWithCommas(value);
}

function attachThousandsFormatting(input) {
    input.addEventListener('input', () => {
        const cursorFromEnd = input.value.length - input.selectionStart;
        const formatted = formatNumberWithCommas(input.value);
        input.value = formatted;
        const nextPos = Math.max(0, formatted.length - cursorFromEnd);
        input.setSelectionRange(nextPos, nextPos);
    });
}

function formatPercent(rate) {
    if (rate === null || rate === undefined || Number.isNaN(Number(rate))) {
        return '-';
    }
    const value = Number(rate);
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}

function computePrincipal(currentValue, returnRatePercent) {
    if (!currentValue || returnRatePercent === null || returnRatePercent === undefined || Number.isNaN(Number(returnRatePercent))) {
        return null;
    }
    const rateDecimal = Number(returnRatePercent) / 100;
    if (rateDecimal <= -1) {
        return null;
    }
    return currentValue / (1 + rateDecimal);
}

function computeInvestmentSummary(entries, ownerFilter) {
    let principalSum = 0;
    let currentSum = 0;

    (entries || []).forEach(entry => {
        if (ownerFilter && entry.owner !== ownerFilter) {
            return;
        }
        const type = getAssetTypeDef(entry.asset_type);
        if (!type) {
            return;
        }

        // 수익률 입력이 없는 자산(예: 예금)은 변동이 없는 것으로 간주해 0%로 계산한다.
        const currentValue = Number(entry.amount_krw) || 0;
        const rate = entry.return_rate === null || entry.return_rate === undefined ? 0 : Number(entry.return_rate);
        const principal = computePrincipal(currentValue, rate);

        principalSum += principal === null ? currentValue : principal;
        currentSum += currentValue;
    });

    const profit = currentSum - principalSum;
    const returnRate = principalSum ? (profit / principalSum) * 100 : 0;

    return { principal: principalSum, current: currentSum, profit, returnRate };
}

function sumEntries(entries, filterFn) {
    return (entries || []).filter(filterFn).reduce((sum, entry) => sum + Number(entry.amount_krw), 0);
}

function computeTypeInvestment(entries, typeKey, owner) {
    const type = getAssetTypeDef(typeKey);
    if (!type) {
        return null;
    }

    let principalSum = 0;
    let currentSum = 0;

    (entries || []).forEach(entry => {
        if (entry.asset_type !== typeKey) {
            return;
        }
        if (owner && entry.owner !== owner) {
            return;
        }

        const currentValue = Number(entry.amount_krw) || 0;
        const rate = entry.return_rate === null || entry.return_rate === undefined ? 0 : Number(entry.return_rate);
        const principal = computePrincipal(currentValue, rate);

        principalSum += principal === null ? currentValue : principal;
        currentSum += currentValue;
    });

    const returnRate = principalSum ? ((currentSum - principalSum) / principalSum) * 100 : 0;
    return { principal: principalSum, current: currentSum, returnRate };
}

function computeOwnerComposition(entries, owner) {
    return ASSET_TYPE_DEFS
        .map(type => ({
            type: type.key,
            label: type.label,
            color: ASSET_TYPE_COLORS[type.key],
            amount: sumEntries(entries, entry => entry.owner === owner && entry.asset_type === type.key),
            investment: computeTypeInvestment(entries, type.key, owner)
        }))
        .filter(item => item.amount > 0);
}

function computeTotalComposition(entries) {
    return ASSET_TYPE_DEFS
        .map(type => ({
            type: type.key,
            label: type.label,
            color: ASSET_TYPE_COLORS[type.key],
            amount: sumEntries(entries, entry => entry.asset_type === type.key),
            investment: computeTypeInvestment(entries, type.key, null)
        }))
        .filter(item => item.amount > 0);
}

function computeOwnerTotal(entries, owner) {
    return sumEntries(entries, entry => entry.owner === owner);
}

function buildHistorySeries(snapshots) {
    return snapshots.map(snapshot => {
        const entries = snapshot.entries || [];
        const byType = {};
        ASSET_TYPE_DEFS.forEach(type => {
            byType[type.key] = sumEntries(entries, entry => entry.asset_type === type.key);
        });

        const byOwner = {};
        ASSET_OWNERS.forEach(owner => {
            byOwner[owner.key] = sumEntries(entries, entry => entry.owner === owner.key);
        });

        return {
            id: snapshot.id,
            recordedAt: snapshot.recorded_at,
            usdKrw: Number(snapshot.usd_krw),
            total: sumEntries(entries, () => true),
            byType,
            byOwner
        };
    });
}

function renderPieChart(canvasId, compositionItems, existingChart) {
    if (existingChart) {
        existingChart.destroy();
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        return null;
    }

    if (!compositionItems.length) {
        return null;
    }

    return new Chart(canvas, {
        type: 'pie',
        data: {
            labels: compositionItems.map(item => item.label),
            datasets: [{
                data: compositionItems.map(item => item.amount),
                backgroundColor: compositionItems.map(item => item.color),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    align: 'start',
                    labels: {
                        generateLabels(chart) {
                            const data = chart.data.datasets[0].data;
                            const total = data.reduce((sum, value) => sum + value, 0);
                            return chart.data.labels.map((label, index) => {
                                const value = data[index];
                                const percent = total ? ((value / total) * 100).toFixed(1) : '0.0';
                                const amount = Math.round(value / 10000).toLocaleString('ko-KR');
                                let text = `${label} ${amount} (${percent}%)`;

                                const item = compositionItems[index];
                                const typeDef = item && getAssetTypeDef(item.type);
                                const investment = typeDef && typeDef.hasReturnRate ? item.investment : null;
                                if (investment) {
                                    const principalManwon = Math.round(investment.principal / 10000).toLocaleString('ko-KR');
                                    text += ` · 원금 ${principalManwon} ${formatPercent(investment.returnRate)}`;
                                }

                                return {
                                    text,
                                    fillStyle: chart.data.datasets[0].backgroundColor[index],
                                    index
                                };
                            });
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const total = context.dataset.data.reduce((sum, value) => sum + value, 0);
                            const value = context.parsed;
                            const percent = total ? ((value / total) * 100).toFixed(1) : '0.0';
                            return `${context.label}: ${formatKrw(value)} (${percent}%)`;
                        }
                    }
                },
                datalabels: {
                    color: '#ffffff',
                    font: { weight: '700', size: 12 },
                    textAlign: 'center',
                    formatter(value, context) {
                        const data = context.dataset.data;
                        const total = data.reduce((sum, item) => sum + item, 0);
                        const percent = total ? ((value / total) * 100).toFixed(1) : '0.0';
                        const amount = Math.round(value / 10000).toLocaleString('ko-KR');
                        return [amount, `(${percent}%)`];
                    }
                }
            }
        }
    });
}

function renderTrendChart(canvasId, historySeries, mode, existingChart) {
    if (existingChart) {
        existingChart.destroy();
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        return null;
    }

    const labels = historySeries.map(item => item.recordedAt);
    let datasets;

    if (mode === 'owner') {
        datasets = ASSET_OWNERS.map(owner => ({
            label: owner.label,
            data: historySeries.map(item => item.byOwner[owner.key]),
            borderColor: OWNER_COLORS[owner.key],
            backgroundColor: 'transparent',
            tension: 0.3
        }));
    } else if (mode === 'type') {
        datasets = ASSET_TYPE_DEFS.map(type => ({
            label: type.label,
            data: historySeries.map(item => item.byType[type.key]),
            borderColor: ASSET_TYPE_COLORS[type.key],
            backgroundColor: 'transparent',
            tension: 0.3
        }));
    } else {
        datasets = [{
            label: '총자산',
            data: historySeries.map(item => item.total),
            borderColor: '#667eea',
            backgroundColor: 'rgba(102, 126, 234, 0.15)',
            fill: true,
            tension: 0.3
        }];
    }

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
                            return `${(value / 10000).toLocaleString('ko-KR')}만`;
                        }
                    }
                }
            },
            plugins: {
                datalabels: { display: false },
                tooltip: {
                    callbacks: {
                        label(context) {
                            return `${context.dataset.label}: ${formatKrw(context.parsed.y)}`;
                        }
                    }
                }
            }
        }
    });
}
