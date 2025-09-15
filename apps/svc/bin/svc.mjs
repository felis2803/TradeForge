#!/usr/bin/env node
import { startServer } from '../dist/server.js';

startServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
