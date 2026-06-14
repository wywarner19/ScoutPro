import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base must match your repo name: /scoutpro/
export default defineConfig({
  plugins: [react()],
  base: "/ScoutPro/",
});
