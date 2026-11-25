import { defineConfig } from 'vitest/config';
process.env.TZ = 'Asia/Seoul';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
