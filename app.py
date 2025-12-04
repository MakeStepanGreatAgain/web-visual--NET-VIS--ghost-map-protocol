from flask import Flask, render_template, jsonify, request, Response
import scanner
import threading
import time
import ipaddress
import logging

app = Flask(__name__)

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:;"
    return response

known_devices = {}
is_scanning = False
scan_lock = threading.Lock()

def background_scan():
    global known_devices, is_scanning
    while True:
        if is_scanning:
            try:
                current_devices = scanner.get_network_nodes()
                
                with scan_lock:
                    found_ips = set()
                    
                    for device in current_devices:
                        ip = device['ip']
                        found_ips.add(ip)
                        
                        if ip in known_devices:
                            known_devices[ip].update(device)
                            known_devices[ip]['active'] = True
                            known_devices[ip]['last_seen'] = time.time()
                        else:
                            device['active'] = True
                            device['first_seen'] = time.time()
                            device['last_seen'] = time.time()
                            known_devices[ip] = device
                    
                    for ip in known_devices:
                        if ip not in found_ips:
                            known_devices[ip]['active'] = False
            except Exception as e:
                pass  # Silent fail
        else:
            time.sleep(1)
            continue
            
        time.sleep(5)

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

@app.route('/api/local-ip')
def get_local_ip():
    try:
        local_ip, _, _ = scanner.get_local_ip_info()
        return jsonify({'ip': local_ip})
    except Exception as e:
        return jsonify({'ip': '127.0.0.1', 'error': str(e)})

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

    # Terminal colors
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    GRAY = '\033[90m'
    BOLD = '\033[1m'
    RESET = '\033[0m'
    
    print(f"""
{CYAN}    ███╗   ██╗███████╗████████╗    ██╗   ██╗██╗███████╗
    ████╗  ██║██╔════╝╚══██╔══╝    ██║   ██║██║██╔════╝
    ██╔██╗ ██║█████╗     ██║       ██║   ██║██║███████╗
    ██║╚██╗██║██╔══╝     ██║       ╚██╗ ██╔╝██║╚════██║
    ██║ ╚████║███████╗   ██║        ╚████╔╝ ██║███████║
    ╚═╝  ╚═══╝╚══════╝   ╚═╝         ╚═══╝  ╚═╝╚══════╝{RESET}

    {GRAY}>> GHOST_MAP_PROTOCOL v2.0{RESET}
    {GRAY}>> Status: {GREEN}ONLINE{RESET}
    
    {BOLD}>> Open: {CYAN}http://{local_ip}:5001{RESET}
    {GRAY}>> Press Ctrl+C to stop{RESET}
""")
    
    # Suppress all Flask/Werkzeug logs
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    app.logger.disabled = True
    logging.getLogger().setLevel(logging.ERROR)
    
    app.run(debug=False, host=local_ip, port=5001, use_reloader=False)
