import socket
import requests
import threading
import time
import netifaces
import sys
import subprocess
import re

SCAPY_AVAILABLE = False
try:
    import scapy.all as scapy
    SCAPY_AVAILABLE = True
except Exception as e:
    print(f"[SCANNER] Scapy not available (Error: {e}). Switching to System Scanner.")
    SCAPY_AVAILABLE = False

def get_local_ip_info():
    """
    Returns (ip, interface_name, subnet_cidr)
    """
    target_ip = '127.0.0.1'
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        target_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    try:
        for iface in netifaces.interfaces():
            addrs = netifaces.ifaddresses(iface)
            if netifaces.AF_INET in addrs:
                for addr_info in addrs[netifaces.AF_INET]:
                    if addr_info['addr'] == target_ip:
                        netmask = addr_info.get('netmask', '255.255.255.0')
                        cidr = sum(bin(int(x)).count('1') for x in netmask.split('.'))
                        subnet = f"{target_ip.rsplit('.', 1)[0]}.0/{cidr}"
                        return target_ip, iface, subnet
    except Exception as e:
        print(f"Netifaces error: {e}")

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
    

    try:
        base_ip = ".".join(subnet.split('.')[:3])
        
        def ping_host(ip):
            try:
                subprocess.check_call(["ping", "-c", "1", "-t", "1", ip], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except:
                pass

        threads = []
        for i in range(1, 255):
            ip = f"{base_ip}.{i}"
            t = threading.Thread(target=ping_host, args=(ip,))
            t.start()
            threads.append(t)
            if i % 50 == 0:
                time.sleep(0.1)
        
        for t in threads:
            t.join(timeout=0.1)
            
    except Exception as e:
        print(f"Ping sweep error: {e}")

    try:
        output = subprocess.check_output(["arp", "-a"], universal_newlines=True)
        for line in output.split('\n'):
            match = re.search(r'\((.*?)\) at (.*?) ', line)
            if match:
                ip = match.group(1)
                mac = match.group(2)
                
                if ip.startswith('224.') or ip == '255.255.255.255':
                    continue
                    
                devices.append({
                    "ip": ip,
                    "mac": mac,
                    "vendor": "Unknown"
                })
    except Exception as e:
        print(f"ARP table read failed: {e}")
        
    return devices

def scan_network(ip_range, iface):
    if not SCAPY_AVAILABLE:
        return system_scan(ip_range)

    print(f"Scanning {ip_range} on {iface}...")
    
    try:
        arp_request = scapy.ARP(pdst=ip_range)
        broadcast = scapy.Ether(dst="ff:ff:ff:ff:ff:ff")
        arp_request_broadcast = broadcast/arp_request
        
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
        631: 'IPP'
    }
    open_ports = []
    
    for port, name in common_ports.items():
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.2)
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
    vendor = vendor.lower()
    
    if 'apple' in vendor:
        if 62078 in open_ports:
            return 'mobile'
        return 'laptop'
        
    if 'samsung' in vendor or 'xiaomi' in vendor or 'pixel' in vendor:
        return 'mobile'
        
    if 631 in open_ports or 'hp' in vendor or 'epson' in vendor or 'canon' in vendor:
        return 'printer'
        
    if 445 in open_ports:
        return 'desktop'
        
    if 80 in open_ports or 443 in open_ports or 8080 in open_ports:
        return 'server'
        
    if 22 in open_ports:
        return 'router'
        
    return 'unknown'

def get_latency(ip):
    """
    Pings the IP to get latency in ms.
    Returns 'N/A' if failed.
    """
    try:
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
        cmd = ["nmap", "-O", "-sV", "-T4", "--top-ports", "50", ip]
        
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT, universal_newlines=True)
        
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
    
    if subnet.startswith('127'):
        subnet = '192.168.1.0/24'
        print(f"[SCANNER] Localhost detected, trying common subnet: {subnet}")
        
    devices = scan_network(subnet, iface)
    
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
    
    for i, device in enumerate(devices):
        device['latency'] = get_latency(device['ip'])
        device['hostname'] = get_hostname(device['ip'])
        
        if i < 15:
            ports = scan_ports(device['ip'])
            device['ports'] = ports
            device['type'] = guess_device_type(device['mac'], device['vendor'], ports)
        else:
            device['ports'] = []
            device['type'] = 'unknown'
        
    return devices
