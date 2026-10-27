// DC Level Display JavaScript
// Auto-refreshing display for 1080p monitors

const APP_CONFIG = {
    refreshInterval: 60000,       // 1 minute, matches the poller's cron schedule
    dataUrl: 'data/level.json',   // written by poller/dc_level_poller.py
    staleAfter: 180000,           // no fresh gauge reading for 3 minutes = gauge offline
    timeZone: 'America/New_York',
    bagCapacityYd3: 1.0,
    thresholds: {
        warning: 75,              // % full
        critical: 90
    },
    faultMa: {
        min: 3.6,                 // outside the 4-20 mA band = wiring or sensor fault
        max: 21.0
    }
};

const STATUS_LABELS = {
    normal: 'Normal',
    warning: 'Nearly Full',
    critical: 'Empty the Bag',
    fault: 'Gauge Fault',
    offline: 'Gauge Offline'
};

let updateTimer = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('DC Level Display Initializing...');

    if (typeof BagView === 'undefined') {
        console.error('BagView module not loaded');
        document.body.innerHTML = '<div class="error-message">Bag view failed to load. Please refresh the page.</div>';
        return;
    }

    BagView.init(document.getElementById('bagSvg'), APP_CONFIG.bagCapacityYd3);
    renderScales();

    fetchLevel();
    updateTimer = setInterval(fetchLevel, APP_CONFIG.refreshInterval);
});

function renderScales() {
    const { warning, critical } = APP_CONFIG.thresholds;
    document.getElementById('warningLine').style.bottom = `${warning}%`;
    document.getElementById('criticalLine').style.bottom = `${critical}%`;

    document.getElementById('volumeScale').innerHTML = [100, 75, 50, 25, 0]
        .map(pct => `<span style="bottom: ${pct}%">${(pct / 100 * APP_CONFIG.bagCapacityYd3).toFixed(2)} yd³</span>`)
        .join('');
    document.getElementById('bagSubtitle').textContent = `${APP_CONFIG.bagCapacityYd3} yd³ bulk bag`;

    document.getElementById('legendNormal').textContent = `< ${warning}% (Normal)`;
    document.getElementById('legendWarning').textContent = `${warning}-${critical}% (Nearly Full)`;
    document.getElementById('legendCritical').textContent = `≥ ${critical}% (Empty the Bag)`;
}

async function fetchLevel() {
    try {
        const response = await fetch(`${APP_CONFIG.dataUrl}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        updateDisplay(await response.json());
    } catch (error) {
        console.error('Failed to fetch level data:', error);
        updateConnectionStatus(false, 'Disconnected');
    }
}

function getLevelStatus(data) {
    const reading = data.reading;
    if (!data.ok || !reading) return 'offline';
    if (Date.now() - new Date(reading.read_at).getTime() > APP_CONFIG.staleAfter) return 'offline';
    if (reading.current_ma < APP_CONFIG.faultMa.min || reading.current_ma > APP_CONFIG.faultMa.max) return 'fault';
    if (reading.fill_percent >= APP_CONFIG.thresholds.critical) return 'critical';
    if (reading.fill_percent >= APP_CONFIG.thresholds.warning) return 'warning';
    return 'normal';
}

function updateDisplay(data) {
    const reading = data.reading;
    const status = getLevelStatus(data);

    updateConnectionStatus(status !== 'offline', status === 'offline' ? 'Gauge Offline' : 'Connected');

    const badge = document.getElementById('overallStatus');
    badge.textContent = STATUS_LABELS[status];
    badge.className = `value status-badge ${status}`;

    if (!reading) {
        document.getElementById('lastUpdateTime').textContent = 'No gauge readings yet';
        return;
    }

    const fill = reading.fill_percent;
    const capacity = APP_CONFIG.bagCapacityYd3;
    const volume = fill / 100 * capacity;

    document.getElementById('lastUpdateTime').textContent = `Last reading: ${formatTime(reading.read_at)}`;

    // Vertical level bar
    const levelFill = document.getElementById('levelFill');
    levelFill.style.height = `${fill}%`;
    levelFill.className = `level-fill ${status}`;

    const levelPercent = document.getElementById('levelPercent');
    levelPercent.textContent = `${Math.round(fill)}%`;
    levelPercent.className = `level-percent ${status}`;
    document.getElementById('levelVolume').textContent = `${volume.toFixed(2)} yd³`;

    // Bag
    BagView.setLevel(fill / 100, status === 'offline' || status === 'fault');
    document.getElementById('bagCaption').innerHTML =
        `${volume.toFixed(2)} yd³ <span class="muted">of sawdust in a ${capacity} yd³ bag</span>`;

    // Sidebar
    document.getElementById('fillValue').textContent = `${fill.toFixed(1)}%`;
    document.getElementById('volumeValue').textContent = `${volume.toFixed(2)} yd³`;
    document.getElementById('roomValue').textContent = `${(capacity - volume).toFixed(2)} yd³`;
    document.getElementById('signalValue').textContent = `${reading.current_ma.toFixed(2)} mA`;
    document.getElementById('rawValue').textContent = reading.raw;
    document.getElementById('readingTime').textContent = formatTime(reading.read_at);
}

function updateConnectionStatus(connected, label) {
    const statusText = document.getElementById('statusText');
    const statusDot = document.querySelector('.status-dot');

    statusText.textContent = label;
    if (connected) {
        statusDot.classList.remove('disconnected');
    } else {
        statusDot.classList.add('disconnected');
    }
}

function formatTime(isoString) {
    return new Date(isoString).toLocaleTimeString('en-US', {
        timeZone: APP_CONFIG.timeZone,
        hour: 'numeric',
        minute: '2-digit'
    });
}
