
import scanner
import sys

try:
    print("Testing scanner...")
    nodes = scanner.get_network_nodes()
    print(f"Found {len(nodes)} nodes")
    for node in nodes:
        print(node)
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
