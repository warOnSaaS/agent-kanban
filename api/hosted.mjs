import { handleHosted } from '../lib/hosted.mjs';

// Hosted mode (many teams, one deployment). Deployed with vercel.hosted.json, which sends every path here.
export default async function handler(req, res) {
  if (process.env.HOSTED !== '1') return res.writeHead(404).end();
  await handleHosted(req, res);
}
