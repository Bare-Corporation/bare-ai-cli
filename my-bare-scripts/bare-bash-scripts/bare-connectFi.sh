#!/usr/bin/env bash
# ============================================================
#  bare-connectFi.sh — Bare-AI WiFi Connection Manager
#  Version: 1.0.0 | Date: 2026-06-03
#  Uses: nmcli (NetworkManager)
# ============================================================
set -euo pipefail

# --- Colours ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
    cat <<EOF
${CYAN}bare-connectFi${NC} — Bare-AI WiFi Connection Manager

${YELLOW}USAGE:${NC}
  bare-connectFi scan                  Scan for available WiFi networks
  bare-connectFi connect <SSID>        Connect to a WiFi network (prompts for password)
  bare-connectFi connect <SSID> <PASS> Connect with password inline
  bare-connectFi status                Show current WiFi connection status
  bare-connectFi disconnect            Disconnect from current WiFi
  bare-connectFi list-saved            List saved WiFi connections
  bare-connectFi forget <SSID>         Forget a saved WiFi connection
  bare-connectFi info                  Show detailed WiFi device information

${YELLOW}EXAMPLES:${NC}
  bare-connectFi scan
  bare-connectFi connect "MyHomeWiFi" "mysecretpass"
  bare-connectFi status
EOF
}

# --- Check for nmcli ---
if ! command -v nmcli &>/dev/null; then
    echo -e "${RED}[ERROR]${NC} nmcli (NetworkManager) is not installed. Cannot manage WiFi."
    exit 1
fi

# --- Detect WiFi hardware ---
detect_wifi_device() {
    nmcli -t -f TYPE,DEVICE device status 2>/dev/null | grep "^wifi:" | cut -d: -f2 | head -1
}

WIFI_DEVICE=$(detect_wifi_device || true)

check_wifi_hardware() {
    if [[ -z "$WIFI_DEVICE" ]]; then
        echo -e "${RED}[ERROR]${NC} No WiFi adapter detected on this system."
        echo "  Available interfaces:"
        ip -br link show 2>/dev/null | awk '{print "    - " $1}' || true
        echo ""
        echo "  If you just plugged in a USB WiFi adapter, run:"
        echo "    sudo systemctl restart NetworkManager"
        echo "  Then try again."
        exit 1
    fi
}

# --- Commands ---
cmd_scan() {
    check_wifi_hardware
    echo -e "${CYAN}[SCAN]${NC} Scanning for WiFi networks on ${YELLOW}$WIFI_DEVICE${NC}..."
    nmcli device wifi rescan 2>/dev/null || true
    sleep 2
    echo ""
    nmcli -t -f SSID,SIGNAL,SECURITY,BSSID device wifi list 2>/dev/null | 
        awk -F: '{
            signal=$2
            if (signal >= 80) bar="█████"
            else if (signal >= 60) bar="████"
            else if (signal >= 40) bar="███"
            else if (signal >= 20) bar="██"
            else bar="█"
            printf "  %-25s  Signal: %3s%% %s  Security: %s
", $1, signal, bar, $3
        }' | sort -t'%' -k1 -rn | head -20
    
    echo ""
    echo -e "${GREEN}[DONE]${NC} Scan complete."
}

cmd_connect() {
    check_wifi_hardware
    local ssid="$1"
    local pass="${2:-}"

    if [[ -z "$ssid" ]]; then
        echo -e "${RED}[ERROR]${NC} SSID is required."
        usage
        exit 1
    fi

    echo -e "${CYAN}[CONNECT]${NC} Connecting to ${YELLOW}"$ssid"${NC} on $WIFI_DEVICE..."

    if [[ -n "$pass" ]]; then
        nmcli device wifi connect "$ssid" password "$pass" 2>&1
    else
        # Prompt for password securely
        read -r -s -p "  Enter WiFi password: " pass
        echo ""
        nmcli device wifi connect "$ssid" password "$pass" 2>&1
    fi

    local rc=$?
    if [[ $rc -eq 0 ]]; then
        echo -e "${GREEN}[OK]${NC} Successfully connected to "$ssid"."
        cmd_status
    else
        echo -e "${RED}[FAIL]${NC} Connection failed (exit code: $rc)."
        exit $rc
    fi
}

cmd_status() {
    check_wifi_hardware
    echo -e "${CYAN}[STATUS]${NC} WiFi status for $WIFI_DEVICE:"
    echo ""

    local conn_info
    conn_info=$(nmcli -t -f GENERAL.CONNECTION,GENERAL.DEVICE,IP4.ADDRESS,IP4.GATEWAY,DHCP4.OPTION 
        device show "$WIFI_DEVICE" 2>/dev/null || true)

    if echo "$conn_info" | grep -q "GENERAL.CONNECTION:"; then
        local ssid;     ssid=$(echo "$conn_info" | grep "GENERAL.CONNECTION:" | cut -d: -f2-)
        local ip;       ip=$(echo "$conn_info" | grep "IP4.ADDRESS" | cut -d: -f2-)
        local gw;       gw=$(echo "$conn_info" | grep "IP4.GATEWAY" | cut -d: -f2-)
        local dns;      dns=$(echo "$conn_info" | grep "domain_name_servers" | cut -d= -f2-)

        echo -e "  ${GREEN}SSID:${NC}      $ssid"
        echo -e "  ${GREEN}IP:${NC}        ${ip:-N/A}"
        echo -e "  ${GREEN}Gateway:${NC}   ${gw:-N/A}"
        echo -e "  ${GREEN}DNS:${NC}       ${dns:-N/A}"

        # Signal strength
        local signal
        signal=$(nmcli -t -f IN-USE,SIGNAL device wifi list 2>/dev/null | grep "^\*:" | cut -d: -f2)
        if [[ -n "$signal" ]]; then
            echo -e "  ${GREEN}Signal:${NC}    $signal%"
        fi
    else
        echo -e "  ${YELLOW}Not connected to any WiFi network.${NC}"
    fi

    # Internet check
    echo ""
    if ping -c 1 -W 2 1.1.1.1 &>/dev/null; then
        echo -e "  ${GREEN}Internet:   UP${NC}"
    else
        echo -e "  ${RED}Internet:   DOWN${NC}"
    fi
}

cmd_disconnect() {
    check_wifi_hardware
    echo -e "${CYAN}[DISCONNECT]${NC} Disconnecting $WIFI_DEVICE..."
    nmcli device disconnect "$WIFI_DEVICE" 2>&1
    echo -e "${GREEN}[OK]${NC} Disconnected."
}

cmd_list_saved() {
    echo -e "${CYAN}[SAVED]${NC} Saved WiFi connections:"
    echo ""
    nmcli -t -f NAME,TYPE,AUTOCONNECT connection show 2>/dev/null | grep ":802-11-wireless" | 
        awk -F: '{printf "  %-30s  Auto-connect: %s
", $1, $3}' || echo "  (none)"
}

cmd_forget() {
    local ssid="$1"
    if [[ -z "$ssid" ]]; then
        echo -e "${RED}[ERROR]${NC} SSID required to forget."
        exit 1
    fi
    echo -e "${CYAN}[FORGET]${NC} Removing saved connection "$ssid"..."
    nmcli connection delete "$ssid" 2>&1
    echo -e "${GREEN}[OK]${NC} Forgotten."
}

cmd_info() {
    check_wifi_hardware
    echo -e "${CYAN}[INFO]${NC} WiFi device details for $WIFI_DEVICE:"
    echo ""
    nmcli device show "$WIFI_DEVICE" 2>/dev/null || echo "No details available."
}

# --- Main ---
case "${1:-}" in
    scan)
        cmd_scan
        ;;
    connect)
        cmd_connect "${2:-}" "${3:-}"
        ;;
    status)
        cmd_status
        ;;
    disconnect)
        cmd_disconnect
        ;;
    list-saved|saved)
        cmd_list_saved
        ;;
    forget)
        cmd_forget "${2:-}"
        ;;
    info)
        cmd_info
        ;;
    -h|--help|help|"")
        usage
        ;;
    *)
        echo -e "${RED}[ERROR]${NC} Unknown command: '$1'"
        usage
        exit 1
        ;;
esac
