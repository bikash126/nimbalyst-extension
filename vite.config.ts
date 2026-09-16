import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createExtensionConfig } from '@nimbalyst/extension-sdk/vite';

export default defineConfig(createExtensionConfig({
  entry: './src/index.tsx',
  plugins: [react()],
}));
