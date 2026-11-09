import type { NextConfig } from "next";

// Lets phones and laptops on the same Wi-Fi open the dev server (dev only).
const config: NextConfig = {
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
};

export default config;
