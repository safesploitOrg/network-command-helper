window.NCH = window.NCH || {};
NCH.presets = NCH.presets || {};

NCH.presets.openwrt = (() => {
    const PRESETS = {
        setup: {
            task: "vlan",
            vlan: {
                rVlan: "45",
                rName: "setup",
                rSubnet: "172.18.45.0/24",
                rGw: "172.18.45.254",
                rStart: "100",
                rLimit: "100",
                rLease: "12h",
                rInputPolicy: "REJECT",
                rZone: "setup",
                rAllow: "172.16.0.0/16",
                rDeny: "172.16.0.0/24",
                rWan: true,
                rLan: false,
                rDhcp: true,
                rDns: true,
                rPing: true,
                rApply: true,
                rVerify: true,
                rParent: "eth2",
                rSwitch: "switch0",
                rCpu: "0t",
                rBridge: "br-vlan45"
            }
        },

        "wifi-admins": {
            task: "vlan",
            vlan: {
                rVlan: "10",
                rName: "wifi-admins",
                rSubnet: "172.19.20.0/24",
                rGw: "172.19.20.254",
                rStart: "100",
                rLimit: "100",
                rLease: "12h",
                rInputPolicy: "ACCEPT",
                rZone: "wifi_admins",
                rAllow: "",
                rDeny: "",
                rWan: true,
                rLan: true,
                rDhcp: false,
                rDns: false,
                rPing: false,
                rApply: true,
                rVerify: true,
                rParent: "eth2",
                rSwitch: "switch0",
                rCpu: "0t",
                rBridge: "br-vlan10"
            },
            wireless: {
                wSection: "wifi_admins",
                wSsid: "wifi-admins",
                wMode: "standard",
                wRadio: "radio1",
                wNetwork: "wifi_admins",
                wEncryption: "psk2",
                wKey: "",
                wIsolate: false,
                wBridgeIsolate: false,
                wHidden: false,
                wApply: true,
                wVerify: true
            }
        },

        "wifi-guests": {
            task: "vlan",
            vlan: {
                rVlan: "12",
                rName: "wifi-guests",
                rSubnet: "172.19.22.0/24",
                rGw: "172.19.22.254",
                rStart: "100",
                rLimit: "100",
                rLease: "12h",
                rInputPolicy: "REJECT",
                rZone: "wifi_guests",
                rAllow: "",
                rDeny: "",
                rWan: true,
                rLan: false,
                rDhcp: true,
                rDns: true,
                rPing: false,
                rApply: true,
                rVerify: true,
                rParent: "eth2",
                rSwitch: "switch0",
                rCpu: "0t",
                rBridge: "br-vlan12"
            },
            wireless: {
                wSection: "wifi_guests",
                wSsid: "wifi-guests",
                wMode: "standard",
                wRadio: "radio1",
                wNetwork: "wifi_guests",
                wEncryption: "psk2",
                wKey: "",
                wIsolate: true,
                wBridgeIsolate: true,
                wHidden: false,
                wApply: true,
                wVerify: true
            }
        },

        "enterprise-dynamic": {
            task: "wireless",
            wireless: {
                wSection: "default_radio1",
                wMode: "dynamic",
                wRadio: "radio1",
                wRadiusServer: "",
                wRadiusPort: "1812",
                wRadiusSecret: "",
                wDynamicMode: "1",
                wTaggedInterface: "eth2",
                wVlanBridge: "br-vlan",
                wVlanNaming: "0",
                wIsolate: false,
                wBridgeIsolate: false,
                wHidden: false,
                wApply: true,
                wVerify: true
            }
        }
    };

    function get(name) {
        return PRESETS[name] || null;
    }

    function names() {
        return Object.keys(PRESETS);
    }

    return {
        get,
        names
    };
})();
