// Electron entry point used by make.mjs: opens the manual's HTML in a hidden
// window and prints it to PDF with page numbers and a bookmark outline.
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');

const [htmlPath, pdfPath] = process.argv.slice(-2);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1300 });
  await win.loadFile(htmlPath);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {})))).then(() => true)');
  const pdf = await win.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
    // Page numbers come from the CSS @page margin boxes, so the cover has none.
    displayHeaderFooter: false,
    generateDocumentOutline: true,
    generateTaggedPDF: true,
  });
  writeFileSync(pdfPath, pdf);
  app.quit();
});
