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

const PORT = process.env.PORT || 5000;
let lastZipPath = null;

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
  const dirPath = path.join(__dirname, 'shots', `site_${timestamp}`);
  fs.mkdirSync(dirPath, { recursive: true });

  const warnings = [];
  let atLeastOneScreenshot = false;

  try {
    await UrlModel.create({ url, timestamp });

    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    if (process.env.CHROMIUM_PATH) {
      launchOpts.executablePath = process.env.CHROMIUM_PATH;
    }

    const browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36'
    );
    await page.setJavaScriptEnabled(true);

    // Ana sayfa
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.screenshot({ path: path.join(dirPath, 'home.png'), fullPage: false });
      atLeastOneScreenshot = true;
    } catch (err) {
      warnings.push(`Ana sayfa yüklenemedi: ${url}`);
    }

    // Alt sayfalar
    const links = await page.$$eval('a[href]', els =>
      els.map(e => e.href).filter(h => h.startsWith(document.location.origin))
    );

    const visited = new Set();
    const baseUrl = new URL(url);

    for (const link of links.slice(0, 1)) {
      if (visited.has(link)) continue;
      visited.add(link);

      try {
        const sub = await browser.newPage();
        await sub.setViewport({ width: 1366, height: 768 });
        await sub.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36'
        );
        await sub.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const filename = link.replace(baseUrl.origin, '').replace(/[\\/:"*?<>|]+/g, '_') || 'index';
        await sub.screenshot({
          path: path.join(dirPath, `${filename}.png`),
          fullPage: false
        });
        await sub.close();
        atLeastOneScreenshot = true;
      } catch (err) {
        warnings.push(`Alt sayfa alınamadı: ${link}`);
      }
    }

    await browser.close();

    if (!atLeastOneScreenshot) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return res.status(400).json({
        success: false,
        error: 'Hiçbir ekran görüntüsü alınamadı.',
        warnings
      });
    }

    // ZIP işlemleri
    const zipPath = path.join(__dirname, 'shots', `screenshots_${timestamp}.zip`);
    lastZipPath = zipPath;

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(dirPath, false);
    await archive.finalize();

    output.on('close', () => {
      res.download(zipPath, 'screenshots.zip', err => {
        if (err) {
          console.error('Download error:', err);
          return;
        }
        try {
          fs.rmSync(dirPath, { recursive: true, force: true });
          fs.unlinkSync(zipPath);
          console.log('🧹 Geçici dosyalar silindi.');
        } catch (cleanupErr) {
          console.warn('🚨 Temizleme hatası:', cleanupErr);
        }
      });
    });
  } catch (err) {
    console.error('❌ Genel hata:', err);
    res.status(500).json({
      success: false,
      error: 'İşlem sırasında beklenmedik bir hata oluştu.',
      detail: err.message
    });
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

/************ MongoDB ***********/
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB bağlantısı başarılı.'))
  .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

const urlSchema = new mongoose.Schema({
  url: String,
  timestamp: Number
});
const UrlModel = mongoose.model('Url', urlSchema);

/************ Sunucu ************/
app.listen(PORT, () => {
  console.log(`🚀 Server çalışıyor: http://localhost:${PORT}`);
});
