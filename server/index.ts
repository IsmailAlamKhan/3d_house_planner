import { networkInterfaces } from 'node:os';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { server } = createApp(config);

/** The addresses other devices on the home network can use. */
function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? [])
      if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  return out;
}

server.listen(config.port, config.host, () => {
  console.log(`Duplex Designer is running.`);
  console.log(`  On this PC:   http://localhost:${config.port}`);
  if (config.host === '0.0.0.0' || config.host === '::')
    for (const u of lanUrls(config.port)) console.log(`  On your Wi-Fi: ${u}`);
  console.log(`  Local AI:     ${config.ollamaUrl}  (model ${config.model})`);
  console.log(
    config.password
      ? '  Password:     required'
      : '  Password:     none (set APP_PASSWORD in .env to require one)',
  );
});
