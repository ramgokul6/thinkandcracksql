import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./e2e',
  timeout:45000,
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
  webServer:{command:'python3 -m http.server 4173 --bind 127.0.0.1',url:'http://127.0.0.1:4173',reuseExistingServer:true}
});
