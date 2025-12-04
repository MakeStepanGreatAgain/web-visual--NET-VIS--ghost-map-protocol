from flask import Flask, render_template, jsonify, request, Response
import scanner
import threading
import time
import ipaddress
import logging
import copy

app = Flask(__name__)

# Security Headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:;"
    return response

# Global State
known_devices = {} # Key: IP, Value: Device Dict
is_scanning = False
scan_lock = threading.Lock()

def background_scan():
    global known_devices, is_scanning
    while True:
        if is_scanning:
            try:
                print("Starting background scan cycle...")
                current_devices = scanner.get_network_nodes()
                
                with scan_lock:
                    # Mark all as inactive first (unless we want to keep them active until proven otherwise? 
                    # Better: Mark all as inactive, then mark found as active.
                    # But we don't want to flicker. 
                    # Let's create a set of found IPs.
                    found_ips = set()
                    
                    for device in current_devices:
                        ip = device['ip']
                        found_ips.add(ip)
                        
                        # Update or Add
                        if ip in known_devices:
                            # Update existing
                            known_devices[ip].update(device)
                            known_devices[ip]['active'] = True
                            known_devices[ip]['last_seen'] = time.time()
                        else:
                            # New device
                            device['active'] = True
                            device['first_seen'] = time.time()
                            device['last_seen'] = time.time()
                            known_devices[ip] = device
                    
                    # Mark missing devices as inactive
                    for ip in known_devices:
                        if ip not in found_ips:
                            known_devices[ip]['active'] = False
                            
                print(f"Scan cycle complete. Total known devices: {len(known_devices)}")
            except Exception as e:
                print(f"Scan error: {e}")
        else:
            # Sleep a bit to avoid busy loop when not scanning
            time.sleep(1)
            continue
            
        time.sleep(5) # Scan every 5 seconds when active (faster updates)

# Start background scanner
scan_thread = threading.Thread(target=background_scan, daemon=True)
scan_thread.start()

@app.route('/')
def index():
    return render_template('index.html')

def calculate_quality(devices):
    if not devices:
        return 100, []
        
    score = 100
    issues = []
    
    active_devices = [d for d in devices if d.get('active', False)]
    
    # Factor 1: High Latency (Active only)
    high_latency_count = 0
    for d in active_devices:
        lat = d.get('latency', 'N/A')
        if lat != 'N/A':
            try:
                ms = float(lat.replace(' ms', ''))
                if ms > 100:
                    high_latency_count += 1
            except:
                pass
    
    if high_latency_count > 0:
        penalty = high_latency_count * 5
        score -= penalty
        issues.append(f"-{penalty}%: {high_latency_count} devices with high latency (>100ms)")

    # Factor 2: Unknown Devices (Active only)
    unknown_count = sum(1 for d in active_devices if d.get('vendor') == 'Unknown')
    if unknown_count > 0:
        penalty = unknown_count * 2
        score -= penalty
        issues.append(f"-{penalty}%: {unknown_count} unknown vendors")
        
    return max(0, score), issues

@app.route('/api/scan/start', methods=['POST'])
def start_scan():
    global is_scanning
    is_scanning = True
    return jsonify({"status": "started"})

@app.route('/api/scan/stop', methods=['POST'])
def stop_scan():
    global is_scanning
    is_scanning = False
    return jsonify({"status": "stopped"})

@app.route('/api/scan')
def get_scan_results():
    with scan_lock:
        # Convert dict to list
        devices_list = list(known_devices.values())
        
    score, issues = calculate_quality(devices_list)
    return jsonify({
        'devices': devices_list,
        'is_scanning': is_scanning,
        'quality': {
            'score': score,
            'issues': issues
        }
    })

@app.route('/api/report')
def generate_report():
    with scan_lock:
        devices_list = list(known_devices.values())
        
    score, issues = calculate_quality(devices_list)
    
    md = f"# Network Scan Report\n"
    md += f"**Date**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
    md += f"**Total Known Devices**: {len(devices_list)}\n"
    md += f"**Active Devices**: {len([d for d in devices_list if d.get('active')])}\n"
    md += f"**Network Quality**: {score}/100\n\n"
    
    if issues:
        md += "## Quality Issues\n"
        for issue in issues:
            md += f"- {issue}\n"
        md += "\n"
        
    md += "## Device List\n"
    md += "| Status | IP | Hostname | Type | Latency | Vendor | MAC |\n"
    md += "|---|---|---|---|---|---|---|\n"
    
    for d in devices_list:
        status = "ONLINE" if d.get('active') else "OFFLINE"
        ip = d.get('ip', 'N/A')
        host = d.get('hostname', 'N/A')
        dtype = d.get('type', 'unknown').upper()
        lat = d.get('latency', 'N/A')
        vendor = d.get('vendor', 'N/A')
        mac = d.get('mac', 'N/A')
        
        md += f"| {status} | {ip} | {host} | {dtype} | {lat} | {vendor} | {mac} |\n"
        
    return Response(
        md,
        mimetype="text/markdown",
        headers={"Content-disposition": "attachment; filename=network_report.md"}
    )

@app.route('/api/nmap/<ip>')
def run_nmap(ip):
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        return jsonify({"error": "Invalid IP address"}), 400
         
    results = scanner.scan_nmap(ip)
    return jsonify(results)

if __name__ == '__main__':
    try:
        local_ip, _, _ = scanner.get_local_ip_info()
    except:
        local_ip = "127.0.0.1"

    print(r"""
    \033[96m
    ███╗   ██╗███████╗████████╗    ██╗   ██╗██╗███████╗
    ████╗  ██║██╔════╝╚══██╔══╝    ██║   ██║██║██╔════╝
    ██╔██╗ ██║█████╗     ██║       ██║   ██║██║███████╗
    ██║╚██╗██║██╔══╝     ██║       ╚██╗ ██╔╝██║╚════██║
    ██║ ╚████║███████╗   ██║        ╚████╔╝ ██║███████║
    ╚═╝  ╚═══╝╚══════╝   ╚═╝         ╚═══╝  ╚═╝╚══════╝
    [0m
    [90m>> GHOST_MAP_PROTOCOL_INITIATED...[0m
    [90m>> SYSTEM_STATUS: \033[92mONLINE[0m
    
    [1m>> ACCESS_TERMINAL: \033[96mhttp://{}:5001\[0m
    """.format(local_ip))
    
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    app.logger.disabled = True
    
    app.run(debug=False, host=local_ip, port=5001, use_reloader=False)
