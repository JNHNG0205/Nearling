// Copy this file to secrets.h (same folder) and fill it in. secrets.h is gitignored.
// You can also change these later without reflashing: Serial Monitor (115200), type
//   w MySSID,MyPassword      set Wi-Fi
//   u https://brain.example  set the brain URL
#pragma once

#define WIFI_SSID ""
#define WIFI_PASS ""
// The brain the device talks to, no trailing slash, default https://api.mypetto.xyz
// (check: <url>/health shows {"ok":true,...}).
#define BRAIN_URL "https://api.mypetto.xyz"   // live brain (web app: https://mypetto.xyz)
