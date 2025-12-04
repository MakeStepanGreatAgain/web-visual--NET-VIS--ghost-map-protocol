import socket
import requests
import threading
import time
import netifaces
import sys
import subprocess
import re

# Try to import scapy, handle failure gracefully
SCAPY_AVAILABLE = False
try:
    # Attempt to import scapy, but if it fails (e.g. cryptography missing), we skip it
    import scapy.all as scapy
    # Check if we can actually use it (sometimes import works but usage fails)
    SCAPY_AVAILABLE = True
except Exception as e:
    print(f"[SCANNER] Scapy not available (Error: {e}). Switching to System Scanner.")
    SCAPY_AVAILABLE = False

def get_local_ip_info():
    """
    Returns (ip, interface_name, subnet_cidr)
    """
    # Method 1: Socket (Most reliable for finding the "main" IP)
    target_ip = '127.0.0.1'
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        target_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    # Method 2: Netifaces to find subnet for this IP
    try:
        for iface in netifaces.interfaces():
            addrs = netifaces.ifaddresses(iface)
            if netifaces.AF_INET in addrs:
                for addr_info in addrs[netifaces.AF_INET]:
                    if addr_info['addr'] == target_ip:
                        # Found our interface
                        netmask = addr_info.get('netmask', '255.255.255.0')
                        cidr = sum(bin(int(x)).count('1') for x in netmask.split('.'))
                        subnet = f"{target_ip.rsplit('.', 1)[0]}.0/{cidr}"
                        return target_ip, iface, subnet
    except Exception as e:
        print(f"Netifaces error: {e}")

    # Fallback if netifaces fails but we have an IP
    if target_ip != '127.0.0.1':
        subnet = f"{target_ip.rsplit('.', 1)[0]}.0/24"
        print(f"[SCANNER] Using fallback: IP={target_ip}, Subnet={subnet}")
        return target_ip, 'unknown', subnet
    
    print(f"[SCANNER] FAILED to detect network IP, using localhost")
    return '127.0.0.1', 'lo0', '127.0.0.1/32'

def get_mac_vendor(mac_address):
    try:
        url = f"https://api.macvendors.com/{mac_address}"
        response = requests.get(url, timeout=1)
        if response.status_code == 200:
            return response.text
    except:
        pass
    return "Unknown"

def system_scan(subnet):
    """
    Fallback scanner using system ping and arp.
    """
    print(f"[SCANNER] Running System Scan on {subnet}...")
    devices = []
    
    # 1. Ping Sweep (Fast-ish)
    # Assume /24 for simplicity if CIDR is complex, or parse it.
    try:
        base_ip = ".".join(subnet.split('.')[:3])
        
        def ping_host(ip):
            try:
                subprocess.check_call(["ping", "-c", "1", "-t", "1", ip], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except:
                pass

        threads = []
        # Scan a subset or full range? Full range 1-254
        # Limit threads to avoid system limit issues
        for i in range(1, 255):
            ip = f"{base_ip}.{i}"
            t = threading.Thread(target=ping_host, args=(ip,))
            t.start()
            threads.append(t)
            # Batch join to not spawn 255 at once? Python handles it okay usually.
            # But let's sleep slightly to not flood
            if i % 50 == 0:
                time.sleep(0.1)
        
        # Wait for all? Or just let them run and read ARP later?
        # If we wait, it takes time. Max 1s per ping.
        # Let's wait for a max duration or just proceed to read ARP.
        # ARP table updates might lag.
        # For responsiveness, maybe we don't wait for ALL, but give it a moment.
        for t in threads:
            t.join(timeout=0.1)
            
    except Exception as e:
        print(f"Ping sweep error: {e}")

    # 2. Read ARP Table
    try:
        # Mac/Linux
        output = subprocess.check_output(["arp", "-a"], universal_newlines=True)
        for line in output.split('\n'):
            # Example: ? (192.168.1.1) at 00:11:22:33:44:55 on en0 ifscope [ethernet]
            # Example: router.home (192.168.1.1) at ...
            match = re.search(r'\((.*?)\) at (.*?) ', line)
            if match:
                ip = match.group(1)
                mac = match.group(2)
                
                # Filter out multicast/broadcast
                if ip.startswith('224.') or ip == '255.255.255.255':
                    continue
                    
                devices.append({
                    "ip": ip,
                    "mac": mac,
                    "vendor": "Unknown" # Could look up
                })
    except Exception as e:
        print(f"ARP table read failed: {e}")
        
    return devices

def scan_network(ip_range, iface):
    # If Scapy is broken or missing, use System Scan
    if not SCAPY_AVAILABLE:
        return system_scan(ip_range)

    print(f"Scanning {ip_range} on {iface}...")
    
    try:
        arp_request = scapy.ARP(pdst=ip_range)
        broadcast = scapy.Ether(dst="ff:ff:ff:ff:ff:ff")
        arp_request_broadcast = broadcast/arp_request
        
        # Increase timeout and retry
        # verbose=0 to suppress output
        answered_list = scapy.srp(arp_request_broadcast, timeout=2, retry=1, iface=iface, verbose=0)[0]
        
        clients_list = []
        for element in answered_list:
            client_dict = {
                "ip": element[1].psrc, 
                "mac": element[1].hwsrc,
                "vendor": "Unknown" 
            }
            clients_list.append(client_dict)
        return clients_list
        
    except Exception as e:
        print(f"Scapy scan failed ({e}). Falling back to system scan.")
        return system_scan(ip_range)

def scan_ports(ip):
    """
    Scans common ports to guess device type.
    """
    common_ports = {
        22: 'SSH',
        80: 'HTTP',
        443: 'HTTPS',
        445: 'SMB',
        8080: 'HTTP-Alt',
        631: 'IPP' # Printer
    }
    open_ports = []
    
    for port, name in common_ports.items():
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.2) # Very short timeout for speed
        try:
            result = s.connect_ex((ip, port))
            if result == 0:
                open_ports.append(port)
        except:
            pass
        finally:
            s.close()
            
    return open_ports

def guess_device_type(mac, vendor, open_ports):
    # Simple heuristics
    vendor = vendor.lower()
    
    if 'apple' in vendor:
        if 62078 in open_ports: # iPhone sync
            return 'mobile'
        return 'laptop' # Default to laptop for Apple
        
    if 'samsung' in vendor or 'xiaomi' in vendor or 'pixel' in vendor:
        return 'mobile'
        
    if 631 in open_ports or 'hp' in vendor or 'epson' in vendor or 'canon' in vendor:
        return 'printer'
        
    if 445 in open_ports: # SMB usually Windows
        return 'desktop'
        
    if 80 in open_ports or 443 in open_ports or 8080 in open_ports:
        return 'server'
        
    if 22 in open_ports:
        return 'router' # Or linux server
        
    return 'unknown'

def get_latency(ip):
    """
    Pings the IP to get latency in ms.
    Returns 'N/A' if failed.
    """
    try:
        # Mac: ping -c 1 -t 1 1.1.1.1
        output = subprocess.check_output(["ping", "-c", "1", "-t", "1", ip], stderr=subprocess.STDOUT, universal_newlines=True)
        
        if "time=" in output:
            time_str = output.split("time=")[1].split(" ")[0]
            return f"{float(time_str):.1f} ms"
    except:
        pass
    return "N/A"

def get_hostname(ip):
    try:
        return socket.gethostbyaddr(ip)[0]
    except:
        return "Unknown"

def scan_nmap(ip):
    """
    Runs nmap -O -sV <ip> and returns parsed results.
    Requires nmap to be installed.
    """
    try:
        # -O: OS detection, -sV: Service version detection, -T4: Faster timing
        cmd = ["nmap", "-O", "-sV", "-T4", "--top-ports", "50", ip]
        
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT, universal_newlines=True)
        
        # Simple parsing
        results = {
            "os": "Unknown",
            "services": [],
            "raw": output
        }
        
        for line in output.split('\n'):
            if "Running:" in line:
                results["os"] = line.split("Running:")[1].strip()
            elif "OS details:" in line:
                results["os"] = line.split("OS details:")[1].strip()
            elif "/tcp" in line and "open" in line:
                parts = line.split()
                port = parts[0]
                service = parts[2] if len(parts) > 2 else "unknown"
                version = " ".join(parts[3:]) if len(parts) > 3 else ""
                results["services"].append(f"{port}: {service} {version}")
                
        return results
    except Exception as e:
        return {"error": str(e), "raw": "Nmap failed or not installed."}

def get_network_nodes():
    local_ip, iface, subnet = get_local_ip_info()
    print(f"[SCANNER] Detected: IP={local_ip}, Interface={iface}, Subnet={subnet}")
    
    # If we can't find a real subnet, just try the common home one
    if subnet.startswith('127'):
        subnet = '192.168.1.0/24'
        print(f"[SCANNER] Localhost detected, trying common subnet: {subnet}")
        
    devices = scan_network(subnet, iface)
    
    # Ensure we at least have the local device if scan fails
    found_local = False
    for d in devices:
        if d['ip'] == local_ip:
            found_local = True
            break
            
    if not found_local:
        devices.append({
            "ip": local_ip,
            "mac": "00:00:00:00:00:00",
            "vendor": "Localhost"
        })
    
    # Enrich with ports, type, latency, hostname
    # Note: This makes the scan slower. In a real app, this should be async.
    # For this demo, we'll scan ports for up to 10 devices to keep it responsive.
    for i, device in enumerate(devices):
        # Latency & Hostname (Fast enough to do for all usually, but let's limit if many)
        device['latency'] = get_latency(device['ip'])
        device['hostname'] = get_hostname(device['ip'])
        
        if i < 15: # Limit port scan
            ports = scan_ports(device['ip'])
            device['ports'] = ports
            device['type'] = guess_device_type(device['mac'], device['vendor'], ports)
        else:
            device['ports'] = []
            device['type'] = 'unknown'
        
    return devices
