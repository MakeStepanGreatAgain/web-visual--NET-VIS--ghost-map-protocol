document.addEventListener('DOMContentLoaded', () => {
    const nodes = new vis.DataSet([]);
    const edges = new vis.DataSet([]);
    const container = document.getElementById('network-graph');

    const data = {
        nodes: nodes,
        edges: edges
    };

    const options = {
        nodes: {
            shape: 'dot',
            size: 10,
            font: {
                size: 14,
                color: '#00f3ff',
                face: 'Share Tech Mono',
                strokeWidth: 0, // No outline on text
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
            shadow: {
                enabled: true,
                color: 'rgba(0, 243, 255, 0.2)',
                size: 5,
                x: 0,
                y: 0
            }
        },
        physics: {
            stabilization: false,
            minVelocity: 0.01,
            barnesHut: {
                gravitationalConstant: -4000,
                springConstant: 0.01,
                springLength: 200,
                damping: 0.1
            }
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            zoomView: true
        }
    };

    const network = new vis.Network(container, data, options);

    // Gateway node (center)
    const gatewayId = 'gateway';

    // Custom Icons (Unicode for FontAwesome)
    // We will use 'dot' shape but draw custom things on canvas if needed, 
    // or just use the dot with specific colors.
    // Let's stick to simple schematic dots for the "Ghost Map" feel.

    function updateGraph(deviceData) {
        const newNodes = [];
        const newEdges = [];

        // Identify Router/Gateway
        const routerDevice = deviceData.find(d => d.type === 'router' || d.ip.endsWith('.1'));
        const routerId = routerDevice ? routerDevice.ip : gatewayId;

        // Router Node
        newNodes.push({
            id: routerId,
            label: routerDevice ? `GATEWAY\n${routerDevice.ip}` : 'GATEWAY',
            size: 20,
            color: {
                background: '#000',
                border: '#ff0055'
            },
            font: { color: '#ff0055' },
            shadow: { color: 'rgba(255, 0, 85, 0.6)', size: 20 },
            data: routerDevice ? routerDevice : { type: 'router', ip: 'Gateway' },
            // Fix gateway to center
            fixed: { x: true, y: true },
            x: 0,
            y: 0
        });

        // Scanner Node
        const scannerDevice = deviceData.find(d => d.ip === '127.0.0.1' || d.vendor === 'Localhost');
        const scannerId = scannerDevice ? scannerDevice.ip : 'scanner_node';

        if (!scannerDevice) {
            newNodes.push({
                id: scannerId,
                label: 'SYSTEM_CORE',
                size: 15,
                color: {
                    background: '#000',
                    border: '#ffffff'
                },
                font: { color: '#ffffff' },
                data: { type: 'desktop', ip: 'Localhost', vendor: 'You' }
            });
        }

        deviceData.forEach((device) => {
            let color = '#00f3ff'; // Default Cyan
            let size = 8;
            let label = device.ip;
            let isActive = device.active !== false; // Default true if undefined

            if (device.type === 'mobile') { color = '#00ff9d'; label += '\n[MOB]'; }
            if (device.type === 'desktop') { color = '#00f3ff'; label += '\n[DSK]'; }
            if (device.type === 'server') { color = '#ff9d00'; label += '\n[SRV]'; }
            if (device.type === 'router') { color = '#ff0055'; size = 15; }

            // Inactive Styling
            if (!isActive) {
                color = '#4a5568'; // Grey
                label += '\n(OFFLINE)';
            }

            // Don't duplicate scanner/router
            if (device.ip === routerId || device.ip === scannerId) return;

            newNodes.push({
                id: device.ip,
                label: label,
                size: size,
                color: {
                    background: '#050a14',
                    border: color
                },
                font: { color: color },
                shadow: { color: color, size: isActive ? 10 : 0 },
                data: device
            });

            // Edges
            // 1. Physical Link to Router
            newEdges.push({
                from: routerId,
                to: device.ip,
                color: { color: 'rgba(255, 255, 255, 0.1)' },
                width: 1,
                dashes: false
            });

            // 2. Logic Link to Scanner (The "Ghost" connection)
            if (device.ip !== scannerId) {
                newEdges.push({
                    from: scannerId,
                    to: device.ip,
                    color: { color: 'rgba(0, 243, 255, 0.05)' },
                    width: 1,
                    dashes: [2, 10],
                    smooth: { type: 'curvedCW', roundness: 0.3 }
                });
            }
        });

        // Connect Scanner to Router
        if (scannerId !== routerId) {
            newEdges.push({
                from: routerId,
                to: scannerId,
                color: { color: '#ffffff' },
                width: 2,
                dashes: false
            });
        }

        nodes.clear();
        edges.clear();
        nodes.add(newNodes);
        edges.add(newEdges);

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

    // Animation Loop
    function animate() {
        network.redraw();
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    // Animation state
    let isScanning = false;

    network.on("afterDrawing", function (ctx) {
        const time = Date.now();
        const edges = network.body.edges;
        const edgeIndices = network.body.edgeIndices;
        const nodes = network.body.nodes;
        const nodeIndices = network.body.nodeIndices;

        ctx.save();

        // 1. Draw "Data Packets" moving along edges (following edge paths)
        if (isScanning) {
            for (let i = 0; i < edgeIndices.length; i += 2) { // Skip every other for performance
                const edgeId = edgeIndices[i];
                const edge = edges[edgeId];

                if (edge && edge.connected) {
                    const from = nodes[edge.fromId];
                    const to = nodes[edge.toId];

                    if (from && to && from.x !== undefined && to.x !== undefined) {
                        // Random offset for each edge
                        const offset = (edgeId.toString().charCodeAt(0) || 0) * 100;
                        const t = ((time + offset) % 3000) / 3000; // 0 to 1

                        // Get point along edge path
                        let x, y;

                        // Check if edge has a curve
                        if (edge.edgeType && edge.edgeType.getPoint) {
                            const point = edge.edgeType.getPoint(t);
                            x = point.x;
                            y = point.y;
                        } else {
                            // Fallback to linear interpolation
                            x = from.x + (to.x - from.x) * t;
                            y = from.y + (to.y - from.y) * t;
                        }

                        // Draw glowing packet
                        ctx.shadowColor = '#00f3ff';
                        ctx.shadowBlur = 15;
                        ctx.beginPath();
                        ctx.arc(x, y, 3, 0, 2 * Math.PI);
                        ctx.fillStyle = '#ffffff';
                        ctx.fill();
                        ctx.shadowBlur = 0;
                    }
                }
            }
        }

        // 2. Draw "Pulse" rings around active nodes (optimized)
        for (let i = 0; i < nodeIndices.length; i++) {
            const nodeId = nodeIndices[i];
            const node = nodes[nodeId];
            const nodeData = node.options;

            if (node && node.x !== undefined) {
                // Only pulse active nodes during scanning
                const isActive = !nodeData || !nodeData.data || nodeData.data.active !== false;

                if (isActive && isScanning) {
                    const offset = (nodeId.toString().charCodeAt(0) || 0) * 500;
                    const pulseT = ((time + offset) % 2000) / 2000;
                    const radius = 10 + pulseT * 30;
                    const opacity = (1 - pulseT) * 0.4;

                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
                    ctx.strokeStyle = `rgba(0, 243, 255, ${opacity})`;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        // 3. Draw Radar Sweep at Gateway (Lighthouse Effect)
        const gatewayNode = nodes[gatewayId];
        if (gatewayNode && gatewayNode.x !== undefined && isScanning) {
            const sweepTime = time % 8000; // 8 second rotation
            const angle = (sweepTime / 8000) * Math.PI * 2;
            const sweepRadius = 600;

            // Draw sweep beam
            ctx.save();
            ctx.translate(gatewayNode.x, gatewayNode.y);
            ctx.rotate(angle);

            // Create conic-like gradient effect
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = '#00f3ff';
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, sweepRadius, -Math.PI / 12, Math.PI / 12);
            ctx.closePath();
            ctx.fill();

            // Brighter leading edge
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#00f3ff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(sweepRadius, 0);
            ctx.stroke();

            // Glow at the tip
            ctx.shadowColor = '#00f3ff';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(sweepRadius, 0, 5, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            ctx.restore();
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
        document.getElementById('detail-mac').innerText = deviceData.mac;
        document.getElementById('detail-vendor').innerText = deviceData.vendor;
        document.getElementById('detail-type').innerText = (deviceData.type || 'unknown').toUpperCase();
        document.getElementById('detail-latency').innerText = deviceData.latency || 'N/A';

        const ports = deviceData.ports && deviceData.ports.length > 0 ? deviceData.ports.join(', ') : 'None/Closed';
        document.getElementById('detail-ports').innerText = ports;

        // Action Buttons
        const actionsDiv = document.getElementById('detail-actions');
        actionsDiv.innerHTML = '';

        // Nmap Button
        const nmapBtn = document.createElement('button');
        nmapBtn.className = 'action-btn';
        nmapBtn.innerHTML = '<i class="fas fa-crosshairs"></i> RUN NMAP SCAN';
        nmapBtn.onclick = () => runNmap(deviceData.ip);
        actionsDiv.appendChild(nmapBtn);

        // Admin Button
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
                data.services.forEach(s => {
                    html += `<li>${s}</li>`;
                });
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
        isScanning = true; // Enable animation
        document.body.classList.add('scanning');
        scanBtn.innerText = 'TERMINATE_MONITORING()';
        scanBtn.classList.add('active');
        scanStatus.innerText = 'SCANNER_STATUS: ACTIVE_MONITORING';

        // Ensure gateway exists for animation
        if (!nodes.get(gatewayId)) {
            nodes.add({
                id: gatewayId,
                label: 'GATEWAY',
                icon: {
                    code: icons['gateway'],
                    color: '#ffffff',
                    size: 40
                }
            });
        }

        // Start Polling
        pollInterval = setInterval(fetchScanResults, 5000);
        fetchScanResults(); // Immediate fetch
    }

    function stopMonitoringUI() {
        isMonitoring = false;
        isScanning = false; // Disable animation
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
});
