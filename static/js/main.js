document.addEventListener('DOMContentLoaded', () => {
    const nodes = new vis.DataSet([]);
    const edges = new vis.DataSet([]);
    const container = document.getElementById('network-graph');

    const data = {
        nodes: nodes,
        edges: edges
    };

    // Optimized options for smooth performance
    const options = {
        nodes: {
            shape: 'dot',
            size: 10,
            font: {
                size: 14,
                color: '#00f3ff',
                face: 'Share Tech Mono',
                strokeWidth: 0,
                vadjust: -30
            },
            borderWidth: 2,
            shadow: {
                enabled: true,
                color: 'rgba(0, 243, 255, 0.5)',
                size: 10,
                x: 0,
                y: 0
            },
            color: {
                background: '#050a14',
                border: '#00f3ff',
                highlight: {
                    background: '#00f3ff',
                    border: '#ffffff'
                }
            }
        },
        edges: {
            width: 1,
            color: {
                color: 'rgba(0, 243, 255, 0.2)',
                highlight: '#00f3ff',
                opacity: 0.8
            },
            dashes: true,
            smooth: {
                type: 'continuous',
                roundness: 0.2
            },
            length: 250,
            shadow: false // Disable edge shadows for performance
        },
        physics: {
            enabled: true,
            stabilization: {
                enabled: true,
                iterations: 50,
                updateInterval: 50,
                fit: false
            },
            barnesHut: {
                gravitationalConstant: -2000,
                springConstant: 0.001,
                springLength: 200,
                damping: 0.5,
                avoidOverlap: 0.5
            },
            maxVelocity: 30,
            minVelocity: 0.5,
            solver: 'barnesHut',
            timestep: 0.3
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            zoomView: true,
            dragNodes: true
        }
    };

    const network = new vis.Network(container, data, options);
    const gatewayId = 'gateway';

    // Track local IP for "your device" detection
    let localIP = null;
    fetch('/api/local-ip')
        .then(res => res.json())
        .then(data => { localIP = data.ip; })
        .catch(() => { });

    // Store all devices for device list
    let allDevices = [];

    // INCREMENTAL UPDATE - no more clearing all nodes
    function updateGraph(deviceData) {
        allDevices = deviceData;

        const existingNodeIds = new Set(nodes.getIds());
        const existingEdgeIds = new Set(edges.getIds());
        const newNodeIds = new Set();
        const newEdgeIds = new Set();

        // Identify Router/Gateway
        const routerDevice = deviceData.find(d => d.type === 'router' || d.ip.endsWith('.1'));
        const routerId = routerDevice ? routerDevice.ip : gatewayId;

        // Router Node
        newNodeIds.add(routerId);
        if (!existingNodeIds.has(routerId)) {
            nodes.add({
                id: routerId,
                label: routerDevice ? `YOUR ROUTER\n${routerDevice.ip}` : 'YOUR ROUTER',
                size: 20,
                color: { background: '#000', border: '#ff0055' },
                font: { color: '#ff0055', size: 16 },
                shadow: { color: 'rgba(255, 0, 85, 0.6)', size: 20 },
                data: routerDevice ? routerDevice : { type: 'router', ip: 'Gateway' },
                fixed: { x: true, y: true },
                x: 0,
                y: 0
            });
        }

        // Process each device
        deviceData.forEach((device) => {
            if (device.ip === routerId) return;

            let color = '#00f3ff';
            let size = 8;
            let label = device.ip;
            let isActive = device.active !== false;

            // Check if this is the user's device
            const isLocalDevice = device.ip === localIP || device.vendor === 'Localhost';
            if (isLocalDevice) {
                label = `YOUR DEVICE\n${device.ip}`;
                color = '#ffffff';
                size = 12;
            } else {
                if (device.type === 'mobile') { color = '#00ff9d'; label += '\n[MOB]'; }
                if (device.type === 'desktop') { color = '#00f3ff'; label += '\n[DSK]'; }
                if (device.type === 'server') { color = '#ff9d00'; label += '\n[SRV]'; }
                if (device.type === 'router') { color = '#ff0055'; size = 15; }
            }

            if (!isActive) {
                color = '#4a5568';
                label += '\n(OFFLINE)';
            }

            newNodeIds.add(device.ip);

            // Update or add node
            if (existingNodeIds.has(device.ip)) {
                // Just update data without changing position
                nodes.update({
                    id: device.ip,
                    label: label,
                    color: { background: '#050a14', border: color },
                    font: { color: color },
                    shadow: { color: color, size: isActive ? 10 : 0 },
                    data: device
                });
            } else {
                // New node - add at random position near gateway
                nodes.add({
                    id: device.ip,
                    label: label,
                    size: size,
                    color: { background: '#050a14', border: color },
                    font: { color: color },
                    shadow: { color: color, size: isActive ? 10 : 0 },
                    data: device,
                    x: (Math.random() - 0.5) * 200,
                    y: (Math.random() - 0.5) * 200
                });
            }

            // Edge to router
            const edgeId = `${routerId}-${device.ip}`;
            newEdgeIds.add(edgeId);
            if (!existingEdgeIds.has(edgeId)) {
                edges.add({
                    id: edgeId,
                    from: routerId,
                    to: device.ip,
                    color: { color: 'rgba(255, 255, 255, 0.1)' },
                    width: 1,
                    dashes: false
                });
            }
        });

        // Remove nodes that no longer exist
        existingNodeIds.forEach(id => {
            if (!newNodeIds.has(id) && id !== gatewayId) {
                nodes.remove(id);
            }
        });

        // Remove edges that no longer exist
        existingEdgeIds.forEach(id => {
            if (!newEdgeIds.has(id)) {
                edges.remove(id);
            }
        });

        // Update Stats
        const stats = {
            total: deviceData.length,
            server: deviceData.filter(d => d.type === 'server').length,
            desktop: deviceData.filter(d => d.type === 'desktop' || d.type === 'laptop').length,
            mobile: deviceData.filter(d => d.type === 'mobile').length,
            other: deviceData.filter(d => d.type === 'unknown' || d.type === 'printer').length
        };
        updateStats(stats);
        document.getElementById('device-count').innerText = `NODES: ${stats.total}`;
    }

    function updateStats(stats) {
        const panel = document.getElementById('stats-panel');
        panel.innerHTML = `
            <div class="stat-item"><i class="fas fa-server"></i> ${stats.server}</div>
            <div class="stat-item"><i class="fas fa-desktop"></i> ${stats.desktop}</div>
            <div class="stat-item"><i class="fas fa-mobile-alt"></i> ${stats.mobile}</div>
            <div class="stat-item"><i class="fas fa-microchip"></i> ${stats.other}</div>
        `;
    }

    // Animation state
    let isScanning = false;
    let animationFrameId = null;
    let lastFrameTime = 0;
    const TARGET_FPS = 30; // Limit to 30fps for smooth performance
    const FRAME_INTERVAL = 1000 / TARGET_FPS;

    // Smooth animation with frame rate limiting
    function animate(currentTime) {
        animationFrameId = requestAnimationFrame(animate);

        if (!isScanning) return;

        const deltaTime = currentTime - lastFrameTime;
        if (deltaTime < FRAME_INTERVAL) return;

        lastFrameTime = currentTime - (deltaTime % FRAME_INTERVAL);
        network.redraw();
    }
    requestAnimationFrame(animate);

    network.on("afterDrawing", function (ctx) {
        if (!isScanning) return;

        const time = Date.now();
        const networkNodes = network.body.nodes;
        const nodeIndices = network.body.nodeIndices;

        ctx.save();

        // Draw soft beacon at gateway
        const gatewayNode = networkNodes[gatewayId] || Object.values(networkNodes).find(n => n.options && n.options.id && n.options.id.endsWith('.1'));
        if (gatewayNode && gatewayNode.x !== undefined) {
            const sweepTime = time % 6000;
            const angle = (sweepTime / 6000) * Math.PI * 2;
            const sweepRadius = 400;

            ctx.save();
            ctx.translate(gatewayNode.x, gatewayNode.y);
            ctx.rotate(angle);

            // Soft radial gradient beam
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, sweepRadius);
            gradient.addColorStop(0, 'rgba(0, 243, 255, 0.25)');
            gradient.addColorStop(0.4, 'rgba(0, 243, 255, 0.1)');
            gradient.addColorStop(1, 'rgba(0, 243, 255, 0)');

            ctx.globalAlpha = 0.5;
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, sweepRadius, -Math.PI / 6, Math.PI / 6);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }

        // Subtle pulse on nodes (simplified for performance)
        for (let i = 0; i < nodeIndices.length; i += 3) { // Every 3rd node only
            const nodeId = nodeIndices[i];
            const node = networkNodes[nodeId];

            if (node && node.x !== undefined) {
                const offset = (nodeId.toString().charCodeAt(0) || 0) * 500;
                const pulseT = ((time + offset) % 3000) / 3000;
                const radius = 8 + pulseT * 20;
                const opacity = (1 - pulseT) * 0.2;

                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
                ctx.strokeStyle = `rgba(0, 243, 255, ${opacity})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }

        ctx.restore();
    });

    // Interaction
    network.on("click", function (params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.get(nodeId);
            if (node && node.data) {
                showDetails(node.data);
            }
        } else {
            hideDetails();
        }
    });

    const detailsPanel = document.getElementById('node-details');
    const closeBtn = document.getElementById('close-details');

    function showDetails(deviceData) {
        document.getElementById('detail-ip').innerText = deviceData.ip;
        document.getElementById('detail-hostname').innerText = deviceData.hostname || 'N/A';
        document.getElementById('detail-mac').innerText = deviceData.mac || 'N/A';
        document.getElementById('detail-vendor').innerText = deviceData.vendor || 'Unknown';
        document.getElementById('detail-type').innerText = (deviceData.type || 'unknown').toUpperCase();
        document.getElementById('detail-latency').innerText = deviceData.latency || 'N/A';

        const ports = deviceData.ports && deviceData.ports.length > 0 ? deviceData.ports.join(', ') : 'None/Closed';
        document.getElementById('detail-ports').innerText = ports;

        const actionsDiv = document.getElementById('detail-actions');
        actionsDiv.innerHTML = '';

        const nmapBtn = document.createElement('button');
        nmapBtn.className = 'action-btn';
        nmapBtn.innerHTML = '<i class="fas fa-crosshairs"></i> RUN NMAP SCAN';
        nmapBtn.onclick = () => runNmap(deviceData.ip);
        actionsDiv.appendChild(nmapBtn);

        if (deviceData.type === 'router' || deviceData.ip.endsWith('.1')) {
            const adminBtn = document.createElement('button');
            adminBtn.className = 'action-btn';
            adminBtn.innerHTML = '<i class="fas fa-key"></i> OPEN ADMIN PANEL';
            adminBtn.style.color = '#ff0055';
            adminBtn.style.borderColor = '#ff0055';
            adminBtn.onclick = () => window.open(`http://${deviceData.ip}`, '_blank');
            actionsDiv.appendChild(adminBtn);
        }

        document.getElementById('nmap-results').innerHTML = '';
        document.getElementById('nmap-results').classList.add('hidden');
        detailsPanel.classList.remove('hidden');
    }

    function runNmap(ip) {
        const resultsDiv = document.getElementById('nmap-results');
        resultsDiv.classList.remove('hidden');
        resultsDiv.innerHTML = '<div class="loading">>> INITIATING NMAP PROTOCOL...</div>';

        fetch(`/api/nmap/${ip}`)
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    resultsDiv.innerHTML = `<div class="error">ERROR: ${data.error}</div>`;
                    return;
                }
                let html = `<h4>>> NMAP_RESULTS [${ip}]</h4>`;
                html += `<p>OS: <span class="highlight">${data.os}</span></p>`;
                html += `<h5>SERVICES:</h5><ul>`;
                data.services.forEach(s => { html += `<li>${s}</li>`; });
                html += `</ul>`;
                resultsDiv.innerHTML = html;
            })
            .catch(err => {
                resultsDiv.innerHTML = `<div class="error">CONNECTION FAILED</div>`;
            });
    }

    function hideDetails() {
        detailsPanel.classList.add('hidden');
    }

    closeBtn.addEventListener('click', hideDetails);

    // Toolbar
    document.getElementById('btn-report').addEventListener('click', () => {
        window.location.href = '/api/report';
    });

    let filterState = 'ALL';
    document.getElementById('btn-filter').addEventListener('click', () => {
        const states = ['ALL', 'MOBILE', 'DESKTOP', 'SERVER'];
        const currentIndex = states.indexOf(filterState);
        filterState = states[(currentIndex + 1) % states.length];
        document.getElementById('btn-filter').innerHTML = `<i class="fas fa-filter"></i> ${filterState}`;

        const allNodes = nodes.get();
        allNodes.forEach(node => {
            if (node.id === gatewayId) return;
            if (!node.data) return;
            const type = (node.data.type || 'unknown').toUpperCase();
            let visible = true;
            if (filterState !== 'ALL') {
                if (filterState === 'MOBILE' && type !== 'MOBILE') visible = false;
                if (filterState === 'DESKTOP' && type !== 'DESKTOP' && type !== 'LAPTOP') visible = false;
                if (filterState === 'SERVER' && type !== 'SERVER') visible = false;
            }
            nodes.update({ id: node.id, hidden: !visible });
        });
    });

    // Scanning & Monitoring
    const scanBtn = document.getElementById('scan-btn');
    const scanStatus = document.getElementById('scan-status');
    let isMonitoring = false;
    let pollInterval = null;

    // Initial State Check
    fetch('/api/scan')
        .then(res => res.json())
        .then(data => {
            if (data.is_scanning) {
                startMonitoringUI();
            }
            updateGraph(data.devices);
        });

    scanBtn.addEventListener('click', () => {
        if (!isMonitoring) {
            startMonitoring();
        } else {
            stopMonitoring();
        }
    });

    function startMonitoring() {
        fetch('/api/scan/start', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                startMonitoringUI();
            });
    }

    function stopMonitoring() {
        fetch('/api/scan/stop', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                stopMonitoringUI();
            });
    }

    function startMonitoringUI() {
        isMonitoring = true;
        isScanning = true;
        document.body.classList.add('scanning');
        scanBtn.innerText = 'TERMINATE_MONITORING()';
        scanBtn.classList.add('active');
        scanStatus.innerText = 'SCANNER_STATUS: ACTIVE_MONITORING';

        pollInterval = setInterval(fetchScanResults, 5000);
        fetchScanResults();
    }

    function stopMonitoringUI() {
        isMonitoring = false;
        isScanning = false;
        document.body.classList.remove('scanning');
        scanBtn.innerText = 'INITIATE_MONITORING()';
        scanBtn.classList.remove('active');
        scanStatus.innerText = 'SCANNER_STATUS: STANDBY';

        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    function fetchScanResults() {
        fetch('/api/scan')
            .then(response => response.json())
            .then(data => {
                updateGraph(data.devices);

                const quality = data.quality;
                const indicator = document.getElementById('quality-indicator');
                indicator.innerText = `NET_HEALTH: ${quality.score}%`;
                indicator.title = quality.issues.length > 0 ? "Issues:\n" + quality.issues.join('\n') : "Network is healthy.";
            })
            .catch(err => {
                console.error(err);
            });
    }

    // =============================================
    // DEVICE LIST PANEL
    // =============================================
    const deviceListPanel = document.getElementById('device-list-panel');
    const toggleDeviceListBtn = document.getElementById('toggle-device-list');
    const closeDeviceListBtn = document.getElementById('close-device-list');
    const deviceListContent = document.getElementById('device-list-content');

    toggleDeviceListBtn.addEventListener('click', () => {
        deviceListPanel.classList.remove('hidden');
        deviceListPanel.classList.toggle('visible');
        if (deviceListPanel.classList.contains('visible')) {
            renderDeviceList();
        }
    });

    closeDeviceListBtn.addEventListener('click', () => {
        deviceListPanel.classList.remove('visible');
    });

    function renderDeviceList() {
        if (!allDevices || allDevices.length === 0) {
            deviceListContent.innerHTML = '<div style="text-align: center; color: var(--text-color); padding: 20px;">NO DEVICES<br><small>Start monitoring to scan</small></div>';
            return;
        }

        // Sort: router first, then active, then inactive
        const sorted = [...allDevices].sort((a, b) => {
            if (a.type === 'router' || a.ip.endsWith('.1')) return -1;
            if (b.type === 'router' || b.ip.endsWith('.1')) return 1;
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            return 0;
        });

        let html = '';
        sorted.forEach(device => {
            const isActive = device.active !== false;
            const deviceType = device.type || 'unknown';
            const isRouter = deviceType === 'router' || device.ip.endsWith('.1');
            const isLocal = device.ip === localIP || device.vendor === 'Localhost';

            let deviceLabel = device.ip;
            if (isRouter) deviceLabel = `${device.ip} (Your Router)`;
            else if (isLocal) deviceLabel = `${device.ip} (Your Device)`;

            html += `
                <div class="device-item ${!isActive ? 'offline' : ''}" data-device-ip="${device.ip}">
                    <div class="device-item-header">
                        <div>
                            <span class="device-ip">${deviceLabel}</span>
                            <span class="device-type-badge ${deviceType}">${deviceType.toUpperCase()}</span>
                        </div>
                        <span class="device-status ${isActive ? 'active' : 'inactive'}">${isActive ? 'ONLINE' : 'OFFLINE'}</span>
                    </div>
                    <div class="device-info">
                        <div class="device-info-row">
                            <span class="device-info-label">HOST:</span>
                            <span class="device-info-value">${device.hostname || 'N/A'}</span>
                        </div>
                        <div class="device-info-row">
                            <span class="device-info-label">MAC:</span>
                            <span class="device-info-value">${device.mac || 'N/A'}</span>
                        </div>
                        <div class="device-info-row">
                            <span class="device-info-label">VENDOR:</span>
                            <span class="device-info-value">${device.vendor || 'Unknown'}</span>
                        </div>
                        <div class="device-info-row">
                            <span class="device-info-label">LATENCY:</span>
                            <span class="device-info-value">${device.latency || 'N/A'}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        deviceListContent.innerHTML = html;

        // Click handlers
        document.querySelectorAll('.device-item').forEach(item => {
            item.addEventListener('click', () => {
                const deviceIP = item.getAttribute('data-device-ip');
                const device = allDevices.find(d => d.ip === deviceIP);
                if (device) {
                    showDetails(device);
                    deviceListPanel.classList.remove('visible');
                }
            });
        });
    }

    // Auto-update device list if visible
    setInterval(() => {
        if (deviceListPanel.classList.contains('visible') && isMonitoring) {
            renderDeviceList();
        }
    }, 5000);
});
