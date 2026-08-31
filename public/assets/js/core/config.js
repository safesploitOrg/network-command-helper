window.NCH = window.NCH || {};

NCH.config = {
    version: "1.1.0",

    levels: ["simple", "advanced", "expert"],

    defaults: {
        app: {
            level: "simple",
            device: "openwrt",
            openwrtTask: "vlan",
            preset: "custom"
        },

        openwrtVlan: {
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
        },

        openwrtWireless: {
            wSection: "wifi_guests",
            wSsid: "wifi-guests",
            wMode: "standard",
            wRadio: "radio1",
            wNetwork: "wifi_guests",
            wEncryption: "psk2",
            wKey: "",
            wRadiusServer: "",
            wRadiusPort: "1812",
            wRadiusSecret: "",
            wDynamicMode: "1",
            wTaggedInterface: "eth2",
            wVlanBridge: "br-vlan",
            wVlanNaming: "0",
            wIsolate: true,
            wBridgeIsolate: true,
            wHidden: false,
            wApply: true,
            wVerify: true
        },

        netgear: {
            sTask: "trunk",
            sPort: "g8",
            sNative: "1",
            sTagged: "10-12,45",
            sNames: "10=wifi-admins\n11=wifi-users\n12=wifi-guests\n45=setup",
            sNativeTouch: false,
            sVerify: true,
            sSave: true
        }
    }
};
