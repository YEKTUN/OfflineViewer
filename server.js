// server.js
const express   = require('express');
const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const archiver  = require('archiver');
const cors      = require('cors');
const mongoose  = require('mongoose');
require('dotenv').config();

const PORT = process.env.PORT || 8080;
let   lastZipPath = null;

const app = express();
app.use(express.json());
app.use(cors());

/* ─────────────── MongoDB ─────────────── */
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB bağlantısı başarılı.'))
  .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

const UrlModel = mongoose.model('Url', new mongoose.Schema({
  url: String,
  timestamp: Number,
}));

/* ─────────────── Singleton browser ─────────────── */
const launchOpts = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};
if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;

let browserPromise = puppeteer.launch(launchOpts);
browserPromise.catch(() => {
  console.warn('🔄 Browser crash, restarting…');
  browserPromise = puppeteer.launch(launchOpts);
});

/* ─────────────── Health check ─────────────── */
app.get('/', (_, res) => res.send('ok'));

/* ─────────────── POST /screenshots ─────────────── */
app.post('/screenshots', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL gerekli.' });

  const timestamp = Date.now();
  const dirPath   = path.join(__dirname, 'shots', `site_${timestamp}`);
  fs.mkdirSync(dirPath, { recursive: true });

  const warnings = [];
  let   gotShot  = false;

  try {
    await UrlModel.create({ url, timestamp });

    const browser = await browserPromise;
    const page    = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    /* ---------- Ana sayfa ---------- */
    const tryGoto = async target => {
      try {
        await page.goto(target, { waitUntil: 'networkidle2', timeout: 15000 });
        return true;
      } catch { return false; }
    };

    if (!(await tryGoto(url))) {
      // https → http veya tersi dene
      url = url.startsWith('https://')
        ? url.replace('https://', 'http://')
        : url.replace('http://', 'https://');

      if (!(await tryGoto(url))) warnings.push(`Ana sayfa yüklenemedi: ${url}`);
    }

    if (page.url().startsWith('http')) {
      await page.screenshot({ path: path.join(dirPath, 'home.png'), fullPage: false });
      gotShot = true;
    }

    /* ---------- Alt sayfa (ilk link) ---------- */
    let links = [];
    try {
      links = await page.$$eval('a[href]', els =>
        els.map(e => e.href).filter(h => h.startsWith(location.origin))
      );
    } catch {
      warnings.push('Linkler alınamadı (frame detach)');
    }

    if (links[0]) {
      try {
        const sub = await browser.newPage();
        await sub.setViewport({ width: 1366, height: 768 });
        await sub.setUserAgent(await page.browser().userAgent());
        await sub.goto(links[0], { waitUntil: 'networkidle2', timeout: 15000 });

        const filename = links[0]
          .replace(new URL(url).origin, '')
          .replace(/[\\/:"*?<>|]+/g, '_') || 'index';

        await sub.screenshot({ path: path.join(dirPath, `${filename}.png`), fullPage: false });
        await sub.close();
        gotShot = true;
      } catch {
        warnings.push(`Alt sayfa alınamadı: ${links[0]}`);
      }
    }

    await page.close();

    if (!gotShot) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return res.status(400).json({ success: false, error: 'Hiçbir ekran görüntüsü alınamadı.', warnings });
    }

    /* ---------- ZIP ---------- */
    const zipPath = path.join(__dirname, 'shots', `screenshots_${timestamp}.zip`);
    lastZipPath   = zipPath;

    const output  = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(dirPath, false);
    await archive.finalize();

    output.on('close', () => {
      res.download(zipPath, 'screenshots.zip', err => {
        if (err && err.code !== 'ECONNABORTED') console.error('Download error:', err);

        setTimeout(() => {
          fs.rmSync(dirPath, { recursive: true, force: true });
          fs.unlinkSync(zipPath);
          console.log('🧹 Geçici dosyalar silindi.');
        }, 10_000);
      });
    });
  } catch (err) {
    console.error('❌ Genel hata:', err);
    fs.rmSync(dirPath, { recursive: true, force: true });
    res.status(500).json({ success: false, error: 'Sunucu hatası', detail: err.message });
  }
});

/* ─────────────── GET /screenshots (son ZIP) ─────────────── */
app.get('/screenshots', (req, res) => {
  if (!lastZipPath || !fs.existsSync(lastZipPath)) {
    return res.status(404).send('ZIP bulunamadı.');
  }
  res.download(lastZipPath);
});

/* ─────────────── Sunucu ─────────────── */
app.listen(PORT, () => console.log(`🚀 Server çalışıyor: http://localhost:${PORT}`));
