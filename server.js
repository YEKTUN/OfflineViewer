const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB bağlantısı başarılı.'))
  .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

const UrlModel = mongoose.model(
  'Url',
  new mongoose.Schema({ url: String, timestamp: Number })
);

/* ─────────────── Singleton browser ─────────────── */
const launchOpts = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};
if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;

let browserPromise = puppeteer.launch(launchOpts);
browserPromise.catch(async () => {
  console.warn('🔄 Browser crash, restarting…');
  browserPromise = puppeteer.launch(launchOpts);
});

/******************************
 * Health‑check (Render 502 fix)
 ******************************/
app.get('/', (_, res) => res.send('ok'));

/********************************
 *  POST /screenshots
 *  body: { url: string }
 ********************************/
app.post('/screenshots', async (req, res) => {
  const { url } = req.body;
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36'
    );

    /* Ana sayfa */
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.screenshot({ path: path.join(dirPath, 'home.png'), fullPage: false });
      gotShot = true;
    } catch {
      warnings.push(`Ana sayfa yüklenemedi: ${url}`);
    }

    /* Alt sayfa (ilk link) */
    const links = await page.$$eval('a[href]', els =>
      els.map(e => e.href).filter(h => h.startsWith(location.origin))
    );

    if (links[0]) {
      try {
        const sub = await browser.newPage();
        await sub.setViewport({ width: 1366, height: 768 });
        await sub.setUserAgent(page.browser().userAgent());
        await sub.goto(links[0], { waitUntil: 'domcontentloaded', timeout: 15000 });

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

    /* ZIP */
    const zipPath = path.join(__dirname, 'shots', `screenshots_${timestamp}.zip`);
    const output  = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(dirPath, false);
    await archive.finalize();

    output.on('close', () => {
      res.download(zipPath, 'screenshots.zip', err => {
        if (err) return console.error('Download error:', err);

        /* temizlik – response’tan sonra */
        setTimeout(() => {
          fs.rmSync(dirPath, { recursive: true, force: true });
          fs.unlinkSync(zipPath);
          console.log('🧹 Geçici dosyalar silindi.');
        }, 10_000);
      });
    });
  } catch (err) {
    console.error('❌ Genel hata:', err);
    res.status(500).json({ success: false, error: 'Sunucu hatası', detail: err.message });
  }
});



/********************************
 *  GET /screenshots  (son ZIP)
 ********************************/
app.get('/screenshots', (req, res) => {
  if (!lastZipPath || !fs.existsSync(lastZipPath)) {
    return res.status(404).send('ZIP bulunamadı.');
  }
  res.download(lastZipPath);
});



/************ Sunucu ************/
app.listen(PORT, () => {
  console.log(`🚀 Server çalışıyor: http://localhost:${PORT}`);
});
