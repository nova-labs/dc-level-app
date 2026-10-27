# DC Level App: Dust Collection Monitor

A live fill-level display for the Nova Labs dust collector bag, built for the Xibo signage screens.
A level gauge on the collector is read once a minute over Modbus/TCP. The display shows how full the
1 yd³ collection bag is, so members know when it needs emptying before it overflows.

**Live:** http://xibo.space.nova-labs.org/dc-level/  
**Version:** `v0.2.1`

![Dust Collection Monitor display](docs/screenshot.png)

---

## Table of Contents

1. [What the display shows](#what-the-display-shows)
2. [How it works](#how-it-works)
3. [The level gauge](#the-level-gauge)
4. [Repository layout](#repository-layout)
5. [Configuration](#configuration)
6. [Deployment](#deployment)
7. [Showing it on a screen (Xibo)](#showing-it-on-a-screen-xibo)
8. [Local development](#local-development)
9. [Operations and troubleshooting](#operations-and-troubleshooting)
10. [Version history](#version-history)

---

## What the display shows

A single 1920×1080 page in the same dark kiosk style as the
[Sound Monitoring Mesh](https://github.com/sklosky-nl/sound-monitoring-mesh) display, which runs on the same server.

| Area | What it shows |
|------|---------------|
| **Fill Level** (left) | Vertical bar, color-coded by status, with % and yd³ scales and dashed lines at the warning levels |
| **Collection Bag** (center) | A see-through 1 yd³ bulk bag with sawdust filled to the measured level. The sawdust heaps up under the inlet chute. |
| **Bag Status** (right) | Status, % full, sawdust volume, room left |
| **Level Gauge** (right) | Gauge signal (mA), raw register value, time of last reading |

| Status | When | Color |
|--------|------|-------|
| Normal | below 75% full | Green |
| Nearly Full | 75–90% full | Yellow |
| Empty the Bag | 90% full or more | Red |
| Gauge Offline | no successful gauge reading for 3 minutes | Grey (sawdust greyed out) |
| Gauge Fault | signal outside 3.6–21 mA (broken wire or sensor problem) | Grey |

The header dot shows **Connected**, **Gauge Offline**, or **Disconnected** (the screen can't reach the server).

---

## How it works

```
Level gauge (4–20 mA)                xibo.space.nova-labs.org (Ubuntu, Apache)
192.168.1.181:502   ──Modbus/TCP──▶   cron, every minute
                                        └─ poller/dc_level_poller.py
                                             │ writes
                                             ▼
                                      /opt/dc-level-app/frontend/data/level.json
                                             │ served by Apache at /dc-level/
                                             ▼
                                      index.html (Xibo screen) fetches it every minute
```

- Browsers can't talk Modbus, so a small **poller** on the xibo server reads the gauge and writes the
  result to a JSON file. It uses only the Python 3 standard library, with no `pymodbus` and nothing to install.
- Apache serves the page and the JSON file as static files. There is no backend service to keep running.
- If a gauge read fails, the poller keeps the last good reading and sets `"ok": false`. The display then
  greys out instead of showing a wrong number.

### `level.json`

```json
{
  "ok": true,
  "checked_at": "2026-10-27T22:22:14Z",
  "error": null,
  "reading": {
    "read_at": "2026-10-27T22:22:14Z",
    "raw": 13378,
    "current_ma": 13.378,
    "fill_percent": 58.6
  }
}
```

`checked_at` is the last attempt and `reading.read_at` is the last successful read. Times are UTC. The
display shows them in `America/New_York`.

---

## The level gauge

Connection details come from Gillian's working FUXA config:

| Setting | Value |
|---------|-------|
| Protocol | Modbus/TCP |
| Address | `192.168.1.181`, port `502` |
| Device (unit ID) | `1` |
| Register | `300101` (Modicon numbering) = **input register, offset 100** (function code 4) |
| Type | Int16 |
| Range | 4.00 mA = empty, 20.00 mA = full |

**Scaling.** The register reports the loop current in **microamps**. For example, `13378` is 13.378 mA.

```
current_mA   = raw / 1000
fill_percent = (current_mA − 4) / 16 × 100        (clamped to 0–100)
volume_yd3   = fill_percent / 100 × bag capacity
```

> The microamp scaling was worked out from live readings: it's the only interpretation that lands in the
> 4–20 range. It hasn't been checked against FUXA's scaling settings or a physical measurement of the bag.

The xibo server and the lab network can both reach the gauge. The poller opens one short connection a
minute, which doesn't interfere with FUXA reading the same device.

---

## Repository layout

```
dc-level-app/
├── frontend/                  ← deployed to /opt/dc-level-app/frontend
│   ├── index.html             ← the page (1920×1080 kiosk layout)
│   ├── css/styles.css         ← kiosk styles, shared look with the sound monitoring display
│   ├── js/app.js              ← APP_CONFIG, polling, status logic, level bar, sidebar
│   ├── js/bag.js              ← SVG bulk bag and sawdust drawing
│   └── data/level.json        ← written by the poller (gitignored, never deployed)
├── poller/
│   └── dc_level_poller.py     ← Modbus reader, run by cron; deployed to /opt/dc-level-app/poller
├── scripts/
│   ├── deploy.sh              ← push changes and install the cron job (no sudo)
│   └── server-setup.sh        ← one-time root setup: app directory + Apache route
└── docs/
    └── screenshot.png
```

---

## Configuration

**Display settings** are in `APP_CONFIG` at the top of [`frontend/js/app.js`](frontend/js/app.js):

| Setting | Default | Meaning |
|---------|---------|---------|
| `bagCapacityYd3` | `1.0` | Bag size. Drives the scales, volume, room left, and the bag's subtitle. |
| `thresholds.warning` | `75` | % full that turns the display yellow |
| `thresholds.critical` | `90` | % full that turns the display red ("Empty the Bag") |
| `staleAfter` | `180000` ms | How old the last reading can get before showing "Gauge Offline" |
| `faultMa.min` / `faultMa.max` | `3.6` / `21.0` | Signal outside this range shows "Gauge Fault" |
| `refreshInterval` | `60000` ms | How often the page fetches `level.json` |
| `timeZone` | `America/New_York` | Time zone for displayed times |

**Gauge settings** are the constants at the top of
[`poller/dc_level_poller.py`](poller/dc_level_poller.py): host, port, unit ID, register, scaling, and empty/full mA.

After changing anything in `frontend/`, bump the `?v=` cache-busting numbers in `index.html`. Otherwise
screens and browsers may keep showing the old CSS or JS.

---

## Deployment

### Production

| Item | Value |
|------|-------|
| Server | `xibo.space.nova-labs.org`: Ubuntu 20.04, Apache 2.4. Also runs the Xibo CMS and the sound monitoring app. |
| URL | `http://xibo.space.nova-labs.org/dc-level/` |
| App directory | `/opt/dc-level-app` (owned by `sklosky`) |
| Cron | `sklosky`'s crontab, every minute. Errors go to syslog with the tag `dc-level-poller`. |
| Apache | `Alias /dc-level` + `ProxyPass /dc-level !` in `000-default.conf` and `000-default-le-ssl.conf`, before Xibo's catch-all `ProxyPass /` |

> **Use http, not https.** The server's Let's Encrypt certificate expired in August 2022, so browsers
> reject https links. This affects the whole server, not just this app.

### Deploying changes

From a machine on the lab network (or VPN) with key-based SSH access to xibo:

```bash
./scripts/deploy.sh
```

This script:
1. copies `frontend/` (except `data/`) and `poller/` to `/opt/dc-level-app`
2. adds the cron entry if it's missing (safe to re-run)
3. takes one gauge reading and prints it

The SSH user is set by `SERVER` at the top of the script. Change it if you deploy as someone else.

### One-time server setup

**Already done; you only need this when rebuilding the server.** It needs sudo:

```bash
scp scripts/server-setup.sh sklosky@xibo.space.nova-labs.org:~/dc-level-app-setup.sh
ssh -t sklosky@xibo.space.nova-labs.org 'sudo bash ~/dc-level-app-setup.sh'
```

It creates `/opt/dc-level-app`, backs up both Apache vhost files to `*.backup-<epoch>`, adds the `/dc-level`
route, and runs `apache2ctl configtest`. It only reloads Apache if the test passes; otherwise it restores the
backups. It's safe to re-run.

---

## Showing it on a screen (Xibo)

1. In the Xibo CMS, add a **Webpage** widget to a 1920×1080 layout.
2. Set the URL to `http://xibo.space.nova-labs.org/dc-level/`.
3. The page refreshes itself every minute, so the widget doesn't need to reload it.

---

## Local development

The page is plain HTML/CSS/JS with no build step.

```bash
# Optional: take a real reading (needs network access to 192.168.1.181)
python3 poller/dc_level_poller.py          # writes frontend/data/level.json

# Serve the frontend and open http://localhost:8080
cd frontend && python3 -m http.server 8080
```

Without access to the gauge, create `frontend/data/level.json` by hand using the format above. Change
`fill_percent` and `current_ma` to try different states. Set `read_at` to the current UTC time; older
readings show as "Gauge Offline".

---

## Operations and troubleshooting

| Task | Command |
|------|---------|
| See the latest reading | `curl http://xibo.space.nova-labs.org/dc-level/data/level.json` |
| Poller errors | on xibo: `journalctl -t dc-level-poller --since "1 hour ago"` |
| Read the gauge by hand | on xibo: `python3 /opt/dc-level-app/poller/dc_level_poller.py && cat /opt/dc-level-app/frontend/data/level.json` |
| Check the cron entry | on xibo: `crontab -l` |

| Symptom | Likely cause |
|---------|--------------|
| **Gauge Offline** | The gauge or its network is down, or cron isn't running. Check `error` in `level.json` and the poller log. |
| **Gauge Fault** | The 4–20 mA signal is out of range: broken loop wiring, no sensor power, or a failed sensor |
| **Disconnected** | The screen can't reach the xibo server, or Apache is down |
| Old look after a deploy | Browser or player cache: bump `?v=` in `index.html` and redeploy |
| Level looks wrong | Check the scaling in the poller against the physical bag (see [The level gauge](#the-level-gauge)) |

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| v0.2.1 | 2026-10-27 | Bag capacity changed to 1 yd³. Scales use two decimals. Bag subtitle comes from config. |
| v0.2.0 | 2026-10-27 | Dust collection monitor: Modbus poller (cron), level bar, see-through sawdust bag, status sidebar |
| v0.1.0 | 2026-10-27 | Hello world page and `/dc-level` Apache route on xibo |

---

**Gauge configuration:** Gillian (FUXA)  
**Author:** Stephen Klosky ([stephen.klosky@nova-labs.org](mailto:stephen.klosky@nova-labs.org))
